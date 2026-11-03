import { describe, expect, it } from 'vitest';

import { IOC_KIND_LABELS, iocHref, iocKindOf, looksLikeIoc, shortIoc, urlHostIoc } from './iocs';
import { sha256Hex } from './sha256';

describe('iocKindOf', () => {
  it('reconhece hashes pelo tamanho', () => {
    expect(iocKindOf('a'.repeat(64))).toBe('SHA256');
    expect(iocKindOf('a'.repeat(40))).toBe('SHA1');
    expect(iocKindOf('a'.repeat(32))).toBe('MD5');
  });

  it('reconhece IPv4, URL, IPv6, e-mail e dominio, nessa ordem', () => {
    expect(iocKindOf('1.2.3.4')).toBe('IPV4');
    expect(iocKindOf('http://a.com/x')).toBe('URL');
    // A URL ganha do ':' do IPv6 porque a checagem de URL vem antes.
    expect(iocKindOf('https://a.com:8443/x')).toBe('URL');
    expect(iocKindOf('2001:db8::1')).toBe('IPV6');
    expect(iocKindOf('alvo@vitima.com')).toBe('EMAIL');
    expect(iocKindOf('vitima.com')).toBe('DOMAIN');
  });
});

describe('IOC_KIND_LABELS', () => {
  it('rotula os oito tipos', () => {
    const kinds = ['IPV4', 'IPV6', 'DOMAIN', 'EMAIL', 'MD5', 'SHA1', 'SHA256', 'URL'] as const;
    for (const kind of kinds) expect(IOC_KIND_LABELS[kind]).toBeTruthy();
    expect(IOC_KIND_LABELS.DOMAIN).toBe('Domínio');
    expect(IOC_KIND_LABELS.URL).toBe('URL');
  });
});

describe('iocHref', () => {
  it('usa o proprio valor (escapado) para tudo que nao e URL', () => {
    expect(iocHref('IPV4', '1.2.3.4')).toBe('/iocs/ipv4/1.2.3.4');
    expect(iocHref('DOMAIN', 'vitima.com')).toBe('/iocs/domain/vitima.com');
    expect(iocHref('EMAIL', 'alvo@vitima.com')).toBe('/iocs/email/alvo%40vitima.com');
  });

  it('a URL vai pela chave (SHA-256 do link), nunca pelo link em claro', () => {
    const url = 'http://evil.example/a?token=1';
    expect(iocHref('URL', url)).toBe(`/iocs/url/${sha256Hex(url)}`);
    expect(iocHref('URL', url)).toBe(
      '/iocs/url/c665eb040304182453a4e7e41adfcb04f2dfe2bfe2d13947909dcf0d36fbe5da',
    );
    // O link em claro nao aparece no caminho.
    expect(iocHref('URL', url)).not.toContain('token');
  });
});

describe('urlHostIoc', () => {
  it('extrai o host como dominio, IPv4 ou IPv6 (sem os colchetes)', () => {
    expect(urlHostIoc('http://example.com/path')).toEqual({ kind: 'DOMAIN', value: 'example.com' });
    expect(urlHostIoc('http://1.2.3.4:8080/x')).toEqual({ kind: 'IPV4', value: '1.2.3.4' });
    expect(urlHostIoc('http://[2001:db8::1]/x')).toEqual({ kind: 'IPV6', value: '2001:db8::1' });
  });

  it('devolve null quando nao e URL', () => {
    expect(urlHostIoc('isto nao e uma url')).toBeNull();
  });
});

describe('shortIoc', () => {
  it('encurta acima de 24 caracteres e deixa o resto como esta', () => {
    expect(shortIoc('a'.repeat(40))).toBe(`${'a'.repeat(12)}…`);
    expect(shortIoc('curto')).toBe('curto');
    // 24 fica, 25 encurta (o limite e estrito).
    expect(shortIoc('a'.repeat(24))).toBe('a'.repeat(24));
    expect(shortIoc('a'.repeat(25))).toBe(`${'a'.repeat(12)}…`);
  });
});

describe('looksLikeIoc', () => {
  it('aceita hash, URL (inclusive desarmada), IP, e-mail e dominio', () => {
    expect(looksLikeIoc('a'.repeat(64))).toBe(true);
    expect(looksLikeIoc('http://evil.example/x')).toBe(true);
    expect(looksLikeIoc('hxxps://evil[.]example')).toBe(true);
    expect(looksLikeIoc('1.2.3.4')).toBe(true);
    expect(looksLikeIoc('2001:db8::1')).toBe(true);
    expect(looksLikeIoc('alvo@vitima.com')).toBe(true);
    expect(looksLikeIoc('vitima.com')).toBe(true);
  });

  it('recusa texto com espaco e palavra solta sem cara de indicador', () => {
    expect(looksLikeIoc('isto tem espaco')).toBe(false);
    expect(looksLikeIoc('palavrasolta')).toBe(false);
  });
});
