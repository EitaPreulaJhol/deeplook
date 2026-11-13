import { isDeepStrictEqual } from 'node:util';

import { buildApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Plano pos-revisao, item 1.4, parte 2: o que as analises gravaram em portugues sai no idioma de
// quem pede, pela ficha, pela reanalise, pelas rotas das analises e pela comparacao.
async function main() {
  const app = await buildApp();
  await app.ready();

  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'Ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const cookie = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@x.io' } });
  const get = (url: string, lang?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { cookie, ...(lang ? { 'accept-language': lang } : {}) },
    });

  const staticInfo = {
    detectedType: { id: 'pe', label: 'Executável do Windows (PE)', extensions: ['exe'] },
    strings: { total: 1, urls: [], ips: [], emails: [] },
    pe: {
      machine: 'x64 (64 bits)',
      subsystem: 'Janelas (GUI)',
      imports: [],
      sections: [],
      suspiciousImports: [],
      alerts: [{ level: 'medium', text: 'O manifesto pede execução como administrador.' }],
    },
  };
  const make = (title: string) =>
    prisma.entry.create({
      data: { type: 'FILE', title, ownerId: owner.id, staticInfo, sha256: title.padEnd(64, '0') },
    });
  const entry = await make('a');
  const other = await make('b');
  await prisma.officeAnalysis.create({
    data: {
      entryId: entry.id,
      status: 'DONE',
      alerts: [
        { level: 'high', text: 'Contém macros XLM 4.0 (Excel 4), muito usadas por malware.' },
      ],
    },
  });
  await prisma.capaAnalysis.create({
    data: { entryId: entry.id, status: 'FAILED', error: 'o capa não produziu resultado' },
  });

  // 1. Ficha.
  type Detail = {
    entry: { staticInfo: typeof staticInfo };
  };
  const pt = (await get(`/api/entries/${entry.id}`)).json<Detail>().entry.staticInfo;
  const en = (await get(`/api/entries/${entry.id}`, 'en')).json<Detail>().entry.staticInfo;
  ok('ficha em português: como foi gravado', isDeepStrictEqual(pt, staticInfo), pt);
  ok(
    'ficha em inglês: alerta, tipo, arquitetura e subsistema',
    en.pe.alerts[0].text === 'The manifest asks to run as administrator.' &&
      en.detectedType.label === 'Windows executable (PE)' &&
      en.pe.machine === 'x64 (64-bit)' &&
      en.pe.subsystem === 'Windows (GUI)',
    en,
  );
  ok(
    'o banco continua em português',
    isDeepStrictEqual(
      (await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } })).staticInfo,
      staticInfo,
    ),
  );

  // 2. oletools e capa.
  const office = (await get(`/api/entries/${entry.id}/office`, 'en')).json<{
    analysis: { alerts: { text: string }[] };
  }>().analysis;
  ok(
    'oletools em inglês',
    office.alerts[0].text === 'Contains XLM 4.0 macros (Excel 4), widely used by malware.',
    office,
  );
  const capa = (await get(`/api/entries/${entry.id}/capa`, 'en')).json<{
    analysis: { error: string };
  }>().analysis;
  ok('capa: motivo da falha em inglês', capa.error === 'capa produced no result', capa);
  const capaPt = (await get(`/api/entries/${entry.id}/capa`)).json<{
    analysis: { error: string };
  }>().analysis;
  ok('capa: em português, o motivo gravado', capaPt.error === 'o capa não produziu resultado');

  // 3. Comparacao.
  const cmp = (await get(`/api/entries/compare?a=${entry.id}&b=${other.id}`, 'en')).json<{
    a: { detectedType: string; pe: { machine: string } };
  }>();
  ok(
    'comparação em inglês',
    cmp.a?.detectedType === 'Windows executable (PE)' && cmp.a.pe.machine === 'x64 (64-bit)',
    cmp,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
