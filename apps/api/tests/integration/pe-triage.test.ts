import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import type { Prisma } from '../../src/generated/prisma/client';
import { capaIdle, capaTiming, stopCapaQueue } from '../../src/lib/capa';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { applyTriageRules } from '../../src/lib/triage-rules';

// Regras de triagem com os sinais da analise do executavel (7.1) e de funcoes (7.2): item 7.4.
// As do PE valem na chegada (a analise estatica roda antes); as do capa, quando ela conclui.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));

/** capa falso: devolve as regras e as strings do FLOSS que o teste quiser. */
async function fakeCapa(answer: () => unknown) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"state":"livre"}');
      return;
    }
    req.resume();
    req.on('end', () =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer())),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    },
  };
}

const capaAnswer = (
  rules: { name: string; namespace: string; attack: string[] }[],
  decoded: string[] = [],
) => ({
  ok: true,
  kind: 'pe',
  versions: { capa: '10.0.0', floss: '3.2.0', rules: '10.0.0' },
  capa: {
    format: 'pe',
    arch: 'amd64',
    os: 'windows',
    functions: 10,
    libraryFunctions: 0,
    rules: rules.map((r) => ({ ...r, mbc: [], matches: 1, addresses: ['0x1'] })),
    truncated: false,
  },
  capaError: null,
  floss: {
    stack: [],
    tight: [],
    decoded: decoded.map((string) => ({ string, function: '0x1' })),
    truncated: false,
  },
  flossError: null,
  ms: 5,
});

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.CAPA_URL = '';
  env.CAPA_TOKEN = '0123456789abcdef01';
  capaTiming.serviceWaitMs = 10_000;
  capaTiming.retryEveryMs = 200;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
      role: 'ANALYST',
      passwordHash: await hashPassword('senha-123!'),
    },
  });
  const c = String(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ana@x.io', password: 'senha-123!' },
      })
    ).headers['set-cookie'],
  ).split(';')[0];
  const rule = (body: object) =>
    app.inject({ method: 'POST', url: '/api/triage-rules', headers: { cookie: c }, payload: body });
  const upload = async (name: string, data: Buffer): Promise<string> => {
    const boundary = '----dl' + Math.random();
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({
      method: 'POST',
      url: '/api/entries/file',
      payload: body,
      headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const state = async (id: string) => {
    const e = await prisma.entry.findUnique({
      where: { id },
      select: { priority: true, tags: { select: { name: true } } },
    });
    return { priority: e?.priority, tags: (e?.tags ?? []).map((t) => t.name).sort() };
  };

  // ------------------------------------------------------------ 1. validacao
  const noValue = await rule({
    name: 'Técnica sem código',
    condition: 'ATTACK_TECHNIQUE',
    tags: ['x'],
  });
  ok('técnica ATT&CK precisa do código', noValue.statusCode === 400, noValue.json());
  const badValue = await rule({
    name: 'Técnica errada',
    condition: 'ATTACK_TECHNIQUE',
    value: 'injecao',
    tags: ['x'],
  });
  ok('código de técnica inválido é recusado', badValue.statusCode === 400, badValue.json());
  const lower = await rule({
    name: 'Injeção',
    condition: 'ATTACK_TECHNIQUE',
    value: 't1055',
    tags: ['t1055'],
    priority: 'P1',
  });
  ok(
    'técnica em minúsculas vira maiúsculas, com o rótulo',
    lower.statusCode === 201 &&
      lower.json().rule.value === 'T1055' &&
      lower.json().rule.label === 'técnica ATT&CK T1055',
    lower.json(),
  );
  for (const body of [
    {
      name: 'Empacotado com UPX',
      condition: 'PACKED',
      value: 'upx',
      tags: ['empacotado'],
      priority: 'P2',
    },
    {
      name: 'Assinatura adulterada',
      condition: 'SIGNATURE_INVALID',
      tags: ['assinatura-adulterada'],
      priority: 'P1',
    },
    {
      name: 'Pede administrador',
      condition: 'PE_ALERT',
      value: 'administrador',
      tags: ['pede-admin'],
    },
    { name: 'Alerta alto', condition: 'PE_ALERT', tags: ['alerta-alto'] },
    { name: 'Injeção (capa)', condition: 'CAPA_CAPABILITY', value: 'inject', tags: ['injecao'] },
    { name: 'Capacidade de risco', condition: 'CAPA_CAPABILITY', tags: ['capacidade-risco'] },
    {
      name: 'Persistência',
      condition: 'CAPA_CAPABILITY',
      value: 'persistence',
      tags: ['persistencia'],
    },
    { name: 'IOC escondido', condition: 'HIDDEN_IOC', value: 'evil.test', tags: ['ioc-escondido'] },
  ]) {
    const r = await rule(body);
    ok(`regra "${body.name}" criada`, r.statusCode === 201, r.json());
  }

  // ------------------------------------------------------------ 2. sinais do PE, na chegada
  const upx = await state(await upload('setup.exe', file('upx64.exe')));
  ok(
    'UPX: empacotado e pede administrador (manifesto), sem alerta alto',
    upx.tags.includes('empacotado') &&
      upx.tags.includes('pede-admin') &&
      !upx.tags.includes('alerta-alto') &&
      upx.priority === 'P2',
    upx,
  );
  const tampered = await state(await upload('fatura.exe', file('adulterado.exe')));
  ok(
    'assinatura adulterada: tag, alerta alto e P1',
    tampered.tags.includes('assinatura-adulterada') &&
      tampered.tags.includes('alerta-alto') &&
      tampered.priority === 'P1',
    tampered,
  );
  const signed = await state(await upload('ok.exe', file('assinado.exe')));
  ok(
    'assinatura que confere não casa (o recurso com executável ainda dá alerta alto)',
    !signed.tags.includes('assinatura-adulterada') && signed.tags.includes('alerta-alto'),
    signed,
  );
  const self = await state(await upload('self.exe', file('autoassinado.exe')));
  ok(
    'autoassinado confere: não é "não confere"',
    !self.tags.includes('assinatura-adulterada'),
    self,
  );

  // Assinatura ilegivel nao conta como "nao confere".
  const unreadable = await upload('ilegivel.exe', file('prog32.exe'));
  const row = await prisma.entry.findUnique({
    where: { id: unreadable },
    select: { staticInfo: true },
  });
  const info = row!.staticInfo as { pe: Record<string, unknown> };
  info.pe.signature = {
    error: 'Assinatura malformada.',
    digestMatches: null,
    signatureValid: false,
  };
  await prisma.entry.update({
    where: { id: unreadable },
    data: { staticInfo: info as unknown as Prisma.InputJsonValue },
  });
  await applyTriageRules(unreadable);
  ok(
    'assinatura ilegível não casa',
    !(await state(unreadable)).tags.includes('assinatura-adulterada'),
  );

  // ------------------------------------------------------------ 3. sinais do capa, quando ele conclui
  let answer = capaAnswer(
    [
      {
        name: 'inject thread',
        namespace: 'host-interaction/process/inject',
        attack: ['T1055.003'],
      },
      { name: 'parse PE header', namespace: 'load-code/pe', attack: [] },
    ],
    ['http://xor.evil.test/painel'],
  );
  const fake = await fakeCapa(() => answer);
  env.CAPA_URL = fake.url;
  const injector = await upload('injetor.exe', file('prog64.exe'));
  const atArrival = await state(injector);
  await capaIdle();
  const afterCapa = await state(injector);
  ok(
    'na chegada, nada do capa ainda',
    !atArrival.tags.some((t) => ['injecao', 't1055', 'ioc-escondido'].includes(t)),
    atArrival,
  );
  ok(
    'quando o capa conclui: capacidade, técnica (subtécnica casa T1055), risco e IOC escondido',
    ['injecao', 't1055', 'capacidade-risco', 'ioc-escondido'].every((t) =>
      afterCapa.tags.includes(t),
    ) &&
      !afterCapa.tags.includes('persistencia') &&
      afterCapa.priority === 'P1',
    afterCapa,
  );
  const events = await prisma.entryEvent.findMany({
    where: { entryId: injector, type: 'TRIAGE_RULE' },
    select: { toValue: true },
  });
  ok(
    'cada regra no histórico',
    ['Injeção (capa)', 'Injeção', 'Capacidade de risco', 'IOC escondido'].every((n) =>
      events.some((e) => e.toValue === n),
    ),
    events,
  );
  const again = await applyTriageRules(injector);
  ok('rodar de novo não muda nada nem repete o histórico', again.length === 0, again);

  answer = capaAnswer([{ name: 'parse PE header', namespace: 'load-code/pe', attack: ['T1129'] }]);
  const benign = await upload('comum.exe', file('teste.dll'));
  await capaIdle();
  const b = await state(benign);
  ok(
    'só capacidade comum: nada de risco, técnica nem IOC',
    !b.tags.some((t) => ['injecao', 't1055', 'capacidade-risco', 'ioc-escondido'].includes(t)),
    b,
  );
  answer = capaAnswer([
    {
      name: 'persist via Run registry key',
      namespace: 'persistence/registry/run',
      attack: ['T1547.001'],
    },
  ]);
  const persist = await upload('persiste.exe', file('ofuscado64.exe'));
  await capaIdle();
  const p = await state(persist);
  ok(
    'grupo do capa como valor (persistence) e qualquer capacidade de risco',
    p.tags.includes('persistencia') &&
      p.tags.includes('capacidade-risco') &&
      !p.tags.includes('t1055'),
    p,
  );
  await fake.close();
  env.CAPA_URL = '';

  // ------------------------------------------------------------ 4. reanalise pede as regras de novo
  const late = await upload('tardio.exe', file('upx32.exe'));
  await rule({ name: 'UPX tardio', condition: 'PACKED', value: 'UPX', tags: ['upx-tardio'] });
  ok(
    'regra criada depois do envio ainda não vale',
    !(await state(late)).tags.includes('upx-tardio'),
  );
  const re = await app.inject({
    method: 'POST',
    url: `/api/entries/${late}/static-analysis`,
    headers: { cookie: c },
    payload: {},
  });
  ok(
    'reanálise aplica as regras',
    re.statusCode === 200 && (await state(late)).tags.includes('upx-tardio'),
    re.statusCode,
  );

  stopCapaQueue();
  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
