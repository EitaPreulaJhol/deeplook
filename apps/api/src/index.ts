import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env, sandboxEnabled } from './env';
import { backfillReportIocs } from './lib/iocs';
import { prisma } from './lib/prisma';
import { startRetention } from './lib/retention';
import { ensureBucket } from './lib/s3';
import { initSandbox } from './lib/sandbox';
import { startSlaEscalation } from './lib/sla-escalation';
import { backfillTlsh } from './lib/tlsh-backfill';
import { failInterruptedRetroscans } from './lib/yara-retro';
import { adminRoutes } from './routes/admin';
import { allowlistRoutes } from './routes/allowlist';
import { antivirusRoutes } from './routes/antivirus';
import { apiTokenRoutes } from './routes/api-tokens';
import { assignmentRoutes } from './routes/assignment';
import { attackRoutes } from './routes/attack';
import { authRoutes } from './routes/auth';
import { caseRoutes } from './routes/cases';
import { compareRoutes } from './routes/compare';
import { dashboardRoutes } from './routes/dashboard';
import { duplicateRoutes } from './routes/duplicates';
import { entryRoutes } from './routes/entries';
import { evidenceRoutes } from './routes/evidence';
import { favoritesRoutes } from './routes/favorites';
import { hexRoutes } from './routes/hex';
import { iocImportRoutes } from './routes/ioc-import';
import { iocRoutes } from './routes/iocs';
import { kbRoutes } from './routes/kb';
import { managementRoutes } from './routes/management';
import { meRoutes } from './routes/me';
import { notificationRoutes } from './routes/notifications';
import { relatedRoutes } from './routes/related';
import { reportRoutes } from './routes/reports';
import { reputationRoutes } from './routes/reputation';
import { sandboxRoutes } from './routes/sandbox';
import { searchRoutes } from './routes/search';
import { sessionRoutes } from './routes/sessions';
import { teamViewRoutes } from './routes/team-views';
import { templateRoutes } from './routes/templates';
import { trashRoutes } from './routes/trash';
import { twoFactorRoutes } from './routes/two-factor';
import { yaraRoutes } from './routes/yara';

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Limite de tentativas so nas rotas que pedem (config.rateLimit da rota).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  // WebSocket usado pelo console do sandbox. O noVNC exige o subprotocolo
  // "binary" no handshake, entao negociamos ele aqui.
  await app.register(websocket, {
    options: {
      handleProtocols: (protocols: Set<string>) => (protocols.has('binary') ? 'binary' : false),
      maxPayload: 16 * 1024 * 1024,
    },
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'deeplook-api',
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(sessionRoutes);
  await app.register(favoritesRoutes);
  await app.register(relatedRoutes);
  await app.register(iocRoutes);
  await app.register(notificationRoutes);
  await app.register(templateRoutes);
  await app.register(duplicateRoutes);
  await app.register(dashboardRoutes);
  await app.register(entryRoutes);
  await app.register(reportRoutes);
  await app.register(evidenceRoutes);
  // Atribuicao automatica (item 72).
  await app.register(assignmentRoutes);
  // Relatorio gerencial (item 77).
  await app.register(managementRoutes);
  // Importar indicadores (item 78).
  await app.register(iocImportRoutes);
  await app.register(reputationRoutes);
  await app.register(antivirusRoutes);
  await app.register(attackRoutes);
  await app.register(compareRoutes);
  await app.register(teamViewRoutes);
  await app.register(kbRoutes);
  await app.register(caseRoutes);
  await app.register(allowlistRoutes);
  await app.register(searchRoutes);
  await app.register(yaraRoutes);
  await app.register(hexRoutes);
  await app.register(adminRoutes);
  await app.register(apiTokenRoutes);
  await app.register(trashRoutes);
  await app.register(twoFactorRoutes);
  await app.register(sandboxRoutes);

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Rota nao encontrada.' });
  });

  app.setErrorHandler((error, req, reply) => {
    req.log.error({ err: error }, 'Erro na requisicao');
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message ?? 'Erro na requisicao.' });
    }
    return reply.code(500).send({ error: 'Erro interno do servidor.' });
  });

  // IOCs dos relatorios publicados ainda nao indexados (aba Relacionadas).
  try {
    const indexed = await backfillReportIocs();
    if (indexed) app.log.info({ indexed }, 'IOCs de relatorios indexados');
  } catch (err) {
    app.log.error({ err }, 'Falha ao indexar IOCs dos relatorios');
  }

  // Garante o bucket do MinIO (com tentativas, pois pode demorar a subir).
  try {
    await ensureBucket();
  } catch (err) {
    app.log.error({ err }, 'Falha ao garantir bucket do MinIO');
  }

  // Retencao de amostras: expurgo do arquivo apos RETENTION_DAYS (0 = desligada).
  startRetention(app.log);
  if (env.RETENTION_DAYS) {
    app.log.info(
      `[retencao] ligada: arquivos expurgados ${env.RETENTION_DAYS} dia(s) após a conclusão`,
    );
  }

  // YARA retroativo interrompido por reinicio: marcado como falha (nao continua sozinho).
  const interrupted = await failInterruptedRetroscans();
  if (interrupted)
    app.log.warn(`[yara] ${interrupted} varredura(s) retroativa(s) interrompida(s).`);

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`DeepLook API ouvindo em http://0.0.0.0:${env.PORT}`);

  // TLSH das amostras antigas (item 71), em segundo plano.
  void backfillTlsh(app.log);

  // Escalonamento por prazo (item 73): avisos de alerta/atraso a cada 5 minutos.
  startSlaEscalation(app.log);

  // Sandbox: recupera provisionamentos travados, limpa orfaos e liga o reaper,
  // em segundo plano (o Proxmox fora do ar nao segura o login).
  if (sandboxEnabled) {
    app.log.info(
      `[sandbox] habilitado (node ${env.PROXMOX_NODE}, template ${env.PROXMOX_TEMPLATE_VMID}, ttl ${env.SANDBOX_TTL_MINUTES}min${env.PROXMOX_MOCK === 'true' ? ', MOCK' : ''}); limpeza inicial em andamento`,
    );
    void initSandbox(app.log);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
