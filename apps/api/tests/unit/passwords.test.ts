import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMMON_PASSWORDS, openEncryptedZip, passwordCandidates } from '../../src/lib/passwords';
import { sampleZipBuffer } from '../../src/lib/sample-zip';

// Senhas candidatas (plans/analise-estatica-ampliada, item 9).

test('acha a senha do corpo do e-mail em vários jeitos de escrever', () => {
  assert.deepEqual(passwordCandidates('A senha do arquivo é: Fatura2026.').slice(0, 1), [
    'Fatura2026',
  ]);
  assert.deepEqual(passwordCandidates('Password - X9k!2').slice(0, 1), ['X9k!2']);
  assert.deepEqual(passwordCandidates('pwd="abc123"').slice(0, 1), ['abc123']);
  assert.deepEqual(passwordCandidates('Código: 4471').slice(0, 1), ['4471']);
  assert.deepEqual(passwordCandidates('sem nada aqui'), COMMON_PASSWORDS);
});

test('abre o ZIP cifrado com a primeira senha que serve', async () => {
  const data = Buffer.from('conteudo secreto '.repeat(30));
  const zip = sampleZipBuffer([{ name: 'a.txt', data }], { password: 'Fatura2026' });
  const opened = await openEncryptedZip(zip, ['errada', 'Fatura2026'], 1 << 20);
  assert.equal(opened?.password, 'Fatura2026');
  assert.ok(opened?.files[0].data.equals(data));
  assert.equal(await openEncryptedZip(zip, ['errada'], 1 << 20), null);
  assert.equal(await openEncryptedZip(Buffer.from('nada'), ['x'], 1 << 20), null);
});
