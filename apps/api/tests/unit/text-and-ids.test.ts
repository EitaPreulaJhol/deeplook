// Bibliotecas puras de texto e identificadores (revisao de novembro, item 2.1): rodam sem banco,
// sem MinIO e sem Docker, em menos de um segundo.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capaRisky } from '../../src/lib/capa-risk';
import {
  generateActivationCode,
  generateTemporaryPassword,
  randomToken,
  sha256Hex,
} from '../../src/lib/crypto';
import { toCsv } from '../../src/lib/csv';
import { baseDomain } from '../../src/lib/domains';
import { entropy } from '../../src/lib/entropy';
import {
  DEFAULT_PREFERENCES,
  PreferencesPatchSchema,
  resolvePreferences,
} from '../../src/lib/preferences';
import { describeUserAgent } from '../../src/lib/user-agent';

const BOM = '﻿';

test('csv: separador, BOM e fim de linha do Excel', () => {
  assert.equal(toCsv(['a', 'b'], [[1, 'x']]), `${BOM}a;b\r\n1;x\r\n`);
});

test('csv: aspas, ponto e vírgula e quebra de linha ficam entre aspas', () => {
  const csv = toCsv(['v'], [['a;b'], ['diz "oi"'], ['duas\nlinhas']]);
  assert.equal(csv, `${BOM}v\r\n"a;b"\r\n"diz ""oi"""\r\n"duas\nlinhas"\r\n`);
});

test('csv em inglês (plano pós-revisão, item 1.4): vírgula como separador, vírgula entre aspas', () => {
  assert.equal(toCsv(['a', 'b'], [['x, y', 'z;w']], ','), `${BOM}a,b\r\n"x, y",z;w\r\n`);
  assert.equal(toCsv(['v'], [['x, y']]), `${BOM}v\r\nx, y\r\n`, 'em português, a vírgula não muda');
});

test('csv: célula que começaria fórmula ganha apóstrofo', () => {
  for (const start of ['=', '+', '-', '@', '\t', '\r']) {
    const [, line] = toCsv(['v'], [[`${start}cmd|' /C calc'!A0`]]).split('\r\n');
    assert.ok(
      line.replace(/^"/, '').startsWith(`'${start}`),
      `começo ${JSON.stringify(start)}: ${line}`,
    );
  }
  assert.equal(toCsv(['v'], [['a=b']]), `${BOM}v\r\na=b\r\n`, 'no meio do texto não mexe');
});

test('csv: nulo vira vazio e data vira ISO', () => {
  assert.equal(
    toCsv(['a', 'b', 'c'], [[null, undefined, new Date(0)]]),
    `${BOM}a;b;c\r\n;;1970-01-01T00:00:00.000Z\r\n`,
  );
});

test('entropia: 0 para um byte só, 8 para todos os bytes, 1 para dois iguais', () => {
  assert.equal(entropy(Buffer.alloc(1024, 0x41)), 0);
  assert.equal(entropy(Buffer.from(Array.from({ length: 256 }, (_, i) => i))), 8);
  assert.equal(entropy(Buffer.from('abababab')), 1);
  assert.equal(entropy(Buffer.alloc(0)), 0);
});

test('entropia: respeita o trecho pedido', () => {
  const buf = Buffer.concat([
    Buffer.alloc(100, 0),
    Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  ]);
  assert.equal(entropy(buf, 0, 100), 0);
  assert.equal(entropy(buf, 100), 8);
  assert.equal(entropy(buf, 50, 50), 0, 'trecho vazio');
});

test('domínio-base: dois níveis, três sob com.br e afins, IP como está', () => {
  assert.equal(baseDomain('login.banco.com.br'), 'banco.com.br');
  assert.equal(baseDomain('cdn.exemplo.com'), 'exemplo.com');
  assert.equal(baseDomain('a.b.c.co.uk'), 'c.co.uk');
  assert.equal(baseDomain('EXEMPLO.com.'), 'exemplo.com');
  assert.equal(baseDomain('192.168.0.1'), '192.168.0.1');
  assert.equal(baseDomain('2001:db8::1'), '2001:db8::1');
  assert.equal(baseDomain('localhost'), 'localhost');
  // Segundo nivel "com" so conta sob TLD de pais (duas letras).
  assert.equal(baseDomain('a.com.info'), 'com.info');
});

test('user-agent: navegador e sistema, com o Edge e o Opera antes do Chrome', () => {
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  assert.equal(describeUserAgent(chrome), 'Chrome no Windows');
  assert.equal(describeUserAgent(`${chrome} Edg/130.0`), 'Edge no Windows');
  assert.equal(describeUserAgent(`${chrome} OPR/115.0`), 'Opera no Windows');
  assert.equal(
    describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    'Firefox no Linux',
  );
  assert.equal(
    describeUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    ),
    'Safari no macOS',
  );
  assert.equal(
    describeUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1',
    ),
    'Safari no iOS',
  );
  assert.equal(
    describeUserAgent(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    ),
    'Chrome no Android',
  );
  assert.equal(describeUserAgent('curl/8.5.0'), 'curl');
  assert.equal(describeUserAgent(null), 'Navegador desconhecido');
  assert.equal(describeUserAgent(''), 'Navegador desconhecido');
});

test('capa: só os ramos de risco pesam, pelo prefixo inteiro do namespace', () => {
  assert.ok(capaRisky('anti-analysis'));
  assert.ok(capaRisky('anti-analysis/anti-debugging/debugger-detection'));
  assert.ok(capaRisky('host-interaction/process/inject'));
  assert.ok(capaRisky('load-code/shellcode'));
  assert.ok(!capaRisky('load-code/pe'), 'todo executável faz');
  assert.ok(!capaRisky('host-interaction/process'), 'só o ramo inject');
  assert.ok(!capaRisky('anti-analysis-extra'), 'prefixo parecido não é o mesmo ramo');
  assert.ok(!capaRisky(''));
});

test('preferências: valor inválido cai no padrão sem descartar os outros', () => {
  assert.deepEqual(resolvePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(resolvePreferences('texto'), DEFAULT_PREFERENCES);
  const mixed = resolvePreferences({ pageSize: 'muitas', detailPane: true, desconhecida: 1 });
  assert.equal(mixed.pageSize, DEFAULT_PREFERENCES.pageSize);
  assert.equal(mixed.detailPane, true);
  assert.ok(!('desconhecida' in mixed));
});

test('preferências: idioma da interface (revisão 2.5)', () => {
  assert.equal(resolvePreferences({}).language, 'pt-BR');
  assert.equal(resolvePreferences({ language: 'en' }).language, 'en');
  assert.equal(
    resolvePreferences({ language: 'fr' }).language,
    'pt-BR',
    'desconhecido cai no padrão',
  );
  assert.ok(PreferencesPatchSchema.safeParse({ language: 'en' }).success);
  assert.ok(!PreferencesPatchSchema.safeParse({ language: 'fr' }).success);
});

test('preferências: a atualização parcial recusa chave desconhecida', () => {
  assert.ok(PreferencesPatchSchema.safeParse({ detailPane: true }).success);
  assert.ok(PreferencesPatchSchema.safeParse({}).success);
  assert.ok(!PreferencesPatchSchema.safeParse({ admin: true }).success);
});

test('chave de ativação e senha temporária: formato e alfabeto sem ambíguos', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(
      generateActivationCode(),
      /^DL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    assert.match(
      generateTemporaryPassword(),
      /^[a-hjkmnp-zA-HJ-NP-Z2-9]{4}-[a-hjkmnp-zA-HJ-NP-Z2-9]{4}-[a-hjkmnp-zA-HJ-NP-Z2-9]{4}$/,
    );
  }
});

test('token aleatório: tamanho em hexadecimal e sem repetição', () => {
  assert.match(randomToken(), /^[0-9a-f]{48}$/);
  assert.match(randomToken(32), /^[0-9a-f]{64}$/);
  assert.equal(new Set(Array.from({ length: 500 }, () => randomToken())).size, 500);
});

test('sha256: vetor conhecido', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
