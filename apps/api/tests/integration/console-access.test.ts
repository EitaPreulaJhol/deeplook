import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { FailureWindow } from '../../src/lib/rate-limit';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// O WebSocket do console autentica por conta propria, fora do requireUser.
async function main() {
  // trustProxy desligado: o injectWS simula a conexao sem socket, e com o trustProxy (como na
  // producao) o Fastify le o endereco do socket para calcular o IP. Na producao ele sempre existe.
  const app = await buildApp({ trustProxy: false });
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

  // Banco fora na abertura: o loadUser rejeita fora de qualquer try. Sem o catch, a rejeicao
  // ficava sem tratamento (o Node encerraria a API); agora o console fecha com erro interno.
  const cookieHeader = await login('livre@x.io');
  let unhandled: unknown = null;
  const onUnhandled = (reason: unknown) => (unhandled = reason);
  process.on('unhandledRejection', onUnhandled);
  const delegate = prisma.session as unknown as { findUnique: unknown };
  const findUnique = delegate.findUnique;
  delegate.findUnique = () => Promise.reject(new Error('banco fora'));
  const down = await closeReason({ cookie: cookieHeader });
  await new Promise((res) => setTimeout(res, 50));
  delegate.findUnique = findUnique;
  process.off('unhandledRejection', onUnhandled);
  ok(
    'banco fora ao abrir o console: fecha com erro interno, sem rejeição sem tratamento',
    down === 'erro interno' && unhandled === null,
    { down, unhandled: String(unhandled) },
  );

  // Janela de falhas do login: chaves vencidas saem na varredura (nao crescem sem teto).
  const window = new FailureWindow(3, 1000);
  for (let i = 0; i < 6000; i++) window.note(`a${i}@x.io`, 0);
  window.note('novo@x.io', 5000);
  ok('janela de falhas: as chaves vencidas são varridas', window.size === 1, window.size);
  ok('janela de falhas: a contagem recente continua valendo', !window.exceeded('novo@x.io', 5000));

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
