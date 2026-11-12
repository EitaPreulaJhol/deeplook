// Normalizacao de indicadores (item 165) sem banco: o mesmo link ou IP escrito de jeitos
// diferentes tem de virar um valor so, e o que e rede interna fica de fora.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bigIntToIpv6,
  canonicalIpv6,
  hostIndicator,
  ipv6ToBigInt,
  isPrivateIpv4,
  normalizeIpv6,
  normalizeUrl,
  URL_IOC_MAX,
  urlKey,
} from '../../src/lib/ioc-normalize';

test('IPv4 interno, loopback, link-local e multicast não são indicadores', () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.ok(isPrivateIpv4(ip), ip);
  }
  for (const ip of [
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '169.253.1.1',
    '192.167.1.1',
    '223.255.255.255',
    '1.1.1.1',
  ]) {
    assert.ok(!isPrivateIpv4(ip), ip);
  }
});

test('IPv6 canônico: minúsculas, zeros cortados e "::" no maior trecho', () => {
  assert.equal(canonicalIpv6('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(canonicalIpv6('[2606:4700:4700::1111]'), '2606:4700:4700::1111');
  assert.equal(canonicalIpv6(' 2606:4700:4700:0:0:0:0:1111 '), '2606:4700:4700::1111');
  assert.equal(canonicalIpv6('fe80::1%eth0'), null, 'com zona');
  assert.equal(canonicalIpv6('8.8.8.8'), null);
  assert.equal(canonicalIpv6('não é ip'), null);
});

test('IPv6 para número e de volta', () => {
  for (const ip of [
    '2606:4700:4700::1111',
    '::1',
    '2001:db8::',
    'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '1:2:3:4:5:6:7:8',
  ]) {
    assert.equal(bigIntToIpv6(ipv6ToBigInt(ip)), ip);
  }
  assert.equal(ipv6ToBigInt('::1'), 1n);
  assert.equal(ipv6ToBigInt('1::'), 1n << 112n);
});

test('IPv6 como indicador: interno fica de fora, IPv4 mapeado vira IPv4', () => {
  assert.deepEqual(normalizeIpv6('2606:4700:4700::1111'), {
    kind: 'IPV6',
    value: '2606:4700:4700::1111',
  });
  assert.deepEqual(normalizeIpv6('::ffff:8.8.8.8'), { kind: 'IPV4', value: '8.8.8.8' });
  assert.equal(normalizeIpv6('::ffff:10.0.0.1'), null, 'mapeado de rede interna');
  for (const ip of [
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '2001:db8::1',
    'ff02::1',
    '64:ff9b::808:808',
  ]) {
    assert.equal(normalizeIpv6(ip), null, ip);
  }
});

test('URL como indicador: só http e https, sem credencial e sem fragmento', () => {
  assert.equal(
    normalizeUrl('  HTTP://Exemplo.COM/Caminho?Q=1#vitima@empresa.com '),
    'http://exemplo.com/Caminho?Q=1',
  );
  assert.equal(normalizeUrl('https://user:senha@site.top/a'), 'https://site.top/a');
  assert.equal(normalizeUrl('https://site.top:443/a'), 'https://site.top/a', 'porta padrão some');
  assert.equal(normalizeUrl('https://site.top:8443/a'), 'https://site.top:8443/a');
  for (const raw of [
    'ftp://site.top/a',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
    'site.top/a',
    '',
    'http://',
  ]) {
    assert.equal(normalizeUrl(raw), null, raw);
  }
});

test('URL como indicador: o mesmo link escrito de dois jeitos tem a mesma chave', () => {
  const a = normalizeUrl('HTTPS://Site.TOP/a?x=1#frag');
  const b = normalizeUrl('https://site.top:443/a?x=1');
  assert.equal(a, b);
  assert.equal(urlKey(a!), urlKey(b!));
  assert.match(urlKey(a!), /^[0-9a-f]{64}$/);
  assert.notEqual(
    urlKey(a!),
    urlKey(normalizeUrl('https://site.top/A?x=1')!),
    'o caminho distingue maiúsculas',
  );
});

test('URL como indicador: acima do teto, fica de fora', () => {
  const base = 'https://site.top/';
  assert.ok(normalizeUrl(base + 'a'.repeat(URL_IOC_MAX - base.length)));
  assert.equal(normalizeUrl(base + 'a'.repeat(URL_IOC_MAX - base.length + 1)), null);
});

test('host do link: IP público vira indicador; domínio e IP interno, não', () => {
  assert.deepEqual(hostIndicator('8.8.8.8'), { kind: 'IPV4', value: '8.8.8.8' });
  assert.deepEqual(hostIndicator('[2606:4700:4700::1111]'), {
    kind: 'IPV6',
    value: '2606:4700:4700::1111',
  });
  assert.equal(hostIndicator('10.0.0.1'), null);
  assert.equal(hostIndicator('[::1]'), null);
  assert.equal(hostIndicator('exemplo.com'), null, 'domínio é tratado em outro lugar');
});
