import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';
import { SAMPLE_ZIP_PASSWORD } from '../../src/lib/sample-zip';
import { extractZipEntry, listZip } from '../../src/lib/zip';

// Download separado dos recursos (plans/analise-estatica-ampliada, item 30), contra executaveis de
// verdade (tests/fixtures/pe/gen.sh): o icone.exe tem um icone de duas imagens (DIB e PNG), um
// cursor e um bitmap com paleta, compilados pelo windres a partir de arquivos montados a mao; o
// recurso remontado tem de sair igual, byte a byte, ao arquivo original. O dotnet-loader.exe traz
// um executavel como recurso .NET (o carga.bin, que e o prog32.exe).

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};
const DIR = join(process.env.TEST_TMP!, 'pe');
const file = (name: string) => readFileSync(join(DIR, name));

/** O conteudo do ZIP com senha: nome -> bytes. */
function unzip(buf: Buffer): Map<string, Buffer> {
  return new Map(
    listZip(buf).map((e) => [e.name, extractZipEntry(buf, e, SAMPLE_ZIP_PASSWORD, 1 << 26)]),
  );
}

async function main() {
  env.CLAMAV_HOST = '';
  env.UPLOAD_DAILY_LIMIT = 0;
  await ensureBucket();
  const app = await buildApp();
  await app.ready();
  const login = async (email: string, role: 'ANALYST' | 'USER') => {
    await prisma.user.create({
      data: { email, displayName: email, role, passwordHash: await hashPassword('senha-123!') },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'senha-123!' },
    });
    return String(r.headers['set-cookie']).split(';')[0];
  };
  const analyst = await login('ana@x.io', 'ANALYST');
  const other = await login('rui@x.io', 'USER');
  const upload = async (name: string, data: Buffer, cookie = analyst): Promise<string> => {
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
  const get = (url: string, cookie = analyst) =>
    app.inject({ method: 'GET', url, headers: { cookie } });

  const id = await upload('icone.exe', file('icone.exe'));
  const row = await prisma.entry.findUnique({ where: { id } });
  const resources = (row?.staticInfo as any)?.pe?.resources as { type: string; name: string }[];
  const at = (type: string) => resources.findIndex((r) => r.type === type);
  ok(
    'a ficha lista o grupo de ícones, o cursor e o bitmap',
    at('GROUP_ICON') >= 0 && at('GROUP_CURSOR') >= 0 && at('BITMAP') >= 0 && at('ICON') >= 0,
    resources,
  );

  const icon = await get(`/api/entries/${id}/resources/${at('GROUP_ICON')}`);
  ok(
    'GROUP_ICON sai como .ico igual ao original (DIB e PNG)',
    icon.statusCode === 200 &&
      icon.rawPayload.equals(file('teste.ico')) &&
      /filename="GROUP_ICON_1_1046\.ico"/.test(String(icon.headers['content-disposition'])) &&
      icon.headers['content-type'] === 'application/octet-stream' &&
      icon.headers['x-content-type-options'] === 'nosniff',
    { status: icon.statusCode, headers: icon.headers, size: icon.rawPayload.length },
  );
  const cursor = await get(`/api/entries/${id}/resources/${at('GROUP_CURSOR')}`);
  ok(
    'GROUP_CURSOR sai como .cur igual ao original (ponto quente na entrada)',
    cursor.statusCode === 200 && cursor.rawPayload.equals(file('teste.cur')),
    cursor.rawPayload.subarray(0, 32).toString('hex'),
  );
  const bitmap = await get(`/api/entries/${id}/resources/${at('BITMAP')}`);
  ok(
    'BITMAP sai como .bmp com o cabeçalho refeito (paleta de 256 cores)',
    bitmap.statusCode === 200 && bitmap.rawPayload.equals(file('teste.bmp')),
    bitmap.rawPayload.subarray(0, 16).toString('hex'),
  );
  const png = resources.findIndex((r, i) => r.type === 'ICON' && i !== at('ICON'));
  const single = await get(`/api/entries/${id}/resources/${png}`);
  ok(
    'imagem PNG de um ICON sai como .png',
    single.statusCode === 200 &&
      single.rawPayload.readUInt32BE(0) === 0x89504e47 &&
      /\.png"/.test(String(single.headers['content-disposition'])),
    single.headers,
  );

  const all = await get(`/api/entries/${id}/resources`);
  const inside = all.statusCode === 200 ? unzip(all.rawPayload) : new Map();
  ok(
    'baixar todos: ZIP com senha, um arquivo por recurso',
    all.headers['x-deeplook-zip-password'] === SAMPLE_ZIP_PASSWORD &&
      inside.size === resources.length &&
      inside.get('GROUP_ICON_1_1046.ico')?.equals(file('teste.ico')) === true,
    [...inside.keys()],
  );

  // Recurso que nao e imagem (um executavel): dentro do ZIP com senha.
  const prog = await upload('prog64.exe', file('prog64.exe'));
  const progRes = ((await prisma.entry.findUnique({ where: { id: prog } }))?.staticInfo as any).pe
    .resources as { type: string; name: string; content: string | null }[];
  const payloadAt = progRes.findIndex((r) => r.content === 'pe');
  const payload = await get(`/api/entries/${prog}/resources/${payloadAt}`);
  const payloadZip = payload.statusCode === 200 ? unzip(payload.rawPayload) : new Map();
  ok(
    'executável num RCDATA sai dentro do ZIP com senha',
    payload.headers['content-type'] === 'application/zip' &&
      payloadZip.get('RCDATA_101_1046.exe')?.equals(file('payload.bin')) === true,
    { headers: payload.headers, names: [...payloadZip.keys()] },
  );

  // Recursos .NET (ManifestResource).
  const net = await upload('carregador.exe', file('dotnet-loader.exe'));
  const netInfo = ((await prisma.entry.findUnique({ where: { id: net } }))?.staticInfo as any).pe
    .dotnet;
  ok(
    '.NET: a ficha lista o recurso embutido, com o conteúdo reconhecido',
    netInfo.resources?.length === 1 &&
      netInfo.resources[0].name === 'carga.bin' &&
      netInfo.resources[0].content === 'pe' &&
      netInfo.resources[0].size === file('prog32.exe').length,
    netInfo.resources,
  );
  const netRes = await get(`/api/entries/${net}/resources/0?source=dotnet`);
  ok(
    '.NET: o recurso sai dentro do ZIP com senha, igual ao arquivo embutido',
    netRes.statusCode === 200 &&
      unzip(netRes.rawPayload).get('carga.bin')?.equals(file('prog32.exe')) === true,
    netRes.statusCode,
  );

  // Regras de acesso e erros.
  const theirs = await get(`/api/entries/${id}/resources/0`, other);
  const missing = await get(`/api/entries/${id}/resources/999`);
  const notPe = await upload('leia.txt', Buffer.from('so texto'));
  const text = await get(`/api/entries/${notPe}/resources`);
  const bare = await upload('minimo.exe', file('payload.bin'));
  const none = await get(`/api/entries/${bare}/resources`);
  ok(
    'só quem enviou e os analistas; índice fora da lista; arquivo que não é PE; PE sem recursos',
    theirs.statusCode === 403 &&
      missing.statusCode === 404 &&
      text.statusCode === 422 &&
      none.statusCode === 404,
    [theirs.statusCode, missing.statusCode, text.statusCode, none.statusCode],
  );
  const mine = await upload('meu.exe', file('icone.exe'), other);
  const own = await get(`/api/entries/${mine}/resources/0`, other);
  ok('quem enviou baixa os recursos da própria amostra', own.statusCode === 200, own.statusCode);
  const english = await app.inject({
    method: 'GET',
    url: `/api/entries/${id}/resources/0`,
    headers: { cookie: other, 'accept-language': 'en' },
  });
  ok(
    'erro em inglês',
    english.json().error === 'Only the submitter and analysts download the resources.',
    english.body,
  );

  const audits = await prisma.auditEvent.findMany({
    where: { action: 'ENTRY_DOWNLOADED' },
    orderBy: { createdAt: 'asc' },
  });
  ok(
    'cada download vai para a Auditoria, com o recurso e a forma',
    audits.some((a) => a.detail === 'Recurso GROUP_ICON/1 (1046) · imagem') &&
      audits.some(
        (a) => a.detail === `Todos os recursos (${resources.length}) · ZIP com senha (infected)`,
      ) &&
      audits.some((a) => a.detail === 'Recurso .NET carga.bin · ZIP com senha (infected)'),
    audits.map((a) => a.detail),
  );

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
