import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { normalizeUrl, urlKey } from '../../src/lib/ioc-normalize';
import { prisma } from '../../src/lib/prisma';
import { authRoutes } from '../../src/routes/auth';
import { caseRoutes } from '../../src/routes/cases';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

type Obj = { type: string; id: string; [key: string]: unknown };

// Pacote STIX 2.1 do caso (revisao de novembro, 3.5): exportar o caso inteiro e importar o pacote
// de outro DeepLook num caso. A ida e a volta usam o mesmo formato.
async function main() {
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(authRoutes);
  await app.register(caseRoutes);
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const ana = await prisma.user.create({
    data: { email: 'ana@x.io', displayName: 'Ana', role: 'ANALYST', passwordHash },
  });
  await prisma.user.create({
    data: { email: 'u@x.io', displayName: 'U', role: 'USER', passwordHash },
  });
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
  const [cAna, cUser] = [await login('ana@x.io'), await login('u@x.io')];
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });

  // ---- 1. Exportar o caso inteiro
  const SHA = 'ab'.repeat(32);
  const file = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'fatura.exe',
      ownerId: ana.id,
      sha256: SHA,
      originalFilename: 'fatura.exe',
      verdict: 'MALICIOUS',
    },
  });
  const link = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'login falso',
      ownerId: ana.id,
      url: 'http://login.banco-falso.example/entrar',
      urlDomain: 'login.banco-falso.example',
      // Como o envio grava (item 165): a chave do link normalizado.
      urlKey: urlKey(normalizeUrl('http://login.banco-falso.example/entrar')!),
    },
  });
  const published = await prisma.report.create({
    data: {
      entryId: file.id,
      analystId: ana.id,
      status: 'PUBLISHED',
      verdict: 'MALICIOUS',
      summary: 'baixa um segundo estágio',
      findings: 'persiste no Run',
      attackTechniques: ['T1566.001', 'T1547.001'],
      iocs: 'hxxp://cdn.banco-falso[.]example/x.bin',
    },
  });
  // Ao publicar, o sistema indexa os IOCs do relatorio; aqui, direto.
  await prisma.reportIoc.create({
    data: {
      reportId: published.id,
      entryId: file.id,
      kind: 'URL',
      value: 'http://cdn.banco-falso.example/x.bin',
    },
  });
  await prisma.report.create({
    data: {
      entryId: file.id,
      analystId: ana.id,
      status: 'DRAFT',
      summary: 'rascunho que não sai',
      attackTechniques: ['T1059'],
    },
  });
  const created = await req('POST', '/api/cases', cAna, {
    title: 'Campanha da fatura',
    description: 'três envios',
    entryIds: [file.id, link.id],
  });
  const caseId = created.json().case.id as string;
  const code = created.json().case.code as string;

  const exp = await req('GET', `/api/cases/${caseId}/iocs/export?format=stix-case`, cAna);
  const bundle = exp.json() as { type: string; objects: Obj[] };
  const of = (type: string) => bundle.objects.filter((o) => o.type === type);
  ok(
    'exporta o pacote',
    exp.statusCode === 200 &&
      bundle.type === 'bundle' &&
      exp.headers['content-disposition']?.includes(`deeplook-${code.toLowerCase()}.stix.json`),
    exp.headers,
  );
  ok(
    'amostras como observáveis: arquivo pelo SHA-256 e link pela URL',
    of('file').length === 1 &&
      (of('file')[0].hashes as Record<string, string>)['SHA-256'] === SHA &&
      of('url')[0]?.value === link.url,
    [...of('file'), ...of('url')],
  );
  ok(
    'técnicas ATT&CK do relatório publicado, com o nome e o id da MITRE',
    of('attack-pattern').length === 2 &&
      of('attack-pattern').some(
        (a) =>
          (a.external_references as { external_id: string }[])[0].external_id === 'T1566.001' &&
          String(a.name).includes('Spearphishing'),
      ),
    of('attack-pattern'),
  );
  ok(
    'rascunho não sai (nem a técnica dele)',
    !JSON.stringify(bundle).includes('rascunho') &&
      !of('attack-pattern').some((a) => JSON.stringify(a).includes('"T1059"')),
  );
  ok(
    'relatório publicado vira note presa ao arquivo',
    of('note').length === 1 &&
      (of('note')[0].object_refs as string[])[0] === of('file')[0].id &&
      String(of('note')[0].content).includes('persiste no Run'),
    of('note'),
  );
  const report = of('report')[0];
  ok(
    'report do caso aponta para tudo (menos a identidade)',
    report?.name === `${code} Campanha da fatura` &&
      (report.object_refs as string[]).length === bundle.objects.length - 2,
    report,
  );
  ok(
    'mantém os indicators e o grouping da exportação de IOCs',
    of('indicator').length > 0 && of('grouping').length === 1,
  );
  ok(
    'todos os objetos com spec_version 2.1 e ids únicos',
    bundle.objects.every((o) => o.spec_version === '2.1') &&
      new Set(bundle.objects.map((o) => o.id)).size === bundle.objects.length,
  );
  ok(
    'usuário comum não exporta',
    (await req('GET', `/api/cases/${caseId}/iocs/export?format=stix-case`, cUser)).statusCode ===
      403,
  );

  // ---- 2. Importar o pacote de outro DeepLook noutro caso
  const other = await prisma.entry.create({
    data: {
      type: 'URL',
      title: 'outro',
      ownerId: ana.id,
      url: 'http://x.example/',
      urlDomain: 'x.example',
    },
  });
  const target = (
    await req('POST', '/api/cases', cAna, { title: 'Caso que recebe', entryIds: [other.id] })
  ).json().case;
  const incoming = {
    type: 'bundle',
    id: 'bundle--1',
    objects: [
      ...bundle.objects,
      {
        type: 'url',
        spec_version: '2.1',
        id: 'url--novo',
        value: 'https://pagamento.banco-falso.example/pix?id=1#vitima',
      },
      {
        type: 'file',
        spec_version: '2.1',
        id: 'file--desconhecido',
        hashes: { 'SHA-256': 'cd'.repeat(32) },
      },
      {
        type: 'indicator',
        spec_version: '2.1',
        id: 'indicator--dom',
        pattern: "[domain-name:value = 'banco-falso.example']",
        pattern_type: 'stix',
      },
    ],
  };
  const text = JSON.stringify(incoming);
  const preview = await req('POST', `/api/cases/${target.id}/stix/preview`, cAna, { text });
  const p = preview.json();
  const linkStatus = (url: string) => p.links.find((l: { url: string }) => l.url === url)?.status;
  ok(
    'prévia: nome do pacote',
    preview.statusCode === 200 && p.name === `${code} Campanha da fatura`,
    p,
  );
  ok(
    'prévia: link que já é amostra aparece como existente',
    linkStatus(link.url!) === 'existing',
    p.links,
  );
  ok(
    'prévia: link novo, normalizado (sem o fragmento)',
    linkStatus('https://pagamento.banco-falso.example/pix?id=1') === 'new',
    p.links,
  );
  ok(
    'prévia: link do IOC do relatório (refang) também entra',
    linkStatus('http://cdn.banco-falso.example/x.bin') === 'new',
    p.links,
  );
  ok(
    'prévia: arquivo conhecido entra, desconhecido não',
    p.hashes.find((h: { sha256: string }) => h.sha256 === SHA)?.status === 'existing' &&
      p.hashes.find((h: { sha256: string }) => h.sha256 === 'cd'.repeat(32))?.status === 'unknown',
    p.hashes,
  );
  ok('prévia: domínio e outros só são contados', p.others >= 1, p.others);
  ok(
    'prévia não muda nada',
    (await prisma.caseEntry.count({ where: { caseId: target.id } })) === 1,
  );

  const before = await prisma.entry.count();
  const imp = await req('POST', `/api/cases/${target.id}/stix/import`, cAna, { text });
  const r = imp.json();
  ok(
    'importa: 2 links novos e 2 que já existiam',
    imp.statusCode === 200 && r.created === 2 && r.linked === 2 && r.added === 4 && r.unknown === 1,
    r,
  );
  ok(
    'as amostras novas existem, são do analista e têm o caso na descrição',
    (await prisma.entry.count()) === before + 2,
  );
  const fresh = await prisma.entry.findFirst({
    where: { url: 'https://pagamento.banco-falso.example/pix?id=1' },
  });
  ok(
    'link novo: título com o host e o caso',
    fresh?.ownerId === ana.id &&
      fresh.title.startsWith('pagamento.banco-falso.example (pacote STIX') &&
      fresh.description?.includes(target.code),
    fresh,
  );
  const members = await prisma.caseEntry.findMany({
    where: { caseId: target.id },
    select: { entryId: true },
  });
  ok(
    'caso recebe as amostras',
    members.length === 5 &&
      [file.id, link.id, fresh?.id].every((id) => members.some((m) => m.entryId === id)),
    members,
  );
  const comment = await prisma.caseEvent.findFirst({
    where: { caseId: target.id, type: 'COMMENT' },
  });
  ok(
    'comentário no caso com o resumo do que entrou e do que não entrou',
    Boolean(
      comment?.detail?.includes('2 link(s) novo(s)') &&
      comment.detail.includes('nunca enviado') &&
      comment.detail.includes('cd'.repeat(32)),
    ),
    comment?.detail,
  );
  const again = (await req('POST', `/api/cases/${target.id}/stix/import`, cAna, { text })).json();
  ok('importar de novo não duplica nada', again.created === 0 && again.added === 0, again);

  // ---- 3. Recusas
  ok(
    'JSON inválido: 400 com o motivo',
    (await req('POST', `/api/cases/${target.id}/stix/preview`, cAna, { text: '{nada' }))
      .json()
      .error.includes('JSON inválido'),
  );
  ok(
    'JSON que não é pacote: 400',
    (await req('POST', `/api/cases/${target.id}/stix/preview`, cAna, { text: '{"type":"report"}' }))
      .statusCode === 400,
  );
  ok(
    'usuário comum não importa',
    (await req('POST', `/api/cases/${target.id}/stix/import`, cUser, { text })).statusCode === 403,
  );
  await prisma.case.update({ where: { id: target.id }, data: { status: 'CLOSED' } });
  ok(
    'caso encerrado: 409',
    (await req('POST', `/api/cases/${target.id}/stix/import`, cAna, { text })).statusCode === 409,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
