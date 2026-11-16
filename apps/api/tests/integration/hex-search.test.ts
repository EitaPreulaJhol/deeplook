export {};

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

// Visualizador hexadecimal e a busca (plans/ajustes-usabilidade, item 7): o arquivo inteiro, lido
// do MinIO por faixa e em fluxo; so analistas.
async function main() {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { env } = await import('../../src/env');
  const { hashPassword } = await import('../../src/lib/crypto');
  const { prisma } = await import('../../src/lib/prisma');
  const { ensureBucket, s3 } = await import('../../src/lib/s3');
  const { buildApp } = await import('../../src/app');
  await ensureBucket(3, 500);
  const app = await buildApp();
  await app.ready();

  const passwordHash = await hashPassword('senha-123!');
  const login = async (email: string, role: 'ANALYST' | 'USER') => {
    await prisma.user.create({ data: { email, displayName: email, role, passwordHash } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'senha-123!' },
    });
    return String(res.headers['set-cookie']).split(';')[0];
  };
  const ana = await login('ana@hex.io', 'ANALYST');
  const bob = await login('bob@hex.io', 'USER');
  const get = (url: string, cookie = ana) =>
    app.inject({ method: 'GET', url, headers: { cookie } });

  // 300 KB: um URL em ASCII aos 100 000 bytes, o mesmo em UTF-16 aos 200 000, e "MZ\x90" no fim.
  const file = Buffer.alloc(300_000, 0x41);
  Buffer.from('HTTP://c2.evil.example').copy(file, 100_000);
  Buffer.from('http://c2.evil.example', 'utf16le').copy(file, 200_000);
  Buffer.from([0x4d, 0x5a, 0x90]).copy(file, 299_990);
  const key = `samples/hex-${Date.now()}.bin`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: file }));
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'ana@hex.io' } });
  const entry = await prisma.entry.create({
    data: {
      type: 'FILE',
      title: 'grande.bin',
      ownerId: owner.id,
      storageKey: key,
      bucket: env.S3_BUCKET,
      originalFilename: 'grande.bin',
      fileSize: file.length,
    },
  });
  const base = `/api/entries/${entry.id}/hex`;

  // ---- 1. Leitura em qualquer posicao (antes, so ate 64 KB).
  const far = (await get(`${base}?offset=100000&length=22`)).json();
  ok(
    'bloco depois dos 64 KB: os bytes certos e o arquivo inteiro como limite',
    Buffer.from(far.data, 'base64').toString() === 'HTTP://c2.evil.example' &&
      far.limit === file.length &&
      far.size === file.length,
    far,
  );
  ok('depois do fim: vazio', (await get(`${base}?offset=300000`)).json().data === '');

  // ---- 2. Busca por texto: sem diferenciar maiusculas, ASCII e UTF-16.
  const text = (await get(`${base}/search?q=${encodeURIComponent('http://C2.evil')}`)).json();
  ok(
    'texto: as duas posições, com a codificação e o tamanho',
    JSON.stringify(text.hits) ===
      JSON.stringify([
        { offset: 100_000, length: 14, encoding: 'utf8' },
        { offset: 200_000, length: 28, encoding: 'utf16' },
      ]) &&
      text.truncated === false &&
      text.scanned === file.length,
    text,
  );

  // ---- 3. Busca por bytes.
  const bytes = (await get(`${base}/search?kind=bytes&q=${encodeURIComponent('4D 5A 90')}`)).json();
  ok('bytes: a posição exata', bytes.hits.length === 1 && bytes.hits[0].offset === 299_990, bytes);

  // ---- 4. Muitas posicoes: para no teto e avisa.
  const many = (await get(`${base}/search?q=AA`)).json();
  ok('teto: 200 posições e o aviso de que há mais', many.hits.length === 200 && many.truncated);

  // ---- 5. Erros e acesso.
  ok(
    'bytes inválidos: 400 com o formato esperado',
    (await get(`${base}/search?kind=bytes&q=MZ`)).json().error ===
      'Use bytes em hexadecimal, como 4D 5A 90 00 (até 256 bytes).',
  );
  ok('busca vazia: 400', (await get(`${base}/search?q=`)).statusCode === 400);
  ok(
    'usuário comum: nem os bytes nem a busca',
    (await get(base, bob)).statusCode === 403 &&
      (await get(`${base}/search?q=http`, bob)).statusCode === 403,
  );
  await prisma.entry.update({ where: { id: entry.id }, data: { filePurgedAt: new Date() } });
  ok('arquivo expurgado: 410', (await get(`${base}/search?q=http`)).statusCode === 410);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
