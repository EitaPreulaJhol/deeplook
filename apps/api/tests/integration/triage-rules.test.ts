import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { rescanAllLookalikes } from '../../src/lib/lookalike';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { applyTriageRules } from '../../src/lib/triage-rules';
import { yaraScanEntry } from '../../src/lib/yara';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  const ids: Record<string, string> = {};
  for (const [email, role] of [
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
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const rule = async (body: object) =>
    (await req('POST', '/api/triage-rules', cAna, body)).json().rule;

  // 1. Manutencao das regras.
  ok('usuário comum não vê', (await req('GET', '/api/triage-rules', cBob)).statusCode === 403);
  let r = await req('POST', '/api/triage-rules', cAna, { name: 'Sem nada', condition: 'MACRO' });
  ok(
    'sem tag nem prioridade = 400',
    r.statusCode === 400 && Boolean(r.json().details?.tags),
    r.json(),
  );
  r = await req('POST', '/api/triage-rules', cAna, {
    name: 'Domínio',
    condition: 'DOMAIN',
    tags: ['x'],
  });
  ok('domínio sem valor = 400', r.statusCode === 400 && Boolean(r.json().details?.value), r.json());
  ok(
    'campo desconhecido = 400',
    (
      await req('POST', '/api/triage-rules', cAna, {
        name: 'x x x',
        condition: 'MACRO',
        tags: ['a'],
        foo: 1,
      })
    ).statusCode === 400,
  );
  const tld = await rule({
    name: 'TLD suspeito',
    condition: 'DOMAIN',
    value: '.top',
    tags: ['TLD-Suspeito', 'phishing'],
    priority: 'P2',
  });
  ok(
    'cria com tags normalizadas e descrição',
    tld.tags.join() === 'tld-suspeito,phishing' && tld.label === 'domínio do link .top',
    tld,
  );
  const macro = await rule({
    name: 'Documento com macro',
    condition: 'MACRO',
    tags: ['macro'],
    priority: 'P2',
  });
  await rule({ name: 'Disfarçado', condition: 'DISGUISED', tags: ['disfarcado'], priority: 'P1' });
  await rule({ name: 'Script', condition: 'SCRIPT_RISK', tags: ['script'] });
  await rule({ name: 'Documento perigoso', condition: 'DOCUMENT_RISK', tags: ['doc-risco'] });
  await rule({ name: 'Atalho', condition: 'LNK', tags: ['lnk'] });
  await rule({ name: 'Tipo PE', condition: 'DETECTED_TYPE', value: 'pe', tags: ['executavel'] });
  await rule({
    name: 'Remetente',
    condition: 'SENDER',
    value: 'golpe.test',
    tags: ['remetente-golpe'],
  });
  await rule({
    name: 'YARA Emotet',
    condition: 'YARA',
    value: 'emotet',
    tags: ['emotet'],
    priority: 'P1',
  });
  await rule({ name: 'Antivírus', condition: 'ANTIVIRUS', tags: ['av-detectou'] });
  const off = await rule({ name: 'Desligada', condition: 'MACRO', tags: ['nunca'] });
  ok(
    'desligar',
    (await req('PATCH', `/api/triage-rules/${off.id}`, cAna, { enabled: false })).statusCode ===
      200,
  );

  // 2. Na chegada, antes da atribuicao automatica (que usa a tag).
  const group = (await req('POST', '/api/assignment/groups', cAna, { name: 'Phishing' })).json()
    .group;
  await req('PATCH', `/api/assignment/groups/${group.id}`, cAna, { memberIds: [ids['ana@x.io']] });
  await req('POST', '/api/assignment/rules', cAna, { groupId: group.id, tag: 'tld-suspeito' });
  r = await req('POST', '/api/entries/url', cBob, {
    url: 'http://login.banco.top/x',
    title: 'link',
  });
  const link = await prisma.entry.findUnique({
    where: { id: r.json().entry.id },
    include: { tags: true },
  });
  ok(
    'tags e prioridade na chegada',
    link?.tags
      .map((t) => t.name)
      .sort()
      .join() === 'phishing,tld-suspeito' && link?.priority === 'P2',
    link,
  );
  ok(
    'atribuição automática usou a tag da regra',
    link?.assigneeId === ids['ana@x.io'],
    link?.assigneeId,
  );
  const evs = await prisma.entryEvent.findMany({
    where: { entryId: link!.id, type: { in: ['TRIAGE_RULE', 'PRIORITY_CHANGED'] } },
  });
  ok(
    'histórico da regra e da prioridade',
    evs.some(
      (e) =>
        e.type === 'TRIAGE_RULE' &&
        e.toValue === 'TLD suspeito' &&
        e.detail === 'tags tld-suspeito, phishing; prioridade P2',
    ) &&
      evs.some(
        (e) =>
          e.type === 'PRIORITY_CHANGED' &&
          e.fromValue === 'P3' &&
          e.toValue === 'P2' &&
          e.detail === 'regra de triagem' &&
          e.actorId === null,
      ),
    evs,
  );
  // Eficacia (plano pos-revisao, item 2.3): o evento guarda o id da regra, alem do nome.
  const fired = evs.find((e) => e.type === 'TRIAGE_RULE');
  const ruleRow = await prisma.triageRule.findFirst({ where: { name: 'TLD suspeito' } });
  ok('o evento da regra guarda o id dela', fired?.fromValue === ruleRow?.id, fired);
  ok('não repete', (await applyTriageRules(link!.id)).length === 0);
  // Item 163: o nome da regra e configuracao dos analistas; quem enviou ve so as tags.
  const types = async (c: string) =>
    (await req('GET', `/api/entries/${link!.id}/events`, c))
      .json()
      .events.map((e: { type: string }) => e.type);
  ok('usuário comum não vê a regra no histórico', !(await types(cBob)).includes('TRIAGE_RULE'));
  ok('analista vê a regra no histórico', (await types(cAna)).includes('TRIAGE_RULE'));

  // 3. Condicoes pela analise.
  const mk = (data: Record<string, unknown>) =>
    prisma.entry.create({ data: { type: 'FILE', title: 'x', ownerId: ids['bob@x.io'], ...data } });
  const doc = await mk({
    staticInfo: {
      detectedType: { id: 'ole' },
      document: { risk: 'high', office: { modules: [{ name: 'M1' }] } },
    },
  });
  ok(
    'macro e documento de risco alto',
    (await applyTriageRules(doc.id)).sort().join() === 'Documento com macro,Documento perigoso',
  );
  const tagsOf = async (id: string) =>
    (await prisma.entry.findUnique({ where: { id }, include: { tags: true } }))!.tags
      .map((t) => t.name)
      .sort()
      .join();
  ok('regra desligada não vale', !(await tagsOf(doc.id)).includes('nunca'));
  const exe = await mk({
    priority: 'P4',
    staticInfo: { detectedType: { id: 'pe' }, extensionMismatch: { dangerous: true } },
  });
  await applyTriageRules(exe.id);
  ok(
    'tipo real e disfarçado (P4 sobe a P1)',
    (await tagsOf(exe.id)) === 'disfarcado,executavel' &&
      (await prisma.entry.findUnique({ where: { id: exe.id } }))!.priority === 'P1',
  );
  const p1 = await mk({
    priority: 'P1',
    staticInfo: { document: { risk: 'low', office: { modules: [{}] } } },
  });
  await applyTriageRules(p1.id);
  ok(
    'nunca rebaixa (P1 fica P1)',
    (await prisma.entry.findUnique({ where: { id: p1.id } }))!.priority === 'P1' &&
      (await tagsOf(p1.id)) === 'macro',
  );
  const script = await mk({ staticInfo: { script: { risk: 'high' }, lnk: { alerts: ['x'] } } });
  await applyTriageRules(script.id);
  ok('script e atalho', (await tagsOf(script.id)) === 'lnk,script');
  const mail = await mk({ emailInfo: { from: { name: 'X', address: 'cobranca@sub.golpe.test' } } });
  await applyTriageRules(mail.id);
  ok('remetente pelo domínio', (await tagsOf(mail.id)) === 'remetente-golpe');
  const clean = await mk({ staticInfo: { detectedType: { id: 'pdf' } } });
  ok(
    'nada casa: nada muda',
    (await applyTriageRules(clean.id)).length === 0 && (await tagsOf(clean.id)) === '',
  );

  // 4. Depois do YARA (gancho no fim da varredura) e do antivirus.
  await prisma.yaraRule.create({
    data: {
      name: 'emotet_loader',
      source: 'rule emotet_loader { strings: $a = "EMOTET-MARCA" condition: $a }',
    },
  });
  const y = await mk({});
  await yaraScanEntry(y.id, Buffer.from('xxxx EMOTET-MARCA yyyy'));
  const yAfter = await prisma.entry.findUnique({ where: { id: y.id }, include: { tags: true } });
  ok(
    'YARA casou: tag e P1 pela regra',
    yAfter?.tags.some((t) => t.name === 'emotet') && yAfter?.priority === 'P1',
    yAfter,
  );
  const av = await mk({});
  await prisma.antivirusScan.create({
    data: { entryId: av.id, status: 'INFECTED', signature: 'Win.Trojan.Agent-1' },
  });
  await applyTriageRules(av.id);
  ok('antivírus detectou', (await tagsOf(av.id)) === 'av-detectou');

  // 5. Exclusao.
  ok(
    'excluir',
    (await req('DELETE', `/api/triage-rules/${macro.id}`, cAna)).statusCode === 200 &&
      (await req('GET', '/api/triage-rules', cAna)).json().rules.length === 10,
  );

  // 6. Dominio parecido com o da empresa (item 124).
  await prisma.companyDomain.createMany({
    data: [{ domain: 'empresa.com.br' }, { domain: 'outra.com.br' }],
  });
  const anyLook = await rule({
    name: 'Parecido',
    condition: 'LOOKALIKE',
    tags: ['dominio-parecido'],
    priority: 'P1',
  });
  ok('descrição sem valor', anyLook.label === 'parecido com domínio da empresa', anyLook);
  const onlyOther = await rule({
    name: 'Parecido com a outra',
    condition: 'LOOKALIKE',
    value: 'outra.com.br',
    tags: ['parece-outra'],
  });
  ok(
    'descrição com valor',
    onlyOther.label === 'parecido com domínio da empresa outra.com.br',
    onlyOther,
  );
  const sendUrl = async (url: string) => {
    const res = await req('POST', '/api/entries/url', cBob, { url, title: 'link' });
    return res.json().entry.id as string;
  };
  const looks = await sendUrl('http://ernpresa.com.br/entrar');
  const looksEntry = await prisma.entry.findUnique({ where: { id: looks } });
  ok(
    'na chegada: tag e prioridade',
    (await tagsOf(looks)) === 'dominio-parecido' && looksEntry?.priority === 'P1',
    [await tagsOf(looks), looksEntry?.priority],
  );
  ok(
    'com valor: casa só a empresa pedida',
    (await tagsOf(await sendUrl('http://0utra.com.br/'))) === 'dominio-parecido,parece-outra',
  );
  const legit = await sendUrl('http://portal.empresa.com.br/');
  ok('domínio da própria empresa não casa', (await tagsOf(legit)) === '');
  ok('sem parecido, nada', (await tagsOf(await sendUrl('http://exemplo.org/'))) === '');

  // Lista da empresa mudou: refaz os achados, mas nao mexe em tags e prioridade.
  const before = await sendUrl('http://novanome.com/');
  await prisma.companyDomain.create({ data: { domain: 'novonome.com' } });
  await rescanAllLookalikes();
  ok('revarredura acha', (await prisma.lookalikeHit.count({ where: { entryId: before } })) === 1);
  ok('revarredura não aplica regra', (await tagsOf(before)) === '');

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
