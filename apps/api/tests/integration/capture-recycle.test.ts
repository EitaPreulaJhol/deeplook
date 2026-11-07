import http from 'node:http';
import type { AddressInfo } from 'node:net';

// A captura roda num container novo a cada pedido (item 6.17): entre um e outro, o servico
// recusa conexao ou responde 503, e a API espera a vez em vez de falhar.
let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Porta livre agora (ninguem ouvindo nela ate o servico falso subir). */
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((res) => probe.listen(0, '127.0.0.1', res));
  const { port } = probe.address() as AddressInfo;
  await new Promise((res) => probe.close(res));
  return port;
}

/** Servico falso: `busy` respostas 503 antes de atender; conta os pedidos. */
function fakeService(port: number, busy: number, body: object) {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen++;
      if (seen <= busy) {
        res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"troca"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  return {
    start: () => new Promise<void>((res) => server.listen(port, '127.0.0.1', res)),
    stop: () => new Promise((res) => server.close(res)),
    seen: () => seen,
  };
}

async function main() {
  const port = await freePort();
  process.env.CAPTURE_URL = `http://127.0.0.1:${port}`;
  process.env.CAPTURE_TOKEN = '0123456789abcdef01';
  const { requestCapture, runCapture } = await import('../../src/lib/page-capture');
  const { prisma } = await import('../../src/lib/prisma');
  const { hashPassword } = await import('../../src/lib/crypto');

  // 1. Servico fora do ar (container trocando), depois 503, depois atende.
  const service = fakeService(port, 2, { ok: false, error: 'teste' });
  const started = Date.now();
  const pending = requestCapture('https://exemplo.test/', { retryEveryMs: 200 });
  await sleep(1000);
  await service.start();
  const res = await pending;
  ok('espera o container subir e passar do 503', res.status === 200, res.status);
  ok('tentou de novo a cada 503', service.seen() === 3, service.seen());
  ok('esperou enquanto não havia conexão', Date.now() - started >= 1000);

  // 2. Servico sempre ocupado: devolve o 503 quando a espera acaba.
  const always = await (async () => {
    await service.stop();
    const busy = fakeService(port, Number.MAX_SAFE_INTEGER, {});
    await busy.start();
    const t = Date.now();
    const r = await requestCapture('https://exemplo.test/', { waitMs: 800, retryEveryMs: 200 });
    const elapsed = Date.now() - t;
    await busy.stop();
    return { status: r.status, elapsed, seen: busy.seen() };
  })();
  ok(
    'serviço sempre ocupado: 503 no fim da espera',
    always.status === 503 && always.elapsed >= 800 && always.seen >= 3,
    always,
  );

  // 3. Ninguem sobe: o erro de conexao sai no fim da espera.
  const t = Date.now();
  const down = await requestCapture('https://exemplo.test/', {
    waitMs: 600,
    retryEveryMs: 200,
  }).then(
    () => 'respondeu',
    (err: Error) => (err.cause as { code?: string } | undefined)?.code ?? err.message,
  );
  ok(
    'serviço fora do ar: desiste no fim da espera',
    down === 'ECONNREFUSED' && Date.now() - t >= 600,
    down,
  );

  // 4. O servico recebe o pedido e cai no meio (uma pagina que estoura a memoria leva o
  // container junto): uma nova tentativa so, e nao uma visita a cada reinicio ate a espera acabar.
  let crashes = 0;
  const crashing = http.createServer((req, res) => {
    crashes++;
    req.resume();
    setTimeout(() => res.socket?.destroy(), 50);
  });
  await new Promise<void>((res) => crashing.listen(port, '127.0.0.1', res));
  const crashed = await requestCapture('https://pagina-que-derruba.test/', {
    waitMs: 3000,
    retryEveryMs: 100,
  }).then(
    () => 'respondeu',
    (err: Error) => (err.cause as { code?: string } | undefined)?.code ?? err.message,
  );
  await new Promise((res) => crashing.close(res));
  ok(
    'serviço cai no meio da captura: só uma nova tentativa',
    ['UND_ERR_SOCKET', 'ECONNRESET'].includes(crashed) && crashes === 2,
    { crashed, crashes },
  );

  // 5. Ponta a ponta: a captura fica pronta mesmo com o container trocando no comeco.
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const real = fakeService(port, 1, {
    ok: true,
    finalUrl: 'https://exemplo.test/final',
    title: 'Exemplo',
    status: 200,
    redirects: [{ url: 'https://exemplo.test/', status: 200 }],
    html: '<html>oi</html>',
    screenshot: png,
    blocked: [],
  });
  await real.start();
  const user = await prisma.user.create({
    data: {
      email: 'analista@x.io',
      displayName: 'Ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('Senha-Forte-123!'),
    },
  });
  const entry = await prisma.entry.create({
    data: { ownerId: user.id, type: 'URL', title: 'link', url: 'https://exemplo.test/' },
  });
  const capture = await prisma.pageCapture.create({
    data: { entryId: entry.id, requestedById: user.id, url: entry.url! },
  });
  await runCapture(capture.id, { error: () => undefined });
  const done = await prisma.pageCapture.findUnique({ where: { id: capture.id } });
  ok(
    'captura pronta depois de um 503',
    done?.status === 'DONE' && done.title === 'Exemplo' && real.seen() === 2,
    { status: done?.status, error: done?.error, seen: real.seen() },
  );
  await real.stop();

  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
