import { PutObjectCommand } from '@aws-sdk/client-s3';
import QRCode from 'qrcode';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { enqueueQr, qrIdle, qrTiming, startQrQueue, stopQrQueue } from '../../src/lib/qr';
import { ensureBucket, s3 } from '../../src/lib/s3';

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

/** PDF de uma pagina com o QR desenhado como retangulos (sem imagem embutida). */
function qrPdf(text: string): Buffer {
  const qr = QRCode.create(text, {});
  const n = qr.modules.size;
  const cell = 6;
  let ops = '0 0 0 rg\n';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c))
        ops += `${100 + c * cell} ${400 + (n - r) * cell} ${cell} ${cell} re f\n`;
    }
  }
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${ops.length} >>\nstream\n${ops}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Plano pos-revisao, item 2.2: QR code em imagens, PDFs e no print da pagina, lido pelo servico
// oletools de verdade (POST /qr).
async function main() {
  await ensureBucket(3, 500);
  env.OLETOOLS_URL = 'http://localhost:53500';
  env.OLETOOLS_TOKEN = '0123456789abcdef01';
  Object.assign(qrTiming, { serviceWaitMs: 30_000, retryEveryMs: 300, retryAfterMs: 0 });
  const app = await buildApp();
  await app.ready();
  await startQrQueue({ info: () => undefined, error: (o, m) => console.log('LOG', m, o) });
  stopQrQueue();

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
    return r.json<{ entry: { id: string } }>().entry.id;
  };
  type Qr = {
    applicable: boolean;
    scan: {
      status: string;
      error: string | null;
      codes: { text: string; source: string; page: number | null; url: string | null }[] | null;
    } | null;
  };
  const qrOf = async (id: string, c = cAna) =>
    (
      await app.inject({ method: 'GET', url: `/api/entries/${id}/qr`, headers: { cookie: c } })
    ).json<Qr>();

  // 1. Imagem com QR code: lida no envio.
  const link = 'https://boleto-falso.example/pagar?id=123';
  const png = await upload('boleto.png', await QRCode.toBuffer(link, { width: 300 }));
  await qrIdle();
  const fromPng = await qrOf(png);
  ok(
    'PNG: o endereço, como link, vindo da imagem',
    fromPng.scan?.status === 'DONE' &&
      fromPng.scan.codes?.length === 1 &&
      fromPng.scan.codes[0].text === link &&
      fromPng.scan.codes[0].url === link &&
      fromPng.scan.codes[0].source === 'image',
    fromPng,
  );

  // 2. PDF com o QR desenhado (vetor): a pagina e renderizada e lida.
  const pdf = await upload('fatura.pdf', qrPdf('https://pdf-qr.example/login'));
  await qrIdle();
  const fromPdf = await qrOf(pdf);
  ok(
    'PDF: o código da página 1',
    fromPdf.scan?.codes?.[0]?.text === 'https://pdf-qr.example/login' &&
      fromPdf.scan.codes[0].source === 'pdf' &&
      fromPdf.scan.codes[0].page === 1,
    fromPdf,
  );

  // 3. Texto que nao e endereco: aparece, mas sem link.
  const pix = await upload('pix.png', await QRCode.toBuffer('PIX 00020126 chave', { width: 300 }));
  await qrIdle();
  const fromPix = await qrOf(pix);
  ok(
    'texto que não é endereço: sem link',
    fromPix.scan?.codes?.[0]?.text === 'PIX 00020126 chave' && fromPix.scan.codes[0].url === null,
    fromPix,
  );

  // 4. Executavel nao vai para o leitor.
  const exe = await upload('a.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]));
  await qrIdle();
  const fromExe = await qrOf(exe);
  ok(
    'executável: não se aplica e não foi lido',
    !fromExe.applicable && fromExe.scan === null,
    fromExe,
  );

  // 5. Amostra de link: o print da captura mais recente.
  const site = await prisma.entry.create({
    data: { type: 'URL', title: 'site', url: 'https://site.example/', ownerId: ana.id },
  });
  const shotKey = `captures/${site.id}/print.png`;
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: shotKey,
      Body: await QRCode.toBuffer('https://no-print.example/', { width: 300 }),
    }),
  );
  await prisma.pageCapture.create({
    data: {
      entryId: site.id,
      status: 'DONE',
      url: 'https://site.example/',
      screenshotKey: shotKey,
      finishedAt: new Date(),
    },
  });
  await enqueueQr(site.id);
  await qrIdle();
  const fromShot = await qrOf(site.id);
  ok(
    'link: o código do print da página',
    fromShot.scan?.codes?.[0]?.text === 'https://no-print.example/' &&
      fromShot.scan.codes[0].source === 'screenshot',
    fromShot,
  );

  // 6. Risco: QR code com link conta como motivo.
  const risk = (
    await app.inject({ method: 'GET', url: `/api/entries/${png}/risk`, headers: { cookie: cAna } })
  ).json<{ risk: { reasons: { source: string; text: string }[] } }>().risk;
  ok(
    'risco: motivo do QR code com link',
    risk.reasons.some((r) => r.source === 'QR code' && r.text.includes('boleto-falso.example')),
    risk.reasons,
  );

  // 7. Acesso: usuario comum nao pede a leitura nem ve a amostra de outra pessoa.
  const again = await app.inject({
    method: 'POST',
    url: `/api/entries/${png}/qr`,
    headers: { cookie: cUser },
  });
  ok('usuário comum não pede a leitura', again.statusCode === 403, again.statusCode);
  const asAnalyst = await app.inject({
    method: 'POST',
    url: `/api/entries/${png}/qr`,
    headers: { cookie: cAna },
  });
  ok('analista pede de novo', asAnalyst.statusCode === 202, asAnalyst.body);
  const twice = await app.inject({
    method: 'POST',
    url: `/api/entries/${png}/qr`,
    headers: { cookie: cAna },
  });
  ok('na fila: não pede duas vezes', twice.statusCode === 409, twice.statusCode);
  await qrIdle();
  const notExe = await app.inject({
    method: 'POST',
    url: `/api/entries/${exe}/qr`,
    headers: { cookie: cAna },
  });
  ok('executável: recusado', notExe.statusCode === 400, notExe.body);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
