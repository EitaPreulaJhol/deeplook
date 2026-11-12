// Pecas de seguranca que nao dependem de banco: limite de falhas do login, pedido de outro site,
// rede confiavel, TOTP, CAPTCHA e politica de senha.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkCaptcha, createCaptcha } from '../../src/lib/captcha';
import { isCrossSiteWrite } from '../../src/lib/cross-site';
import { networkPolicy } from '../../src/lib/network';
import { MAX_PASSWORD_BYTES, passwordField, passwordState } from '../../src/lib/password-policy';
import { FailureWindow } from '../../src/lib/rate-limit';
import {
  base32Decode,
  base32Encode,
  credentialMark,
  currentStep,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  newChallenge,
  newRecoveryCodes,
  readChallenge,
  verifyTotp,
} from '../../src/lib/two-factor';

test('janela de falhas: conta só o que está dentro da janela', () => {
  const w = new FailureWindow(3, 1000);
  w.note('a', 0);
  w.note('a', 100);
  assert.ok(!w.exceeded('a', 200));
  w.note('a', 200);
  assert.ok(w.exceeded('a', 300));
  assert.ok(!w.exceeded('b', 300), 'outra chave não é afetada');
  assert.ok(w.exceeded('a', 999), 'as três ainda estão na janela');
  assert.ok(!w.exceeded('a', 1000), 'a primeira saiu: restam duas');
  assert.ok(!w.exceeded('a', 5000));
  assert.equal(w.size, 0, 'chave sem falha recente sai do mapa ao ser consultada');
});

test('janela de falhas: chaves vencidas são varridas acima do teto', () => {
  const w = new FailureWindow(3, 1000);
  for (let i = 0; i < 5001; i++) w.note(`k${i}`, 0);
  assert.equal(w.size, 5001, 'dentro da janela, nada sai');
  w.note('nova', 2000);
  assert.equal(w.size, 1);
});

const req = (method: string, headers: Record<string, string>) => ({ method, headers });

test('pedido de outro site: escrita e WebSocket recusados, leitura passa', () => {
  for (const site of ['cross-site', 'same-site', 'CROSS-SITE']) {
    assert.ok(isCrossSiteWrite(req('POST', { 'sec-fetch-site': site })), site);
    assert.ok(isCrossSiteWrite(req('DELETE', { 'sec-fetch-site': site })), site);
    assert.ok(
      isCrossSiteWrite(req('GET', { 'sec-fetch-site': site, upgrade: 'WebSocket' })),
      `${site} ws`,
    );
    assert.ok(!isCrossSiteWrite(req('GET', { 'sec-fetch-site': site })), `${site} GET`);
    assert.ok(!isCrossSiteWrite(req('HEAD', { 'sec-fetch-site': site })));
  }
  for (const site of ['same-origin', 'none']) {
    assert.ok(!isCrossSiteWrite(req('POST', { 'sec-fetch-site': site })), site);
    assert.ok(!isCrossSiteWrite(req('GET', { 'sec-fetch-site': site, upgrade: 'websocket' })));
  }
  assert.ok(!isCrossSiteWrite(req('POST', {})), 'sem o cabeçalho (script com token, curl) passa');
});

test('rede confiável: só o loopback e as faixas dadas', () => {
  const policy = networkPolicy('172.31.250.0/24, fd00:1::/64');
  for (const ip of ['172.31.250.7', '::ffff:172.31.250.7', '127.0.0.1', '::1', 'fd00:1::9']) {
    assert.ok(policy.allows(ip), ip);
  }
  for (const ip of [
    '172.31.251.7',
    '10.0.0.1',
    '::ffff:10.0.0.1',
    'fd00:2::9',
    '8.8.8.8',
    '',
    undefined,
    'lixo',
  ]) {
    assert.ok(!policy.allows(ip), String(ip));
  }
  assert.equal(policy.trustProxy, 'loopback,172.31.250.0/24,fd00:1::/64');
});

test('rede confiável: sem faixa, o modo antigo aceita tudo; sem loopback, só a faixa', () => {
  const legacy = networkPolicy('');
  assert.ok(legacy.allows('8.8.8.8'));
  assert.deepEqual(legacy.networks, []);
  const strict = networkPolicy('10.9.0.0/16', { loopback: false });
  assert.ok(strict.allows('10.9.1.1'));
  assert.ok(!strict.allows('127.0.0.1'));
  assert.equal(strict.trustProxy, '10.9.0.0/16');
});

test('HOTP: vetores da RFC 4226', () => {
  const secret = Buffer.from('12345678901234567890');
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  expected.forEach((code, counter) => assert.equal(hotp(secret, counter), code));
});

test('base32: ida e volta, e caractere inválido', () => {
  const raw = Buffer.from('12345678901234567890');
  assert.equal(base32Encode(raw), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.ok(
    base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq').equals(raw),
    'minúsculas, espaços e hífens',
  );
  assert.throws(() => base32Decode('GEZD1'), /inválido/);
});

test('TOTP: aceita o passo atual e os vizinhos, e não o mesmo código duas vezes', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const now = 1_700_000_000_000;
  const step = currentStep(now);
  const raw = Buffer.from('12345678901234567890');
  assert.equal(verifyTotp(secret, hotp(raw, step), null, now), step);
  assert.equal(verifyTotp(secret, hotp(raw, step - 1), null, now), step - 1, 'relógio atrasado');
  assert.equal(verifyTotp(secret, hotp(raw, step + 1), null, now), step + 1, 'relógio adiantado');
  assert.equal(verifyTotp(secret, hotp(raw, step - 2), null, now), null, 'fora da janela');
  assert.equal(verifyTotp(secret, hotp(raw, step), step, now), null, 'código já usado');
  assert.equal(
    verifyTotp(secret, hotp(raw, step - 1), step, now),
    null,
    'passo anterior ao já usado',
  );
  assert.equal(
    verifyTotp(secret, ` ${hotp(raw, step).slice(0, 3)} ${hotp(raw, step).slice(3)} `, null, now),
    step,
    'com espaços',
  );
  for (const bad of ['12345', '1234567', 'abcdef', ''])
    assert.equal(verifyTotp(secret, bad, null, now), null, bad);
});

test('códigos de recuperação: formato, hash sem depender de maiúsculas ou hífen', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/);
    assert.equal(hashRecoveryCode(code), hashRecoveryCode(code.toUpperCase().replace('-', '')));
  }
  assert.ok(looksLikeRecoveryCode('k7tm-q2xa'));
  assert.ok(looksLikeRecoveryCode('K7TMQ2XA'));
  assert.ok(
    !looksLikeRecoveryCode('12345678'),
    'só dígitos é código do aplicativo digitado errado',
  );
  assert.ok(!looksLikeRecoveryCode('123456'));
});

test('desafio do 2FA: assinado, com validade e preso à senha conferida', () => {
  const now = 1_700_000_000_000;
  const token = newChallenge('user1', 'hash-da-senha', now);
  assert.deepEqual(readChallenge(token, now + 1000), {
    userId: 'user1',
    mark: credentialMark('hash-da-senha'),
  });
  assert.equal(readChallenge(token, now + 5 * 60_000 + 1), null, 'vencido');
  const [userId, mark, exp, signature] = token.split('.');
  assert.equal(readChallenge(`outro.${mark}.${exp}.${signature}`, now), null, 'usuário trocado');
  assert.equal(
    readChallenge(`${userId}.${mark}.${Number(exp) + 60_000}.${signature}`, now),
    null,
    'validade esticada',
  );
  assert.equal(readChallenge(`${userId}.${mark}.${exp}`, now), null, 'sem assinatura');
  assert.notEqual(credentialMark('hash-da-senha'), credentialMark('outro-hash'));
});

test('CAPTCHA: resposta certa uma vez só, errada gasta o token, e vencido não vale', () => {
  const now = 1_700_000_000_000;
  const a = createCaptcha(now);
  assert.ok(
    checkCaptcha(a.token, ` ${a.text.toUpperCase()} `, now + 1000),
    'ignora maiúsculas e espaços',
  );
  assert.ok(!checkCaptcha(a.token, a.text, now + 2000), 'token já usado');
  const b = createCaptcha(now);
  assert.ok(!checkCaptcha(b.token, 'errada', now + 1000));
  assert.ok(!checkCaptcha(b.token, b.text, now + 2000), 'um palpite por token');
  const c = createCaptcha(now);
  assert.ok(!checkCaptcha(c.token, c.text, now + 2 * 60_000 + 1), 'vencido');
  const d = createCaptcha(now);
  const [exp, nonce, mac] = d.token.split('.');
  assert.ok(
    !checkCaptcha(`${Number(exp) + 1000}.${nonce}.${mac}`, d.text, now),
    'validade adulterada',
  );
  assert.ok(!checkCaptcha(undefined, d.text, now));
  assert.ok(!checkCaptcha(d.token, undefined, now));
  assert.ok(
    a.svg.startsWith('<svg') && !a.svg.includes(a.text),
    'a imagem não traz a resposta em texto',
  );
});

test('política de senha: tamanho, número, especial e o teto de 72 bytes do bcrypt', () => {
  const ok = (s: string) => passwordField.safeParse(s).success;
  assert.ok(ok('Senha-Forte-77!'));
  assert.ok(ok('abcdef1!'));
  assert.ok(!ok('abcde1!'), 'sete caracteres');
  assert.ok(!ok('abcdefgh!'), 'sem número');
  assert.ok(!ok('abcdefgh1'), 'sem especial');
  assert.ok(!ok('açãoação1'), 'letra acentuada não é caractere especial');
  assert.ok(ok(`${'a'.repeat(MAX_PASSWORD_BYTES - 2)}1!`));
  assert.ok(!ok(`${'a'.repeat(MAX_PASSWORD_BYTES - 1)}1!`), '73 bytes');
  assert.ok(!ok(`${'é'.repeat(36)}1!`), '36 acentos são 72 bytes: com mais dois, passa do teto');
});

test('política de senha: redefinida, vencida, admin e conta do AD', () => {
  const day = 86400000;
  const now = 1_700_000_000_000;
  const base = {
    role: 'USER',
    mustChangePassword: false,
    passwordChangedAt: new Date(now - 10 * day),
  };
  assert.equal(passwordState(base, now).mustChangePassword, false);
  assert.equal(passwordState(base, now).passwordExpiresAt?.getTime(), now + 80 * day);
  assert.equal(
    passwordState({ ...base, passwordChangedAt: new Date(now - 91 * day) }, now)
      .passwordChangeReason,
    'expired',
  );
  assert.equal(
    passwordState({ ...base, mustChangePassword: true }, now).passwordChangeReason,
    'reset',
  );
  const admin = passwordState(
    { ...base, role: 'ADMIN', passwordChangedAt: new Date(now - 400 * day) },
    now,
  );
  assert.equal(admin.mustChangePassword, false);
  assert.equal(admin.passwordExpiresAt, null);
  const ldap = passwordState(
    { ...base, authSource: 'LDAP', mustChangePassword: true, passwordChangedAt: new Date(0) },
    now,
  );
  assert.equal(ldap.mustChangePassword, false, 'a senha e a política ficam no AD');
});

test('orçamento de envios: espera em fila, em ordem, e desiste no tempo', async () => {
  const { UploadGate } = await import('../../src/lib/upload-gate');
  const gate = new UploadGate(100);
  const first = gate.tryAcquire(80)!;
  const order: string[] = [];
  const big = gate.acquire(60, 1000).then((release) => (order.push('grande'), release));
  const small = gate.acquire(10, 1000).then((release) => (order.push('pequeno'), release));
  assert.equal(gate.tryAcquire(10), null, 'com fila, quem chega não fura');
  first();
  const [releaseBig, releaseSmall] = await Promise.all([big, small]);
  assert.deepEqual(order, ['grande', 'pequeno'], 'o pequeno não ultrapassa o grande');
  assert.equal(gate.inUse, 70);
  releaseBig?.();
  releaseSmall?.();
  assert.equal(gate.inUse, 0);

  const hold = gate.tryAcquire(100)!;
  assert.equal(await gate.acquire(10, 30), null, 'tempo esgotado');
  assert.equal(await gate.acquire(10, 0), null, 'sem espera');
  assert.equal(await gate.acquire(101, 1000), null, 'maior que o orçamento nunca cabe');
  hold();
  assert.ok(gate.tryAcquire(100), 'quem desistiu não deixa a fila presa');
});

test('orçamento de envios: quem desiste da frente libera os de trás', async () => {
  const { UploadGate } = await import('../../src/lib/upload-gate');
  const gate = new UploadGate(100);
  const hold = gate.tryAcquire(60)!;
  const front = gate.acquire(90, 40);
  const back = gate.acquire(30, 1000);
  assert.equal(await front, null);
  const release = await back;
  assert.ok(release, 'cabia desde o começo; só esperava o da frente');
  release?.();
  hold();
  assert.equal(gate.inUse, 0);
});
