import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { allowedBy, loadAllowlist } from '../../src/lib/allowlist';
import { hashPassword } from '../../src/lib/crypto';
import { syncReportIocs } from '../../src/lib/iocs';
import { matchLookalike } from '../../src/lib/lookalike';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import * as cd from '../../src/routes/company-domains';
import { entryRoutes } from '../../src/routes/entries';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  // 1. Regras (sem banco).
  const C = ['empresa.com.br'];
  const m = (h: string) => matchLookalike(h, C);
  ok(
    'o próprio domínio não',
    m('empresa.com.br') === null &&
      m('login.empresa.com.br') === null &&
      m('www.empresa.com.br') === null,
  );
  ok('outro TLD', m('empresa.com')?.reason === 'TLD' && m('empresa.net.br')?.reason === 'TLD', [
    m('empresa.com'),
    m('empresa.net.br'),
  ]);
  ok('rn no lugar de m', m('ernpresa.com.br')?.reason === 'HOMOGLYPH', m('ernpresa.com.br'));
  ok(
    'cirílico (IDN)',
    m('xn--mpres-2ve5d.com.br')?.reason === 'HOMOGLYPH' ||
      m('еmprеsа.com.br')?.reason === 'HOMOGLYPH',
    m('еmprеsа.com.br'),
  );
  ok(
    'zero no lugar de o / 1 no lugar de l',
    matchLookalike('g00gle.com', ['google.com'])?.reason === 'HOMOGLYPH' &&
      matchLookalike('goog1e.com', ['google.com'])?.reason === 'HOMOGLYPH',
  );
  ok('letra faltando', m('empesa.com.br')?.detail === 'letra faltando', m('empesa.com.br'));
  ok('letra repetida', m('emmpresa.com.br')?.detail === 'letra repetida', m('emmpresa.com.br'));
  ok('letra trocada', m('empreza.com.br')?.detail === 'letra trocada', m('empreza.com.br'));
  ok('letras invertidas', m('emrpesa.com.br')?.detail === 'letras invertidas', m('emrpesa.com.br'));
  ok('hífen a mais', m('em-presa.com.br')?.detail === 'hífen a mais', m('em-presa.com.br'));
  ok(
    'palavra a mais',
    m('empresa-seguranca.com')?.reason === 'KEYWORD' && m('loginempresa.top')?.detail === '"login"',
    [m('empresa-seguranca.com'), m('loginempresa.top')],
  );
  ok(
    'nome no subdomínio',
    m('empresa.com.br.verifica.top')?.reason === 'SUBDOMAIN' &&
      m('empresa-login.evil.top')?.reason !== undefined,
    m('empresa.com.br.verifica.top'),
  );
  ok(
    'sem parecença',
    m('boleto.top') === null && m('exemplo.com') === null && m('10.0.0.1') === null,
  );
  ok('nome curto não vira "palavra a mais"', matchLookalike('itaueira.com', ['ita.com']) === null);

  // 2. API.
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes, cd.companyDomainRoutes]) await app.register(r);
  await app.ready();
  const ids: Record<string, string> = {};
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
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
  const [cAdm, cAna, cBob] = await Promise.all(['adm@x.io', 'ana@x.io', 'bob@x.io'].map(login));
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  // Amostras antes do cadastro: a revarredura acha.
  const link = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'link',
      url: 'https://ernpresa.com.br/login',
      urlDomain: 'ernpresa.com.br',
      ownerId: ids['bob@x.io'],
    },
  });
  const mail = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'mail.eml',
      ownerId: ids['bob@x.io'],
      emailInfo: {
        from: { name: 'RH', address: 'rh@empresa-seguranca.com' },
        sender: null,
        replyTo: [{ name: null, address: 'x@empresa.com.br' }],
        returnPath: null,
        links: ['https://empresa.com.br.verifica.top/a', 'https://ernpresa.com.br/b'],
      },
      staticInfo: { iocCandidates: [{ kind: 'DOMAIN', value: 'empreza.com.br' }] },
    },
  });
  const clean = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'limpo',
      url: 'https://exemplo.com',
      urlDomain: 'exemplo.com',
      ownerId: ids['bob@x.io'],
    },
  });

  ok(
    'analista não cadastra',
    (await req('POST', '/api/company-domains', cAna, { domain: 'empresa.com.br' })).statusCode ===
      403,
  );
  ok(
    'domínio inválido = 400',
    (await req('POST', '/api/company-domains', cAdm, { domain: 'não é domínio' })).statusCode ===
      400,
  );
  const r = await req('POST', '/api/company-domains', cAdm, {
    domain: 'https://www.Empresa.com.br/portal',
  });
  ok(
    'cadastra normalizado',
    r.statusCode === 201 && r.json().item.domain === 'empresa.com.br',
    r.json(),
  );
  await cd.lastRescan;
  ok(
    'repetido = 409',
    (await req('POST', '/api/company-domains', cAdm, { domain: 'empresa.com.br' })).statusCode ===
      409,
  );
  ok(
    'entra na lista de permissões',
    Boolean(allowedBy(await loadAllowlist(), 'DOMAIN', 'login.empresa.com.br')),
  );

  const hits = async (id: string) =>
    prisma.lookalikeHit.findMany({ where: { entryId: id }, orderBy: { domain: 'asc' } });
  const lh = await hits(link.id);
  ok(
    'revarredura acha o link',
    lh.length === 1 && lh[0].reason === 'HOMOGLYPH' && lh[0].sources.join() === 'URL',
    lh,
  );
  const mh = await hits(mail.id);
  const by = (d: string) => mh.find((h) => h.domain === d);
  ok('remetente', by('empresa-seguranca.com')?.sources.includes('SENDER') === true);
  ok(
    'links do e-mail',
    by('empresa.com.br.verifica.top')?.reason === 'SUBDOMAIN' &&
      by('ernpresa.com.br')?.sources.includes('LINK') === true,
    mh,
  );
  ok('indicador sugerido', by('empreza.com.br')?.sources.includes('IOC') === true);
  ok('reply-to da própria empresa não marca', !by('empresa.com.br'));
  ok('amostra limpa sem achados', (await hits(clean.id)).length === 0);

  // Ficha traz os achados (todos os perfis).
  const detail = (await req('GET', `/api/entries/${link.id}`, cBob)).json().entry;
  ok(
    'ficha traz os achados',
    detail.lookalikeHits?.[0]?.companyDomain === 'empresa.com.br' &&
      detail.lookalikeHits[0].domain === 'ernpresa.com.br',
    detail.lookalikeHits,
  );

  // Relatorio publicado com IOC parecido: entra; tirar do relatorio sai.
  const rep = await prisma.report.create({
    data: {
      entryId: clean.id,
      analystId: ids['ana@x.io'],
      summary: 's',
      status: 'PUBLISHED',
      iocs: 'empresa.net',
    },
  });
  await syncReportIocs(prisma, rep.id, { notify: false });
  ok('indicador do relatório', (await hits(clean.id))[0]?.sources.join() === 'REPORT');
  await prisma.report.update({ where: { id: rep.id }, data: { status: 'DRAFT' } });
  await syncReportIocs(prisma, rep.id, { notify: false });
  ok('relatório despublicado sai', (await hits(clean.id)).length === 0);

  // Lista de variacoes vistas (analistas), agrupadas por dominio, com as amostras.
  const list = (await req('GET', '/api/company-domains', cAna)).json();
  const row = list.seen.find((s: { domain: string }) => s.domain === 'ernpresa.com.br');
  ok(
    'variações vistas com as amostras',
    row?.total === 2 &&
      row.entries.length === 2 &&
      row.label === 'letras parecidas' &&
      row.sources.includes('URL') &&
      row.sources.includes('LINK'),
    row,
  );
  ok('lista dos domínios', list.domains.length === 1 && list.max === 20);
  ok(
    'usuário comum sem a lista',
    (await req('GET', '/api/company-domains', cBob)).statusCode === 403,
  );

  // Excluir: some da lista de permissoes (o que o cadastro pos) e os achados somem.
  await prisma.allowedIndicator.create({
    data: { kind: 'DOMAIN', value: 'outra.com.br', reason: 'manual' },
  });
  const second = (
    await req('POST', '/api/company-domains', cAdm, { domain: 'outra.com.br' })
  ).json().item;
  await cd.lastRescan;
  await req('DELETE', `/api/company-domains/${second.id}`, cAdm);
  await cd.lastRescan;
  ok(
    'permissão manual fica ao excluir',
    (await prisma.allowedIndicator.count({ where: { value: 'outra.com.br' } })) === 1,
  );
  const first = list.domains[0];
  ok(
    'analista não exclui',
    (await req('DELETE', `/api/company-domains/${first.id}`, cAna)).statusCode === 403,
  );
  await req('DELETE', `/api/company-domains/${first.id}`, cAdm);
  await cd.lastRescan;
  ok(
    'excluir tira da lista de permissões',
    !(await prisma.allowedIndicator.count({ where: { value: 'empresa.com.br' } })),
  );
  ok('sem domínios, sem achados', (await prisma.lookalikeHit.count()) === 0);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
