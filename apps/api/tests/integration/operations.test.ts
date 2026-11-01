import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { deleteExpiredSessions } from '../../src/lib/auth';
import { hashPassword } from '../../src/lib/crypto';
import { matchLookalike } from '../../src/lib/lookalike';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { UploadGate, uploadGate } from '../../src/lib/upload-gate';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { meRoutes } from '../../src/routes/me';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  await ensureBucket(3, 500);
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });
  for (const r of [authRoutes, entryRoutes, meRoutes]) await app.register(r);
  await app.ready();
  const user = await prisma.user.create({
    data: {
      email: 'a@x.io',
      displayName: 'a',
      role: 'ANALYST',
      passwordHash: await hashPassword('Senha-Forte-123!'),
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'a@x.io', password: 'Senha-Forte-123!' },
  });
  const cAna = String(login.headers['set-cookie']).split(';')[0];
  const body = (text: string) => {
    const boundary = 'xxBOUNDARYxx';
    return {
      headers: {
        cookie: cAna,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="a.txt"',
        'Content-Type: text/plain',
        '',
        text,
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    };
  };
  const send = (extra: Record<string, string> = {}, text = 'conteudo') => {
    const b = body(text);
    return app.inject({
      method: 'POST',
      url: '/api/entries/file',
      headers: { ...b.headers, ...extra },
      payload: b.payload,
    });
  };

  // 0. Limite por arquivo para a tela de envio (item 129).
  const quota = await app.inject({
    method: 'GET',
    url: '/api/me/upload-quota',
    headers: { cookie: cAna },
  });
  ok(
    'tela recebe o limite por arquivo',
    quota.json().maxUploadMb === env.MAX_UPLOAD_MB,
    quota.body,
  );

  // 0b. Pastas recolhidas do Navegador (item 141).
  const prefs = (payload: object) =>
    app.inject({
      method: 'PATCH',
      url: '/api/me/preferences',
      headers: { cookie: cAna },
      payload,
    });
  const meNow = async () =>
    (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cAna } })).json()
      .user;
  ok('sem nada salvo, tudo aberto', (await meNow()).preferences.closedFolders.length === 0);
  ok(
    'grava as recolhidas',
    (await prefs({ closedFolders: ['filas', 'casos'] })).statusCode === 200,
  );
  ok('volta numa sessão nova', (await meNow()).preferences.closedFolders.join() === 'filas,casos');
  await prefs({ pageSize: 25 });
  ok(
    'outra preferência não mexe',
    (await meNow()).preferences.closedFolders.join() === 'filas,casos',
  );
  ok(
    'lista absurda recusada',
    (await prefs({ closedFolders: Array.from({ length: 31 }, (_, i) => `p${i}`) })).statusCode ===
      400,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { preferences: { closedFolders: 'inválido', pageSize: 25 } },
  });
  ok(
    'valor antigo inválido cai no padrão',
    (await meNow()).preferences.closedFolders.length === 0 &&
      (await meNow()).preferences.pageSize === 25,
  );

  // 1. Orcamento de memoria dos envios (item 117).
  const gate = new UploadGate(100);
  const first = gate.tryAcquire(60);
  ok('reserva o que cabe', Boolean(first) && gate.inUse === 60);
  ok('recusa o que não cabe', gate.tryAcquire(50) === null && gate.inUse === 60);
  first?.();
  first?.();
  ok('libera uma vez só', gate.inUse === 0);

  const done = await send();
  ok('envio normal', done.statusCode === 201, done.body);
  ok('orçamento devolvido ao terminar', uploadGate.inUse === 0, uploadGate.inUse);

  const huge = await send({ 'content-length': String((env.MAX_UPLOAD_MB + 2) * 1024 * 1024) });
  ok('acima do limite: 413 antes de ler', huge.statusCode === 413, huge.statusCode);
  ok('413 não reserva', uploadGate.inUse === 0);

  const hold = uploadGate.tryAcquire(uploadGate.budget);
  const busy = await send();
  ok(
    'orçamento cheio: 503 com o aviso',
    busy.statusCode === 503 &&
      busy.headers['retry-after'] === '30' &&
      busy.json().error.includes('Tente de novo'),
    busy.body,
  );
  hold?.();
  ok('depois de liberar, entra', (await send({}, 'de novo')).statusCode === 201);
  ok('amostra só das aceitas', (await prisma.entry.count()) === 2);

  // 2. Sessoes vencidas (item 118).
  const old = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
  });
  const live = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
  });
  ok('apaga as vencidas', (await deleteExpiredSessions()) >= 1);
  ok('vencida saiu', !(await prisma.session.findUnique({ where: { id: old.id } })));
  ok('ativa ficou', Boolean(await prisma.session.findUnique({ where: { id: live.id } })));

  // 3. Indices das notificacoes (item 118).
  const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'Notification'`;
  const names = indexes.map((i) => i.indexname);
  ok(
    'índices de amostra e caso',
    names.includes('Notification_entryId_idx') && names.includes('Notification_caseId_idx'),
    names,
  );

  // 4. Palavra a mais so se for tipica de golpe (item 121).
  const C = ['empresa.com.br'];
  ok('"empresarial" não é golpe', matchLookalike('empresarial.com', C) === null);
  ok(
    '"bancodobrasil" não é golpe',
    matchLookalike('bancodobrasil.com.br', ['banco.com.br']) === null,
  );
  ok('"empresa-qualquer" não é golpe', matchLookalike('empresa-qualquer.com', C) === null);
  for (const host of [
    'empresa-seguranca.com',
    'loginempresa.top',
    'empresa-suporte.net',
    'contaempresa.top',
  ]) {
    ok(
      `${host} continua marcado`,
      matchLookalike(host, C)?.reason === 'KEYWORD',
      matchLookalike(host, C),
    );
  }

  // 5. Mensagens com acento (item 120).
  const missing = await app.inject({
    method: 'GET',
    url: '/api/entries/naoexiste',
    headers: { cookie: cAna },
  });
  ok('mensagem com acento', missing.json().error === 'Amostra não encontrada.', missing.body);
  const bad = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'a@x.io', password: 'errada' },
  });
  ok('login com acento', bad.json().error === 'Credenciais inválidas.', bad.body);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
