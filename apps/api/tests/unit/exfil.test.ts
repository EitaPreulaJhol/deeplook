import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findChannels, maskChannel, mergeChannels } from '../../src/lib/exfil';

// Canais de exfiltracao (plans/analise-estatica-ampliada, item 3), com valores sinteticos no
// formato real (nenhum e um token de verdade).

const BOT = '7123456789:AAH4kD9xZ2mQ7pR1sT5uV8wX0yZ3aB6cD9e';
const HOOK =
  'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKlMnOpQrStUvWx';

test('acha os canais do Telegram, Discord, SMTP, FTP, paste, túnel e chaves', () => {
  const text = [
    `var url = "https://api.telegram.org/bot${BOT}/sendDocument?chat_id=-1001234567890";`,
    HOOK,
    'smtp.mailserver-evil.com',
    'new NetworkCredential("ladrao@evil.test", "s3nh4!")',
    'ftp://user:pass@ftp.evil.test/upload/',
    'ftp://files.evil.test/pub/',
    'https://pastebin.com/raw/AbC12345',
    'tcp://4.tcp.ngrok.io:12345 and abc-def.trycloudflare.com',
    'AKIAABCDEFGHIJKLMNOP',
  ].join('\n');
  const found = findChannels(text, 'strings').map((c) => `${c.kind}=${c.value}`);
  assert.deepEqual(found, [
    `telegram-bot=${BOT}`,
    'telegram-chat=-1001234567890',
    `discord-webhook=${HOOK}`,
    'smtp=smtp.mailserver-evil.com',
    'smtp-credential=ladrao@evil.test:s3nh4!',
    'ftp=ftp://user:pass@ftp.evil.test/upload/',
    'ftp=ftp://files.evil.test/pub/',
    'paste=https://pastebin.com/raw/AbC12345',
    'tunnel=4.tcp.ngrok.io',
    'tunnel=abc-def.trycloudflare.com',
    'cloud-key=AKIAABCDEFGHIJKLMNOP',
  ]);
});

test('a mesma URL de FTP não entra duas vezes, e as origens se juntam sem repetir', () => {
  const ftp = findChannels('ftp://u:p@h.evil.test/x', 'strings');
  assert.equal(ftp.length, 1);
  assert.equal(ftp[0].credential, true);
  const merged = mergeChannels([
    findChannels(BOT, 'strings'),
    findChannels(BOT, 'floss'),
    findChannels(HOOK, 'dotnet'),
  ]);
  assert.deepEqual(
    merged.map((c) => [c.kind, c.source]),
    [
      ['telegram-bot', 'strings'],
      ['discord-webhook', 'dotnet'],
    ],
  );
});

test('a credencial sai mascarada; o resto, inteiro', () => {
  const [bot] = findChannels(BOT, 'strings');
  assert.equal(maskChannel(bot).value, `${BOT.slice(0, 6)}… (${BOT.length})`);
  const [hook] = findChannels(HOOK, 'strings');
  assert.ok(maskChannel(hook).value.startsWith('https://discord.com/api/webhooks/1234567890123'));
  assert.ok(!maskChannel(hook).value.includes('AbCdEf'));
  const [paste] = findChannels('https://pastebin.com/raw/AbC12345', 'strings');
  assert.equal(maskChannel(paste), paste);
});

test('texto comum não acusa nada; o domínio do Telegram sozinho também não', () => {
  assert.deepEqual(findChannels('https://telegram.org e smtp sem host, ftp://', 'strings'), []);
});

test('texto montado para travar a regex termina rápido', () => {
  const evil = [
    'a.'.repeat(200_000),
    'smtp.' + 'a-'.repeat(100_000),
    'ftp://' + 'a'.repeat(200_000),
    '1234567890:AA' + '-'.repeat(200_000),
  ];
  for (const text of evil) {
    const t = Date.now();
    findChannels(text, 'dotnet');
    assert.ok(Date.now() - t < 1500, `${text.slice(0, 20)}: ${Date.now() - t} ms`);
  }
});
