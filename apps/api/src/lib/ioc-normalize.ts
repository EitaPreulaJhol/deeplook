import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import type { IocKind } from '../generated/prisma/client';

/**
 * Forma unica de URLs e IPs como indicador (item 165): o mesmo link escrito de jeitos
 * diferentes vira um valor so, e o que nao e indicador de verdade (rede interna,
 * protocolo estranho, tamanho absurdo) fica de fora.
 */

/** Maior URL guardada como indicador; acima disso so o host conta. Cabe no indice btree. */
export const URL_IOC_MAX = 2048;

/** IPv4 de rede interna, loopback, link-local e multicast: nao sao indicadores. */
export function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Faixas IPv6 que nao sao indicadores (as do proxy da captura, mais site-local). */
const PRIVATE_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 96], // nao especificado e "compativel com IPv4" (obsoleto)
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE_V6.addSubnet(network, prefix, 'ipv6');
}

/** IPv4 mapeado (::ffff:a.b.c.d), que o WHATWG escreve em hexadecimal (::ffff:102:304). */
function mappedIpv4(canonical: string): string | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** IPv6 na forma canonica (RFC 5952: minusculas, zeros cortados, "::" no maior trecho). */
export function canonicalIpv6(raw: string): string | null {
  const text = raw.trim().replace(/^\[|\]$/g, '');
  if (text.includes('%') || isIP(text) !== 6) return null;
  try {
    return new URL(`http://[${text}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** IPv6 canonico como numero de 128 bits (faixas da lista de permissoes, item 167). */
export function ipv6ToBigInt(canonical: string): bigint {
  const [head, tail = ''] = canonical.split('::');
  const left = head ? head.split(':') : [];
  const right = canonical.includes('::') && tail ? tail.split(':') : [];
  const groups = canonical.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
}

export function bigIntToIpv6(n: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) =>
    ((n >> BigInt(16 * (7 - i))) & 0xffffn).toString(16),
  );
  return canonicalIpv6(groups.join(':'))!;
}

/**
 * IPv6 como indicador: forma canonica; com zona (%eth0) ou de rede interna, null; IPv4
 * mapeado vira o IPv4.
 */
export function normalizeIpv6(raw: string): { kind: 'IPV4' | 'IPV6'; value: string } | null {
  const canonical = canonicalIpv6(raw);
  if (!canonical) return null;
  const v4 = mappedIpv4(canonical);
  if (v4) return isPrivateIpv4(v4) ? null : { kind: 'IPV4', value: v4 };
  if (PRIVATE_V6.check(canonical, 'ipv6')) return null;
  return { kind: 'IPV6', value: canonical };
}

/**
 * URL como indicador: so http/https, sem usuario, senha e fragmento (kits de phishing
 * poem o e-mail da vitima no "#"). Caminho e query ficam como vieram, com maiusculas:
 * no servidor eles distinguem paginas. Null se nao for um link aproveitavel.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  const href = url.href;
  return href.length <= URL_IOC_MAX ? href : null;
}

/** Host do link como indicador: dominio, IPv4 ou IPv6 (sem colchetes). */
export function hostIndicator(hostname: string): { kind: IocKind; value: string } | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) === 4) return isPrivateIpv4(host) ? null : { kind: 'IPV4', value: host };
  if (isIP(host) === 6) return normalizeIpv6(host);
  return null;
}

/** Chave da URL (SHA-256 em hexadecimal): vai no endereco da ficha no lugar do link. */
export function urlKey(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}
