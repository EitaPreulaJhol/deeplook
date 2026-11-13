import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp, ROUTES } from '../../src/app';
import { CROSS_SITE_ERROR } from '../../src/lib/cross-site';

// Plano pos-revisao, item 1.3: o app que os testes usam e o mesmo da producao (src/app.ts).

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  // 1. Toda rota de src/routes esta em ROUTES: arquivo novo esquecido fora da lista nao responderia
  // em producao, e os testes (que usam o mesmo app) mostrariam.
  const dir = join(__dirname, '..', '..', 'src', 'routes');
  const exported = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) =>
      [...readFileSync(join(dir, f), 'utf8').matchAll(/export async function (\w+Routes)\(/g)].map(
        (m) => m[1],
      ),
    );
  const registered = new Set(ROUTES.map((r) => r.name));
  const missing = exported.filter((name) => !registered.has(name));
  ok('toda rota de src/routes registrada', missing.length === 0, missing);
  ok('sem rota repetida', registered.size === ROUTES.length);

  const app = await buildApp();
  await app.ready();

  // 2. 404 padrao, no idioma de quem pede.
  const lost = await app.inject({ method: 'GET', url: '/api/nao-existe' });
  ok(
    '404 da API',
    lost.statusCode === 404 && lost.json().error === 'Rota nao encontrada.',
    lost.body,
  );
  const lostEn = await app.inject({
    method: 'GET',
    url: '/api/nao-existe',
    headers: { 'accept-language': 'en' },
  });
  ok('404 em inglês', lostEn.json().error === 'Route not found.', lostEn.body);

  // 3. Erro de uma rota, traduzido pelo gancho de idioma.
  const anon = await app.inject({
    method: 'GET',
    url: '/api/me/updates',
    headers: { 'accept-language': 'en' },
  });
  ok(
    'sem sessão: 401 em inglês',
    anon.statusCode === 401 && anon.json().error === 'Not authenticated.',
    anon.body,
  );

  // 4. Pedido que muda estado vindo de outro site: recusado antes de qualquer rota.
  const cross = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'sec-fetch-site': 'cross-site' },
    payload: { email: 'a@b.c', password: 'x' },
  });
  ok(
    'pedido de outro site recusado',
    cross.statusCode === 403 && cross.json().error === CROSS_SITE_ERROR,
    cross.body,
  );

  // 5. Corpo JSON invalido: o tratador de erro da producao responde no formato da API.
  const broken = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: '{',
  });
  ok(
    'JSON quebrado: 400 com { error } (tratador da produção)',
    broken.statusCode === 400 &&
      typeof broken.json().error === 'string' &&
      broken.json().statusCode === undefined,
    broken.body,
  );

  // 6. Erro inesperado numa rota: 500 generico, sem a mensagem interna (antes saia inteira).
  const probe = await buildApp({
    beforeRoutes: (a) => {
      a.get('/api/teste/falha', async () => {
        throw new Error('detalhe interno: tabela X');
      });
    },
  });
  const boom = await probe.inject({ method: 'GET', url: '/api/teste/falha' });
  ok(
    'erro inesperado: 500 genérico, sem a mensagem interna',
    boom.statusCode === 500 &&
      boom.json().error === 'Erro interno do servidor.' &&
      !boom.body.includes('tabela X'),
    boom.body,
  );
  await probe.close();

  await app.close();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
