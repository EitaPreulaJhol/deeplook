// Faixas do proxy de saida: npm test (sem navegador nem rede).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isBlockedAddress } from '../src/proxy.mjs';

test('endereços públicos passam', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '172.66.147.243', // fora de 172.16.0.0/12
    '::ffff:8.8.8.8',
    '::ffff:808:808',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('rede interna, loopback e metadados são bloqueados', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('IPv4 interno embutido em IPv6 é bloqueado', () => {
  for (const address of [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::1',
    '2002:7f00:1::',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('o que não é endereço é bloqueado', () => {
  assert.equal(isBlockedAddress('example.com'), true);
  assert.equal(isBlockedAddress(''), true);
});
