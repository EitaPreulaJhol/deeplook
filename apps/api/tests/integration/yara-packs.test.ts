import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { scanContextOf, scanWithYara } from '../../src/lib/yara';
import { installYaraPacks, yaraPacks } from '../../src/lib/yara-packs';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';
import { settingsRoutes } from '../../src/routes/settings';
import { yaraRoutes } from '../../src/routes/yara';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Regras reais dos pacotes: um caminho de PDB (bartblaze) e bytes (signature-base).
const BARTBLAZE = Buffer.from('xx \\Dev\\ApplicationDllHijacking\\ yy');
const SIGNATURE = Buffer.from([
  0x00, 0x0f, 0xaf, 0xc0, 0x65, 0xc0, 0x07, 0x48, 0x0f, 0xaf, 0x11, 0x39, 0x18, 0x00,
]);

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes, yaraRoutes, settingsRoutes]) await app.register(r);
  await app.ready();
  for (const [email, role] of [
    ['adm@x.io', 'ADMIN'],
    ['ana@x.io', 'ANALYST'],
    ['bob@x.io', 'USER'],
  ] as const) {
    await prisma.user.create({
      data: {
        email,
        displayName: email.split('@')[0],
        role,
        passwordHash: await hashPassword('senha-123!'),
      },
    });
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
  const cAdm = await login('adm@x.io');
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const req = (method: string, url: string, c: string, payload?: object) =>
    app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload });
  const manifest = Object.fromEntries(yaraPacks().map((p) => [p.id, p]));
  const countOf = (pack: string) => prisma.yaraRule.count({ where: { pack } });

  // 1. Manifesto: licenca e origem de cada pacote, com o padrao combinado.
  ok(
    'ligados por padrão: ReversingLabs e bartblaze',
    yaraPacks()
      .filter((p) => p.defaultEnabled)
      .map((p) => p.id)
      .sort()
      .join() === 'bartblaze,reversinglabs',
  );
  ok('signature-base opcional', manifest['signature-base'].defaultEnabled === false);
  ok(
    'sem a pasta generic da bartblaze',
    !manifest.bartblaze.files.some((f) => f.startsWith('generic/')),
  );
  ok(
    'origem fixa',
    yaraPacks().every((p) => /^[0-9a-f]{40}$/.test(p.commit) && p.url.startsWith('https://')),
  );

  // 2. Primeira subida: instala so os ligados.
  ok('instala os ligados', (await installYaraPacks()).sort().join() === 'bartblaze,reversinglabs');
  ok(
    'ReversingLabs inteira',
    (await countOf('reversinglabs')) === manifest.reversinglabs.files.length,
  );
  ok('bartblaze inteira', (await countOf('bartblaze')) === manifest.bartblaze.files.length);
  ok('signature-base não instalada', (await countOf('signature-base')) === 0);

  // 3. Sem nada aparecendo como regra da equipe, e a lista nao traz o texto.
  ok(
    'lista da equipe sem pacotes',
    (await req('GET', '/api/yara/rules', cAna)).json().rules.length === 0,
  );
  const page = (
    await req('GET', '/api/yara/packs/bartblaze/rules?q=Autumn_Backdoor_Loader', cAna)
  ).json();
  ok('busca nas regras do pacote', page.total === 1 && page.rules[0].source === undefined, page);
  const ruleId = page.rules[0].id as string;
  const full = (await req('GET', `/api/yara/rules/${ruleId}`, cAna)).json().rule;
  ok('texto ao abrir', full.source.includes('author = "@bartblaze"') && full.pack === 'bartblaze');
  ok('usuário comum não lista', (await req('GET', '/api/yara/packs', cBob)).statusCode === 403);
  const packs = (await req('GET', '/api/yara/packs', cAna)).json().packs;
  const sigInfo = packs.find((p: { id: string }) => p.id === 'signature-base');
  ok(
    'lista de pacotes',
    sigInfo.enabled === false &&
      sigInfo.installed === false &&
      sigInfo.license === 'DRL 1.1' &&
      sigInfo.files === undefined &&
      packs.find((p: { id: string }) => p.id === 'bartblaze').rulesActive ===
        manifest.bartblaze.files.length,
    sigInfo,
  );

  // 4. Regra de pacote detecta, citando autor e pacote; a thread nao trava a API.
  let longest = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    longest = Math.max(longest, Date.now() - last);
    last = Date.now();
  }, 20);
  const started = Date.now();
  const first = await scanWithYara(BARTBLAZE);
  const tookMs = Date.now() - started;
  clearInterval(timer);
  const hit = first.hits.find((h) => h.identifier === 'Autumn_Backdoor_Loader');
  ok('detecção real', Boolean(hit), first.hits);
  ok('autor da própria regra', hit?.author === '@bartblaze', hit);
  ok('pacote no resultado', hit?.pack === 'bartblaze', hit);
  ok(
    'conta as regras ativas',
    first.rulesCount === manifest.reversinglabs.files.length + manifest.bartblaze.files.length,
  );
  console.log(`     primeira varredura ${tookMs} ms, maior espera da API ${longest} ms`);
  ok('compilar leva tempo', tookMs > 500, tookMs);
  ok('API livre enquanto compila', longest < Math.min(500, tookMs / 2), { longest, tookMs });
  ok('arquivo comum: nada', (await scanWithYara(Buffer.from('texto comum'))).hits.length === 0);
  ok('signature-base desligada não detecta', (await scanWithYara(SIGNATURE)).hits.length === 0);

  // 5. Regra de pacote nao se edita, mas se desliga e se exclui; nao volta sozinha.
  const edited = await req('PATCH', `/api/yara/rules/${ruleId}`, cAna, {
    name: 'outro nome',
    source: 'rule x { condition: true }',
  });
  ok(
    'não se edita',
    edited.statusCode === 409 && edited.json().error.includes('autoria'),
    edited.body,
  );
  ok(
    'desliga',
    (await req('PATCH', `/api/yara/rules/${ruleId}`, cAna, { enabled: false })).statusCode === 200,
  );
  ok('desligada não detecta', (await scanWithYara(BARTBLAZE)).hits.length === 0);
  await installYaraPacks();
  ok(
    'subir de novo não religa',
    (await prisma.yaraRule.findUniqueOrThrow({ where: { id: ruleId } })).enabled === false,
  );
  await req('PATCH', `/api/yara/rules/${ruleId}`, cAna, { enabled: true });
  ok('liga de novo', (await scanWithYara(BARTBLAZE)).hits.length === 1);
  const another = await prisma.yaraRule.findFirstOrThrow({
    where: { pack: 'bartblaze', id: { not: ruleId } },
  });
  ok('exclui', (await req('DELETE', `/api/yara/rules/${another.id}`, cAna)).statusCode === 200);
  ok('subir de novo não instala', (await installYaraPacks()).length === 0);
  ok('excluída não volta', !(await prisma.yaraRule.findUnique({ where: { id: another.id } })));

  // 6. Signature-base pela administracao.
  const toggle = (c: string, id: string, enabled: boolean) =>
    req('PATCH', `/api/admin/yara-packs/${id}`, c, { enabled });
  ok('analista não liga', (await toggle(cAna, 'signature-base', true)).statusCode === 403);
  ok('usuário comum não liga', (await toggle(cBob, 'signature-base', true)).statusCode === 403);
  ok('pacote inexistente', (await toggle(cAdm, 'nao-existe', true)).statusCode === 404);
  const enabled = await toggle(cAdm, 'signature-base', true);
  ok('admin liga e instala', enabled.statusCode === 200, enabled.body);
  ok('instalou', (await countOf('signature-base')) === manifest['signature-base'].files.length);
  ok(
    'ligar fica na auditoria',
    (await prisma.auditEvent.count({
      where: {
        action: 'SETTING_CHANGED',
        targetLabel: 'Pacote de regras YARA signature-base',
        detail: 'ligado',
      },
    })) === 1,
  );
  const sigHit = (await scanWithYara(SIGNATURE)).hits.find((h) => h.identifier === 'IMPLANT_5_v3');
  ok('signature-base detecta', Boolean(sigHit));
  ok(
    'mantém o autor da regra (DRL)',
    sigHit?.author === 'US CERT' && sigHit?.pack === 'signature-base',
    sigHit,
  );
  const sigRule = (
    await req('GET', '/api/yara/packs/signature-base/rules?q=grizzlybear', cAna)
  ).json().rules[0];
  ok(
    'texto original com o autor',
    (await req('GET', `/api/yara/rules/${sigRule.id}`, cAna))
      .json()
      .rule.source.includes('author = "US CERT"'),
  );

  // 6b. Os 13 arquivos com variaveis externas (item 147), com regras reais.
  ok('nenhum arquivo de fora', manifest['signature-base'].excluded.length === 0);
  const MZ = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const idsOf = async (bytes: Buffer, originalFilename: string) =>
    (await scanWithYara(bytes, scanContextOf({ originalFilename }))).hits.map((h) => h.identifier);
  ok('executável como .txt', (await idsOf(MZ, 'fatura.TXT')).includes('EXE_cloaked_as_TXT'));
  ok('o mesmo como .exe, não', !(await idsOf(MZ, 'fatura.exe')).includes('EXE_cloaked_as_TXT'));
  ok(
    'caminho no nome: só o arquivo',
    (await idsOf(MZ, 'C:\\docs\\a.b\\fatura.txt')).includes('EXE_cloaked_as_TXT'),
  );
  ok(
    'tamanho do Windows ignorado',
    !(await idsOf(MZ, 'winlogon.exe')).includes('Suspicious_Size_winlogon_exe'),
  );
  ok('sem nome, as variáveis ficam vazias', (await scanWithYara(MZ)).hits.length === 0);
  const ctx = scanContextOf({
    originalFilename: 'Script.PS1',
    staticInfo: { detectedType: { id: 'pe' }, script: { language: 'powershell' } },
  });
  ok(
    'variáveis da amostra',
    ctx.filename === 'Script.PS1' &&
      ctx.extension === '.ps1' &&
      ctx.filetype === 'PowerShell' &&
      ctx.filepath === '' &&
      ctx.owner === '',
    ctx,
  );
  ok(
    'tipo do arquivo',
    scanContextOf({ originalFilename: 'a', staticInfo: { detectedType: { id: 'elf' } } })
      .filetype === 'ELF',
  );
  ok('sem extensão', scanContextOf({ originalFilename: '.bashrc' }).extension === '');
  const custom = await req('POST', '/api/yara/rules', cAna, {
    name: 'Por variável',
    source: 'rule por_variavel { condition: filename == "marca.exe" and filetype == "EXE" }',
  });
  ok('regra da equipe pode usar as variáveis', custom.statusCode === 201, custom.body);
  ok(
    'variável na regra da equipe',
    (
      await scanWithYara(
        MZ,
        scanContextOf({
          originalFilename: 'marca.exe',
          staticInfo: { detectedType: { id: 'pe' } },
        }),
      )
    ).hits.some((h) => h.identifier === 'por_variavel'),
  );
  await prisma.yaraRule.delete({ where: { id: custom.json().rule.id } });

  // 7. Desligar o pacote guarda as escolhas; religar nao reinstala.
  await req('PATCH', `/api/yara/rules/${sigRule.id}`, cAna, { enabled: false });
  await toggle(cAdm, 'signature-base', false);
  ok('desligado não detecta', (await scanWithYara(SIGNATURE)).hits.length === 0);
  ok(
    'as regras ficam guardadas',
    (await countOf('signature-base')) === manifest['signature-base'].files.length,
  );
  await toggle(cAdm, 'signature-base', true);
  ok(
    'religar mantém o que foi desligado',
    (await prisma.yaraRule.findUniqueOrThrow({ where: { id: sigRule.id } })).enabled === false,
  );
  await toggle(cAdm, 'signature-base', false);
  ok('dá para desligar um padrão', (await toggle(cAdm, 'reversinglabs', false)).statusCode === 200);
  ok('subida respeita o desligado', (await installYaraPacks()).length === 0);
  await toggle(cAdm, 'reversinglabs', true);

  // 8. Pelo caminho real: envio, ficha e varredura retroativa na thread.
  const boundary = 'xxBOUNDARYxx';
  const sent = await app.inject({
    method: 'POST',
    url: '/api/entries/file',
    headers: { cookie: cBob, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="a.bin"',
      'Content-Type: application/octet-stream',
      '',
      BARTBLAZE.toString('latin1'),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  });
  const entryId = sent.json().entry.id as string;
  let scan: { status: string; matches: { author: string; pack: string }[] } | null = null;
  for (let i = 0; i < 60 && (!scan || scan.status === 'PENDING'); i++) {
    await sleep(500);
    scan = (await req('GET', `/api/entries/${entryId}/yara`, cBob)).json().scan;
  }
  ok('envio marcado', scan?.status === 'MATCHED', scan);
  ok(
    'ficha com o autor',
    scan?.matches[0]?.author === '@bartblaze' && scan?.matches[0]?.pack === 'bartblaze',
    scan,
  );

  const own = await req('POST', '/api/yara/rules', cAna, {
    name: 'Da equipe',
    source: 'rule da_equipe { strings: $a = "ApplicationDllHijacking" condition: $a }',
  });
  const retro = await req('POST', `/api/yara/rules/${own.json().rule.id}/retroscan`, cAna, {});
  ok('retroativa começa', retro.statusCode === 202, retro.body);
  let status = 'RUNNING';
  let matched = 0;
  for (let i = 0; i < 60 && status === 'RUNNING'; i++) {
    await sleep(500);
    const r = (await req('GET', `/api/yara/retroscans/${retro.json().retroscan.id}`, cAna)).json()
      .retroscan;
    status = r.status;
    matched = r.matched;
  }
  ok('retroativa termina na thread', status === 'DONE' && matched === 1, { status, matched });
  ok(
    'regra da equipe sem pacote',
    (await scanWithYara(BARTBLAZE)).hits.some(
      (h) => h.identifier === 'da_equipe' && h.pack === null && h.author === null,
    ),
  );
  ok(
    'regra de pacote também na retroativa',
    (await req('POST', `/api/yara/rules/${ruleId}/retroscan`, cAna, {})).statusCode === 202,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
