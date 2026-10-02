import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env, sandboxEnabled } from './env';
import { prisma } from './lib/prisma';
import { ensureBucket } from './lib/s3';
import { reconcileOrphans, recoverStuckSessions, startSandboxReaper } from './lib/sandbox';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { entryRoutes } from './routes/entries';
import { reportRoutes } from './routes/reports';
import { sandboxRoutes } from './routes/sandbox';

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
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
  await app.register(entryRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);
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

  // Garante o bucket do MinIO (com tentativas, pois pode demorar a subir).
  try {
    await ensureBucket();
  } catch (err) {
    app.log.error({ err }, 'Falha ao garantir bucket do MinIO');
  }

  // Sandbox: recupera provisionamentos travados, limpa orfaos e liga o reaper.
  if (sandboxEnabled) {
    try {
      const stuck = await recoverStuckSessions();
      if (stuck) app.log.warn(`[sandbox] ${stuck} provisionamento(s) travado(s) marcados como falha.`);
      const orphans = await reconcileOrphans();
      if (orphans.vms || orphans.isos) {
        app.log.warn(
          `[sandbox] limpeza inicial: ${orphans.vms} VM(s) e ${orphans.isos} ISO(s) removidos.`,
        );
      }
      startSandboxReaper();
      app.log.info(
        `[sandbox] habilitado (node ${env.PROXMOX_NODE}, template ${env.PROXMOX_TEMPLATE_VMID}, ttl ${env.SANDBOX_TTL_MINUTES}min${env.PROXMOX_MOCK === 'true' ? ', MOCK' : ''})`,
      );
    } catch (err) {
      app.log.error({ err }, '[sandbox] falha ao inicializar o sandbox');
    }
  }

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`DeepLook API ouvindo em http://0.0.0.0:${env.PORT}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
