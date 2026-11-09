import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env, sandboxEnabled } from './env';
import { startSessionCleanup, TRUST_PROXY } from './lib/auth';
import { startBackups } from './lib/backup';
import { startBackupSchedule } from './lib/backup-schedule';
import { startCapaQueue } from './lib/capa';
import { installCrossSiteGuard } from './lib/cross-site';
import { startGhidraQueue } from './lib/ghidra';
import { startIntegrityScrub } from './lib/integrity-scrub';
import { reindexIocs } from './lib/ioc-reindex';
import { backfillReportIocs } from './lib/iocs';
import { startLdapSweep } from './lib/ldap-sweep';
import { setLogger } from './lib/log';
import { network } from './lib/network';
import { failInterruptedCaptures } from './lib/page-capture';
import { backfillPeAnalysis } from './lib/pe-backfill';
import { prisma } from './lib/prisma';
import { requestLogSerializer } from './lib/request-log';
import { startRetention } from './lib/retention';
import { ensureBucket, isMissingObject, MISSING_OBJECT_MESSAGE } from './lib/s3';
import { initSandbox } from './lib/sandbox';
import { startSlaEscalation } from './lib/sla-escalation';
import { backfillTlsh } from './lib/tlsh-backfill';
import { startUnpackQueue } from './lib/unpack';
import { installYaraPacks } from './lib/yara-packs';
import { failInterruptedRetroscans } from './lib/yara-retro';
import { startYaraPackUpdates } from './lib/yara-update';
import { adminRoutes } from './routes/admin';
import { allowlistRoutes } from './routes/allowlist';
import { antivirusRoutes } from './routes/antivirus';
import { apiTokenRoutes } from './routes/api-tokens';
import { assignmentRoutes } from './routes/assignment';
import { attackRoutes } from './routes/attack';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { broadcastRoutes } from './routes/broadcasts';
import { capaRoutes } from './routes/capa';
import { captureRoutes } from './routes/captures';
import { caseRoutes } from './routes/cases';
import { companyDomainRoutes } from './routes/company-domains';
import { compareRoutes } from './routes/compare';
import { dashboardRoutes } from './routes/dashboard';
import { duplicateRoutes } from './routes/duplicates';
import { entryRoutes, unpackChildCreator } from './routes/entries';
import { evidenceRoutes } from './routes/evidence';
import { favoritesRoutes } from './routes/favorites';
import { feedRoutes } from './routes/feeds';
import { ghidraRoutes } from './routes/ghidra';
import { graphRoutes } from './routes/graph';
import { healthRoutes } from './routes/health';
import { hexRoutes } from './routes/hex';
import { iocImportRoutes } from './routes/ioc-import';
import { iocRoutes } from './routes/iocs';
import { kbRoutes } from './routes/kb';
import { managementRoutes } from './routes/management';
import { meRoutes } from './routes/me';
import { notificationRoutes } from './routes/notifications';
import { openApiRoutes } from './routes/openapi';
import { relatedRoutes } from './routes/related';
import { reportRoutes } from './routes/reports';
import { reputationRoutes } from './routes/reputation';
import { sandboxRoutes } from './routes/sandbox';
import { searchRoutes } from './routes/search';
import { sessionRoutes } from './routes/sessions';
import { settingsRoutes } from './routes/settings';
import { statusRoutes } from './routes/status';
import { teamViewRoutes } from './routes/team-views';
import { templateRoutes } from './routes/templates';
import { trashRoutes } from './routes/trash';
import { triageRuleRoutes } from './routes/triage-rules';
import { twoFactorRoutes } from './routes/two-factor';
import { unpackRoutes } from './routes/unpack';
import { yaraRoutes } from './routes/yara';

async function main() {
  const app = Fastify({
    logger: { serializers: { req: requestLogSerializer } },
    trustProxy: TRUST_PROXY,
    bodyLimit: 5 * 1024 * 1024,
  });

  // Trabalhos de fundo (bucket, retencao, backup, sandbox) escrevem no logger
  // do Fastify a partir daqui, e nao mais em texto solto no console (item 1.3).
  setLogger(app.log);

  // So a rede confiavel (o nginx e os servicos da rede deeplook) conecta na API: o navegador
  // isolado da captura, na outra rede, deixa de alcanca-la (src/lib/network.ts).
  network.guard(app.server, app.log);
  if (network.networks.length) {
    app.log.info({ trusted: network.networks }, '[rede] conexoes so da rede confiavel');
  } else {
    app.log.warn('[rede] TRUSTED_NETWORK vazio: a API aceita conexao de qualquer rede privada');
  }
  // Pedido que muda estado vindo de outro site (CSRF), antes de qualquer rota.
  installCrossSiteGuard(app);

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

  // Liveness (/api/health) e readiness (/api/health/ready), item 1.2.
  await app.register(healthRoutes);

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(sessionRoutes);
  await app.register(favoritesRoutes);
  await app.register(relatedRoutes);
  // Mapa de relacoes (item 91).
  await app.register(graphRoutes);
  // Dominios parecidos com os da empresa (item 92).
  await app.register(companyDomainRoutes);
  // Documentacao da API (item 93).
  await app.register(openApiRoutes);
  // Backup em ZIP (item 81).
  await app.register(backupRoutes);
  // Status do sistema por maquina, com token de escopo STATUS (item 3.2).
  await app.register(statusRoutes);
  // Configuracoes do sistema (item 140).
  await app.register(settingsRoutes);
  await app.register(iocRoutes);
  await app.register(notificationRoutes);
  await app.register(templateRoutes);
  await app.register(duplicateRoutes);
  await app.register(dashboardRoutes);
  await app.register(entryRoutes);
  await app.register(reportRoutes);
  await app.register(evidenceRoutes);
  // Regras de triagem (item 86).
  await app.register(triageRuleRoutes);
  // Avisos gerais (item 88).
  await app.register(broadcastRoutes);
  // Atribuicao automatica (item 72).
  await app.register(assignmentRoutes);
  // Captura da pagina de um link (item 80).
  await app.register(captureRoutes);
  await app.register(capaRoutes);
  await app.register(ghidraRoutes);
  await app.register(unpackRoutes);
  // Relatorio gerencial (item 77).
  await app.register(managementRoutes);
  // Importar indicadores (item 78).
  await app.register(iocImportRoutes);
  // Feed de indicadores (item 5.3): TAXII 2.1 e feed MISP, para um TIP ou SIEM buscar.
  await app.register(feedRoutes);
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
    if (isMissingObject(error)) {
      return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    }
    req.log.error({ err: error }, 'Erro na requisicao');
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: err.message ?? 'Erro na requisição.' });
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

  // Pacotes de regras YARA (item 143): instala os ligados que ainda nao instalaram.
  try {
    const installed = await installYaraPacks();
    if (installed.length) app.log.info({ installed }, 'Pacotes de regras YARA instalados');
  } catch (err) {
    app.log.error({ err }, 'Falha ao instalar os pacotes de regras YARA');
  }

  startYaraPackUpdates(app.log);

  // Retencao de amostras: expurgo do arquivo apos RETENTION_DAYS (0 = desligada).
  startRetention(app.log);
  // Conferencia de integridade dos arquivos guardados, em segundo plano (item 4.2).
  startIntegrityScrub();
  startBackups(app.log);
  // Backup agendado (item 6.13): confere a cada minuto se chegou a hora.
  startBackupSchedule();
  startLdapSweep(app.log);
  startSessionCleanup(app.log);

  // Desligamento controlado (item 119): termina o que esta em andamento, com teto.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info(`${signal}: encerrando`);
      setTimeout(() => process.exit(1), 15_000).unref();
      void app.close().then(() => process.exit(0));
    });
  }
  if (env.RETENTION_DAYS) {
    app.log.info(
      `[retencao] ligada: arquivos expurgados ${env.RETENTION_DAYS} dia(s) após a conclusão`,
    );
  }

  // YARA retroativo interrompido por reinicio: marcado como falha (nao continua sozinho).
  const interrupted = await failInterruptedRetroscans();
  if (interrupted)
    app.log.warn(`[yara] ${interrupted} varredura(s) retroativa(s) interrompida(s).`);
  // Captura de pagina interrompida por reinicio (item 80): marcada como falha.
  const captures = await failInterruptedCaptures();
  if (captures) app.log.warn(`[captura] ${captures} captura(s) interrompida(s).`);

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`DeepLook API ouvindo em http://0.0.0.0:${env.PORT}`);

  // TLSH das amostras antigas (item 71) e, depois dele, a reanalise dos executaveis antigos
  // (item 7.1), em segundo plano e um de cada vez.
  void backfillTlsh(app.log).then(() => backfillPeAnalysis(app.log));

  // Analise de funcoes (item 7.2): fila do capa e do FLOSS, um executavel por vez.
  void startCapaQueue(app.log).catch((err) => app.log.error({ err }, '[capa] fila não subiu'));
  // Analise com o Ghidra (item 7.3): fila das analises pedidas, uma por vez.
  void startGhidraQueue(app.log).catch((err) => app.log.error({ err }, '[ghidra] fila não subiu'));
  // Desempacotar e extrair (item 7.8): a fila cria as filhas pelo mesmo caminho de um envio.
  void startUnpackQueue(app.log, unpackChildCreator(app.log)).catch((err) =>
    app.log.error({ err }, '[unpack] fila não subiu'),
  );

  // URL e IPv6 nos indicadores ja gravados (item 165), em segundo plano, uma vez.
  void reindexIocs(app.log);

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
  // Console de proposito: aqui o Fastify pode nem ter chegado a existir.
  console.error('[fatal]', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
