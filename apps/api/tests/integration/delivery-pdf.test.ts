import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

// PDF (plans/analise-estatica-ampliada, item 8), com arquivos gerados por ferramenta real
// (tests/fixtures/pe/pdfgen.py e o qpdf): JavaScript na abertura, SubmitForm e um executavel
// anexado, em claro, com objetos em ObjStm e cifrado pelo qpdf com a senha de usuario vazia (RC4,
// AES-128 e AES-256) e com senha de verdade.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

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
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
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
  const payload = sha(file('payload.bin'));

  for (const [name, method] of [
    ['anexo.pdf', null],
    ['anexo-objstm.pdf', null],
    ['anexo-rc4.pdf', 'RC4'],
    ['anexo-aes128.pdf', 'AES-128'],
    ['anexo-aes256.pdf', 'AES-256'],
  ] as const) {
    const id = await upload(name, file(name));
    const row = await prisma.entry.findUnique({ where: { id } });
    const info = row?.staticInfo as any;
    const pdf = info?.document?.pdf;
    const child = await prisma.entry.findFirst({ where: { parentEntryId: id } });
    ok(
      `${name}: JavaScript, SubmitForm e o executável anexado vira filha`,
      pdf?.javascript &&
        pdf.submitForm &&
        pdf.scripts === 1 &&
        info.script?.language === 'javascript' &&
        info.delivery?.format === 'pdf' &&
        info.delivery.risk === 'high' &&
        child?.sha256 === payload &&
        child.originalFilename === 'fatura.exe' &&
        (method === null
          ? pdf.encryption === null
          : pdf.encryption?.method === method && pdf.encryption.decrypted === true),
      { pdf, delivery: info?.delivery, child: child?.originalFilename },
    );
  }

  const locked = await upload('anexo-senha.pdf', file('anexo-senha.pdf'));
  const lockedInfo = (await prisma.entry.findUnique({ where: { id: locked } }))?.staticInfo as any;
  ok(
    'com senha de verdade: não decifra, nada é inventado a partir dos bytes cifrados',
    lockedInfo.document.pdf.encryption?.decrypted === false &&
      lockedInfo.document.pdf.scripts === 0 &&
      !lockedInfo.delivery &&
      !lockedInfo.script &&
      (await prisma.entry.count({ where: { parentEntryId: locked } })) === 0 &&
      lockedInfo.document.alerts.some((a: { text: string }) => a.text.startsWith('Criptografado')),
    lockedInfo.document,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
