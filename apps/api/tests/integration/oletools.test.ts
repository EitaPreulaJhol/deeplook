import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateRawSync } from 'node:zlib';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import {
  officeAlerts,
  oletoolsIdle,
  oletoolsTiming,
  startOletoolsQueue,
  stopOletoolsQueue,
} from '../../src/lib/oletools';
import { prisma } from '../../src/lib/prisma';
import { riskOf } from '../../src/lib/risk-score';
import { ensureBucket } from '../../src/lib/s3';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const REAL = 'http://localhost:53500';
const TOKEN = '0123456789abcdef01';

/** ZIP minimo (deflate) para montar um .docx sem ferramenta externa. */
function zip(files: [string, string][]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(data) >>> 0, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    head.copy(cd, 10, 8, 30);
    cd.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, body);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBuf, end]);
}

/** DOCX com campo DDEAUTO (executa um comando ao abrir, sem macro). */
const ddeDocx = () =>
  zip([
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc.exe" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>',
    ],
  ]);

/** RTF com um objeto OLE1 do Equation Editor (o alvo do CVE-2017-11882). */
function equationRtf(): Buffer {
  const le = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const cls = Buffer.from('Equation.3\0', 'latin1');
  const native = Buffer.from('d0cf11e0a1b11ae10000000000000000', 'hex');
  const ole1 = Buffer.concat([
    le(0x0501),
    le(2),
    le(cls.length),
    cls,
    le(0),
    le(0),
    le(native.length),
    native,
  ]);
  return Buffer.from(
    `{\\rtf1\\ansi{\\object\\objemb{\\*\\objclass Equation.3}{\\*\\objdata ${ole1.toString('hex')}}}}`,
    'latin1',
  );
}

// Office e PDF mais fundo (item 7.14; revisao de novembro, 3.2): o servico oletools de verdade e,
// para o caminho das macros e das falhas, um servico falso.
async function main() {
  await ensureBucket(3, 500);
  env.OLETOOLS_URL = REAL;
  env.OLETOOLS_TOKEN = TOKEN;
  Object.assign(oletoolsTiming, { serviceWaitMs: 30_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startOletoolsQueue(log);
  stopOletoolsQueue();

  const passwordHash = await hashPassword('senha-123!');
  await prisma.user.create({
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
      headers: { cookie: cAna, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };
  const office = async (id: string, c = cAna) =>
    (
      await app.inject({ method: 'GET', url: `/api/entries/${id}/office`, headers: { cookie: c } })
    ).json();

  // ---- 1. Servico de verdade: DDE e objeto do Equation Editor.
  const dde = await upload('pedido.docx', ddeDocx());
  await oletoolsIdle();
  const d = await office(dde);
  ok(
    'docx vai sozinho para a fila e conclui',
    d.enabled && d.eligible && d.analysis?.status === 'DONE',
    d.analysis,
  );
  ok(
    'DDE achado pelo msodde, com o comando',
    d.analysis?.result?.dde?.links?.some(
      (l: string) => l.includes('DDEAUTO') && l.includes('cmd.exe'),
    ),
    d.analysis?.result?.dde,
  );
  ok(
    'alerta alto do DDE',
    d.analysis?.alerts?.some(
      (a: { level: string; text: string }) => a.level === 'high' && a.text.startsWith('Campo DDE'),
    ),
    d.analysis?.alerts,
  );
  ok('versão do oletools guardada', /^0\.\d+/.test(d.analysis?.version ?? ''), d.analysis?.version);
  ok(
    'oleid identifica o formato',
    d.analysis?.result?.oleid?.indicators?.some((i: { value: string }) =>
      i.value?.includes('Word 2007'),
    ),
    d.analysis?.result?.oleid,
  );

  const rtf = await upload('fatura.rtf', equationRtf());
  await oletoolsIdle();
  const r = await office(rtf);
  ok(
    'RTF: objeto do Equation Editor vira alerta alto',
    r.analysis?.status === 'DONE' &&
      r.analysis.alerts.some((a: { text: string }) => a.text.includes('Equation')),
    {
      status: r.analysis?.status,
      alerts: r.analysis?.alerts,
      rtf: r.analysis?.result?.rtf,
      err: r.analysis?.error,
    },
  );
  ok(
    'RTF: o olevba não aparece como erro',
    r.analysis?.result?.vba?.error === null,
    r.analysis?.result?.vba?.error,
  );

  const exe = await upload('programa.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]));
  await oletoolsIdle();
  const e = await office(exe);
  ok('executável não vai para o oletools', !e.eligible && e.analysis === null, e);

  // ---- 2. Macros (servico falso): alertas e pontuacao de risco.
  const macroResult = {
    ok: true,
    version: '0.60.2',
    ms: 40,
    vba: {
      macros: true,
      xlm: true,
      stomping: false,
      modules: [
        {
          name: 'Module1',
          lines: 6,
          code: 'Sub AutoOpen()\n Shell "powershell -enc x"\nEnd Sub',
          truncated: false,
        },
      ],
      keywords: [
        {
          type: 'AutoExec',
          keyword: 'AutoOpen',
          description: 'Runs when the Word document is opened',
        },
        { type: 'IOC', keyword: 'http://evil.example/a.exe', description: 'URL' },
        {
          type: 'Base64 String',
          keyword: 'abc',
          description: 'Base64 encoded strings were detected',
        },
      ],
      xlmLines: ['EXEC("calc.exe")'],
      mraptor: { suspicious: true, autoexec: true, write: false, execute: true, flags: 'A-X' },
      error: null,
    },
    dde: { links: [], error: null },
    oleid: { indicators: [], error: null },
    rtf: null,
  };
  let reply: { status: number; body: unknown } = { status: 200, body: macroResult };
  let posts = 0;
  const fake = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true,"state":"livre"}');
    }
    req.resume();
    req.on('end', () => {
      posts++;
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  env.OLETOOLS_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  const macro = await upload('planilha.docx', ddeDocx());
  await oletoolsIdle();
  const m = await office(macro);
  const texts = (m.analysis?.alerts ?? []).map((a: { text: string }) => a.text);
  ok(
    'macro: MacroRaptor, XLM 4.0, indicadores e texto ofuscado viram alertas',
    texts.some((t: string) =>
      t.startsWith('Macro suspeita pelo MacroRaptor: executa ao abrir, executa programas'),
    ) &&
      texts.some((t: string) => t.includes('XLM 4.0')) &&
      texts.some((t: string) => t.startsWith('1 indicador(es)')) &&
      texts.some((t: string) => t.includes('decodificado')),
    texts,
  );
  const risk = await riskOf(macro);
  ok(
    'pontuação de risco recebe o oletools',
    risk?.reasons.some((x) => x.source === 'Documento (oletools)' && x.weight === 30),
    risk?.reasons,
  );
  ok('mesmos alertas pela função pura', officeAlerts(macroResult as never).length === texts.length);

  // ---- 3. Resposta estranha e falha da analise.
  reply = { status: 200, body: { ok: true, vba: { macros: 'sim' } } };
  await app.inject({
    method: 'POST',
    url: `/api/entries/${macro}/office`,
    headers: { cookie: cAna },
  });
  await oletoolsIdle();
  ok(
    'formato inesperado: falha com o motivo',
    (await office(macro)).analysis?.error === 'resposta do serviço em formato inesperado',
  );
  reply = { status: 200, body: { ok: false, error: 'tempo esgotado (120 s)', version: '0.60.2' } };
  await app.inject({
    method: 'POST',
    url: `/api/entries/${macro}/office`,
    headers: { cookie: cAna },
  });
  await oletoolsIdle();
  const failed = (await office(macro)).analysis;
  ok(
    'análise que falhou no serviço: o motivo dele',
    failed?.status === 'FAILED' && failed.error === 'tempo esgotado (120 s)',
    failed,
  );

  // ---- 4. Pedir de novo: so analista, e nao duas vezes.
  ok(
    'usuário comum não pede',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${macro}/office`,
        headers: { cookie: cUser },
      })
    ).statusCode === 403,
  );
  ok(
    'executável: 400',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${exe}/office`,
        headers: { cookie: cAna },
      })
    ).statusCode === 400,
  );
  await prisma.officeAnalysis.update({
    where: { entryId: macro },
    data: { status: 'PENDING', nextAttemptAt: new Date(Date.now() + 3600_000) },
  });
  ok(
    'já na fila: 409',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${macro}/office`,
        headers: { cookie: cAna },
      })
    ).statusCode === 409,
  );

  // ---- 5. Servico fora do ar: tenta de novo e, na ultima tentativa, falha.
  fake.close();
  Object.assign(oletoolsTiming, { serviceWaitMs: 500, retryEveryMs: 100, retryAfterMs: 0 });
  const down = await upload('outro.docx', ddeDocx());
  for (let i = 0; i < 3; i++) {
    await prisma.officeAnalysis.updateMany({
      where: { entryId: down, status: 'PENDING' },
      data: { nextAttemptAt: new Date(0) },
    });
    await startOletoolsQueue(log);
    stopOletoolsQueue();
    await oletoolsIdle();
  }
  const gave = (await office(down)).analysis;
  ok(
    'serviço fora: três tentativas e falha com o motivo',
    gave?.status === 'FAILED' && gave.attempts === 3 && gave.error.includes('não respondeu'),
    gave,
  );
  ok('o serviço falso recebeu só as análises pedidas', posts === 3, posts);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
