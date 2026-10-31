import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { broadcastRoutes } from '../../src/routes/broadcasts';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  for (const r of [authRoutes, broadcastRoutes]) await app.register(r);
  await app.ready();
  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
    ['cid@x.io', 'USER'],
  ] as const) {
    ids[email] = (
      await prisma.user.create({
        data: {
          email,
          displayName: email.split('@')[0],
          role,
          passwordHash: await hashPassword('senha-123!'),
        },
      })
    ).id;
  }
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
  const [cAna, cBob, cCid] = await Promise.all(['ana@x.io', 'bob@x.io', 'cid@x.io'].map(login));
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const active = async (c: string) =>
    (await req('GET', '/api/broadcasts/active', c)).json().items as {
      id: string;
      text: string;
      level: string;
      case: { code: string } | null;
    }[];

  // 1. Publicar.
  ok(
    'usuário comum não publica',
    (await req('POST', '/api/broadcasts', cBob, { text: 'Aviso qualquer', hours: 4 }))
      .statusCode === 403,
  );
  let r = await req('POST', '/api/broadcasts', cAna, { text: 'oi', hours: 4 });
  ok('texto curto = 400', r.statusCode === 400 && Boolean(r.json().details?.text));
  ok(
    'validade fora do limite = 400',
    (await req('POST', '/api/broadcasts', cAna, { text: 'Aviso de teste', hours: 1000 }))
      .statusCode === 400,
  );
  const cs = await prisma.case.create({ data: { title: 'Campanha do boleto' } });
  r = await req('POST', '/api/broadcasts', cAna, {
    text: 'Campanha do boleto vencido em andamento',
    level: 'WARNING',
    hours: 24,
    caseId: cs.id,
  });
  const b1 = r.json().item;
  ok(
    'publica com caso e validade',
    r.statusCode === 201 &&
      b1.case?.code === 'CASO-0001' &&
      new Date(b1.expiresAt).getTime() - Date.now() > 23 * 3600 * 1000,
    b1,
  );
  ok(
    'caso inexistente = 400',
    (
      await req('POST', '/api/broadcasts', cAna, {
        text: 'Outro aviso',
        hours: 4,
        caseId: 'naoexiste',
      })
    ).statusCode === 400,
  );
  const b2 = (
    await req('POST', '/api/broadcasts', cAna, { text: 'Manutenção às 22h', hours: 4 })
  ).json().item;

  // 2. Ativos, ordem (alerta primeiro) e dispensa por pessoa.
  let list = await active(cBob);
  ok(
    'todos veem os ativos, alerta primeiro',
    list.length === 2 && list[0].id === b1.id && list[0].level === 'WARNING',
    list,
  );
  ok('dispensar', (await req('POST', `/api/broadcasts/${b1.id}/dismiss`, cBob)).statusCode === 200);
  ok(
    'dispensar de novo não quebra',
    (await req('POST', `/api/broadcasts/${b1.id}/dismiss`, cBob)).statusCode === 200,
  );
  list = await active(cBob);
  ok(
    'dispensado some só para quem dispensou',
    list.length === 1 && list[0].id === b2.id && (await active(cCid)).length === 2,
  );
  ok(
    'dispensar inexistente = 404',
    (await req('POST', '/api/broadcasts/naoexiste/dismiss', cBob)).statusCode === 404,
  );

  // 3. Limite de 3 ativos.
  await req('POST', '/api/broadcasts', cAna, { text: 'Terceiro aviso', hours: 4 });
  r = await req('POST', '/api/broadcasts', cAna, { text: 'Quarto aviso', hours: 4 });
  ok(
    'no máximo 3 ativos = 409',
    r.statusCode === 409 && r.json().error.includes('3 avisos ativos'),
    r.json(),
  );

  // 4. Encerrar.
  ok(
    'usuário comum não encerra',
    (await req('POST', `/api/broadcasts/${b2.id}/end`, cBob)).statusCode === 403,
  );
  ok('encerrar', (await req('POST', `/api/broadcasts/${b2.id}/end`, cAna)).statusCode === 200);
  ok('encerrado some de todos', !(await active(cCid)).some((b) => b.id === b2.id));
  ok(
    'encerrar de novo = 404',
    (await req('POST', `/api/broadcasts/${b2.id}/end`, cAna)).statusCode === 404,
  );
  ok(
    'agora cabe outro',
    (await req('POST', '/api/broadcasts', cAna, { text: 'Quarto aviso', hours: 4 })).statusCode ===
      201,
  );

  // 5. Gestao: ativos e encerrados, com quantos dispensaram.
  const all = (await req('GET', '/api/broadcasts', cAna)).json().items as {
    id: string;
    active: boolean;
    _count: { dismissals: number };
  }[];
  ok(
    'gestão lista ativos e encerrados',
    all.length === 4 &&
      all.find((b) => b.id === b2.id)?.active === false &&
      all.find((b) => b.id === b1.id)?._count.dismissals === 1,
    all,
  );
  ok(
    'usuário comum não vê a gestão',
    (await req('GET', '/api/broadcasts', cBob)).statusCode === 403,
  );

  // 6. Vencido some sozinho.
  await prisma.broadcast.update({
    where: { id: b1.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  ok('vencido some', !(await active(cCid)).some((b) => b.id === b1.id));

  // 7. Caso so para analistas (item 100).
  const withCase = await prisma.broadcast.create({
    data: {
      text: 'Aviso com caso',
      caseId: cs.id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const seen = (list: { id: string; case: unknown }[]) => list.find((b) => b.id === withCase.id);
  const forUser = seen(await active(cCid));
  ok(
    'usuário comum recebe o aviso sem o caso',
    Boolean(forUser) && forUser?.case === null,
    forUser,
  );
  ok('analista recebe o caso', Boolean(seen(await active(cAna))?.case));

  // 8. Limite com publicacoes simultaneas (item 111).
  await prisma.broadcast.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  const posts = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((i) =>
      req('POST', '/api/broadcasts', cAna, { text: `Aviso paralelo ${i}`, hours: 4 }),
    ),
  );
  ok(
    'três simultâneos passam, os outros 409',
    posts.filter((p) => p.statusCode === 201).length === 3 &&
      posts.filter((p) => p.statusCode === 409).length === 3,
    posts.map((p) => p.statusCode),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
