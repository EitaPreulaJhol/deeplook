import { readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { deleteExpiredSessions } from '../../src/lib/auth';
import { cleanStaleWorkDirs } from '../../src/lib/backup';
import { hashPassword } from '../../src/lib/crypto';
import { matchLookalike } from '../../src/lib/lookalike';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import {
  enterUpload,
  spoolGate,
  UploadGate,
  uploadGate,
  uploadLimits,
} from '../../src/lib/upload-gate';
import { SPOOL_PREFIX } from '../../src/lib/upload-spool';
import { entryRoutes } from '../../src/routes/entries';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

/** Envios que estao (ou sobraram) no disco. */
const spooled = () => readdirSync(tmpdir()).filter((name) => name.startsWith(SPOOL_PREFIX));

async function main() {
  await ensureBucket(3, 500);
  const app = await buildApp();
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

  // Memoria cheia: o corpo ja chegou (esta no disco), entao o envio espera a vez; so depois do
  // tempo de espera responde 503 (revisao de novembro, 2.3).
  uploadLimits.waitMs = 300;
  const hold = uploadGate.tryAcquire(uploadGate.budget);
  const busy = await send();
  ok(
    'memória cheia até o fim da espera: 503 com o aviso',
    busy.statusCode === 503 &&
      busy.headers['retry-after'] === '30' &&
      busy.json().error.includes('Tente de novo'),
    busy.body,
  );
  ok('503: nada ficou no disco nem reservado', spooled().length === 0 && spoolGate.inUse === 0, {
    files: spooled(),
    disk: spoolGate.inUse,
  });
  uploadLimits.waitMs = 5000;
  const waited = send({}, 'esperou a vez');
  setTimeout(() => hold?.(), 150);
  ok('memória liberada durante a espera: o envio entra', (await waited).statusCode === 201);
  ok('amostra só das aceitas', (await prisma.entry.count()) === 2);

  // Disco cheio (o que esta chegando): 503 na hora, antes de ler o corpo.
  const holdDisk = spoolGate.tryAcquire(spoolGate.budget);
  ok('orçamento de disco cheio: 503', (await send()).statusCode === 503);
  holdDisk?.();

  // Cada pessoa ocupa no maximo uma parte do disco com o que esta chegando: muitos envios
  // pequenos ao mesmo tempo entram, envios grandes e lentos de uma pessoa so, nao.
  const share = spoolGate.budget * uploadLimits.perUserShare;
  const big = enterUpload(user.id, share);
  const capped = await send();
  ok(
    'pessoa com a parte dela do disco ocupada: 429',
    Boolean(big) && capped.statusCode === 429 && capped.json().error.includes('em andamento'),
    capped.body,
  );
  ok('a parte é por pessoa', Boolean(enterUpload('outra-pessoa', share)));
  big?.();
  ok('parte devolvida: entra', (await send({}, 'depois do teto')).statusCode === 201);
  const many = await Promise.all(Array.from({ length: 12 }, (_, i) => send({}, `em lote ${i}`)));
  ok(
    'doze envios pequenos ao mesmo tempo entram',
    many.every((r) => r.statusCode === 201),
    many.map((r) => r.statusCode),
  );
  ok(
    'um envio sozinho sempre entra, mesmo maior que a parte',
    Boolean(enterUpload('pessoa-nova', share * 3)),
  );
  ok('nada sobra no disco depois dos envios', spooled().length === 0, spooled());
  ok('orçamentos zerados', uploadGate.inUse === 0 && spoolGate.inUse === 0);

  // Envio lento, por HTTP de verdade: enquanto o corpo chega, ocupa disco e nao memoria. Era o
  // defeito: tres envios lentos de 200 MB seguravam o orcamento de memoria de todo mundo.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const slowBody = body('conteudo que chega devagar');
  const payload = Buffer.from(slowBody.payload);
  const during = await new Promise<{ memory: number; disk: number; files: number; status: number }>(
    (resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/entries/file',
          method: 'POST',
          headers: { ...slowBody.headers, 'content-length': payload.length },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ ...seen, status: res.statusCode ?? 0 }));
        },
      );
      request.on('error', reject);
      let seen = { memory: -1, disk: -1, files: -1 };
      // Metade do corpo, uma pausa em que se mede, e o resto.
      request.write(payload.subarray(0, payload.length - 20));
      setTimeout(() => {
        seen = { memory: uploadGate.inUse, disk: spoolGate.inUse, files: spooled().length };
        request.end(payload.subarray(payload.length - 20));
      }, 400);
    },
  );
  ok(
    'envio lento: enquanto chega, reserva disco e nenhuma memória',
    during.status === 201 &&
      during.memory === 0 &&
      during.disk === payload.length &&
      during.files === 1,
    during,
  );
  ok('envio lento: no fim, nada sobra', spooled().length === 0 && spoolGate.inUse === 0);

  // Arquivo que passa do limite sem declarar o tamanho certo: o multipart corta o fluxo, e o que
  // ja foi para o disco e apagado. Outra instancia, com o limite em 1 KB, para nao enviar 200 MB:
  // a unica montagem fora do buildApp() neste arquivo (o limite do multipart vem do .env).
  const small = Fastify();
  await small.register(cookie, { secret: env.SESSION_SECRET });
  await small.register(rateLimit, { global: false });
  await small.register(multipart, { limits: { fileSize: 1024, files: 1 } });
  await small.register(entryRoutes);
  await small.ready();
  const over = body('x'.repeat(5000));
  const cut = await small.inject({ method: 'POST', url: '/api/entries/file', ...over });
  ok('acima do limite no meio do corpo: 413', cut.statusCode === 413, cut.body);
  ok(
    '413 no meio: nada sobra no disco nem reservado',
    spooled().length === 0 && uploadGate.inUse === 0 && spoolGate.inUse === 0,
    spooled(),
  );
  await small.close();

  // Sobra de uma queda no meio do envio: apagada na subida, com as pastas do backup e do ISO.
  writeFileSync(join(tmpdir(), `${SPOOL_PREFIX}sobra-de-teste`), 'x');
  await cleanStaleWorkDirs();
  ok('subida apaga o envio que sobrou de uma queda', spooled().length === 0, spooled());

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
  // Erros em ingles para quem pede (revisao de novembro, 2.5): a interface manda o idioma dela.
  const missingEn = await app.inject({
    method: 'GET',
    url: '/api/entries/naoexiste',
    headers: { cookie: cAna, 'accept-language': 'en' },
  });
  ok(
    'erro em inglês com Accept-Language: en',
    missingEn.json().error === 'Sample not found.',
    missingEn.body,
  );
  const invalidEn = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
    payload: { email: 'a@x.io', password: 'errada' },
  });
  ok('login recusado em inglês', invalidEn.json().error === 'Invalid credentials.', invalidEn.body);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
