import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { sandboxRoutes } from '../../src/routes/sandbox';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// O WebSocket do console autentica por conta propria, fora do requireUser.
async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  await app.register(authRoutes);
  await app.register(sandboxRoutes);
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const mk = (email: string, mustChangePassword: boolean) =>
    prisma.user.create({
      data: { email, displayName: 'Ana', role: 'ANALYST', passwordHash, mustChangePassword },
    });
  await mk('livre@x.io', false);
  await mk('troca@x.io', true);
  const login = async (email: string) =>
    String(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senha-123!' },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
  const closeReason = async (headers: Record<string, string>) => {
    const ws = await app.injectWS('/api/sandbox/qualquer/console/ws', { headers });
    return new Promise<string>((res) => ws.on('close', (_c, reason) => res(String(reason))));
  };

  ok('sem sessão: recusado', (await closeReason({})) === 'nao autenticado');
  // Sandbox desligado no teste: passar da checagem da conta chega neste motivo.
  const free = await closeReason({ cookie: await login('livre@x.io') });
  ok('conta normal passa da checagem', free === 'sandbox desabilitado', free);
  const forced = await closeReason({ cookie: await login('troca@x.io') });
  ok('senha a trocar: recusado', forced === 'defina uma nova senha', forced);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
