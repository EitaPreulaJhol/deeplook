import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import {
  oletoolsIdle,
  oletoolsTiming,
  startOletoolsQueue,
  stopOletoolsQueue,
} from '../../src/lib/oletools';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { sampleZipBuffer } from '../../src/lib/sample-zip';

// Senhas candidatas e Office cifrado (plans/analise-estatica-ampliada, item 9), com o servico
// oletools de verdade e os documentos cifrados pelo Office que o msoffcrypto-tool usa nos testes dele
// (tests/fixtures/pe/gen.sh): um e-mail com a senha no corpo, um .docx (ECMA-376) e um .xls (RC4)
// cifrados com ela e um ZIP com a mesma senha. O .xls sozinho, sem o e-mail, fica cifrado.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const TOKEN = '0123456789abcdef01';

async function main() {
  await ensureBucket(3, 500);
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  env.OLETOOLS_URL = 'http://localhost:53500';
  env.OLETOOLS_TOKEN = TOKEN;
  Object.assign(oletoolsTiming, { serviceWaitMs: 30_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  const log = { info: () => undefined, error: (o: object, m: string) => console.log('LOG', m, o) };
  await startOletoolsQueue(log);
  stopOletoolsQueue();
  await prisma.user.create({
    data: {
      email: 'ana@x.io',
      displayName: 'ana',
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
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    return r.json().entry.id;
  };

  const payload = Buffer.from('MZ' + 'carga de teste '.repeat(40));
  const packed = sampleZipBuffer([{ name: 'carga.exe', data: payload }], {
    password: 'Password1234_',
  });
  const part = (name: string, data: Buffer) =>
    `--b1\r\nContent-Type: application/octet-stream; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${data.toString('base64').replace(/.{76}/g, '$&\r\n')}\r\n`;
  const eml = Buffer.from(
    [
      'From: "Financeiro" <cobranca@evil.test>',
      'To: vitima@empresa.test',
      'Subject: Fatura em anexo',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Segue a fatura. A senha do arquivo é: Password1234_',
      '',
      part('fatura.docx', file('office-cifrado.docx')) +
        part('planilha.xls', file('office-cifrado.xls')) +
        part('documentos.zip', packed) +
        '--b1--',
    ].join('\r\n'),
  );
  const mail = await upload('cobranca.eml', eml);
  await oletoolsIdle();
  const info = (await prisma.entry.findUnique({ where: { id: mail } }))?.emailInfo as any;
  const zipItem = info.attachments.find(
    (a: { filename: string }) => a.filename === 'documentos.zip',
  );
  const zipChild = await prisma.entry.findUnique({ where: { id: zipItem.entryId } });
  const inner = await prisma.entry.findFirst({ where: { parentEntryId: zipChild!.id } });
  ok(
    'ZIP com senha do anexo: aberto com a senha do corpo, o conteúdo vira amostra',
    zipItem.password === 'Password1234_' && inner?.sha256 === sha(payload),
    { zipItem, inner: inner?.originalFilename },
  );

  const docItem = info.attachments.find((a: { filename: string }) => a.filename === 'fatura.docx');
  const office = await prisma.officeAnalysis.findUnique({ where: { entryId: docItem.entryId } });
  const decrypted = (office?.result as any)?.decrypted;
  const plain = await prisma.entry.findFirst({ where: { parentEntryId: docItem.entryId } });
  ok(
    '.docx cifrado: decifrado com a senha do e-mail, o original vira amostra filha',
    office?.status === 'DONE' &&
      decrypted?.password === 'Password1234_' &&
      decrypted.data === null &&
      decrypted.entryId === plain?.id &&
      plain?.originalFilename === 'fatura-decifrado.docx' &&
      (plain.staticInfo as any)?.detectedType?.id === 'docx',
    { office: office?.status, error: office?.error, decrypted, plain: plain?.originalFilename },
  );
  const xlsItem = info.attachments.find((a: { filename: string }) => a.filename === 'planilha.xls');
  const xls = (await prisma.officeAnalysis.findUnique({ where: { entryId: xlsItem.entryId } }))
    ?.result as any;
  const xlsPlain = await prisma.entry.findFirst({ where: { parentEntryId: xlsItem.entryId } });
  ok(
    '.xls com RC4 (formato antigo): decifrado, e o resultado é um OLE',
    xls?.decrypted?.password === 'Password1234_' &&
      xlsPlain?.originalFilename === 'planilha-decifrado.xls' &&
      (xlsPlain.staticInfo as any)?.detectedType?.id === 'ole',
    { decrypted: xls?.decrypted, plain: xlsPlain?.originalFilename },
  );

  const alone = await upload('sozinho.xls', file('office-cifrado.xls'));
  await oletoolsIdle();
  const aloneResult = (await prisma.officeAnalysis.findUnique({ where: { entryId: alone } }))
    ?.result as any;
  ok(
    'sem o e-mail (sem a senha): fica cifrado, sem amostra inventada',
    aloneResult?.decrypted?.encrypted === true &&
      aloneResult.decrypted.password === null &&
      (await prisma.entry.count({ where: { parentEntryId: alone } })) === 0,
    aloneResult?.decrypted,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
