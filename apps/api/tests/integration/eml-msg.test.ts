import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

// Outlook .msg (plans/analise-estatica-ampliada, item 10), com os exemplos do Email::Outlook::Message
// (tests/fixtures/pe/gen.sh): o remetente, os saltos e o anexo saem como os do .eml; o rascunho,
// sem cabecalhos de transporte, so com as propriedades do Outlook.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
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

  const id = await upload('relato.msg', file('outlook-anexo.msg'));
  const row = await prisma.entry.findUnique({ where: { id } });
  const info = row?.emailInfo as any;
  const child = await prisma.entry.findFirst({ where: { parentEntryId: id } });
  ok(
    '.msg: assunto, remetente, saltos e o anexo como amostra filha',
    info?.subject === 'test' &&
      info.from?.address === 'Matijs.van.Zuijlen@xs4all.nl' &&
      info.received.length === 5 &&
      info.attachments.length === 1 &&
      info.attachments[0].filename === 'test.jpg' &&
      info.attachments[0].entryId === child?.id &&
      child?.originalFilename === 'test.jpg' &&
      child.fileSize === 7681 &&
      row?.title === 'E-mail: test',
    { info, child: child?.originalFilename },
  );

  // Pelo conteudo, mesmo com outro nome.
  const draft = await upload('mensagem.bin', file('outlook-rascunho.msg'));
  const draftInfo = (await prisma.entry.findUnique({ where: { id: draft } }))?.emailInfo as any;
  ok(
    'rascunho sem cabeçalhos, reconhecido pelo conteúdo: assunto e corpo das propriedades',
    draftInfo?.subject === 'Test for MSGConvert -- plain text' &&
      draftInfo.body.includes('The body is in plain text') &&
      draftInfo.received.length === 0,
    draftInfo,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
