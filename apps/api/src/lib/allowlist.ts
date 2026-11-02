import { isIP } from 'node:net';

import type { IocKind } from '../generated/prisma/client';
import {
  bigIntToIpv6,
  canonicalIpv6,
  hostIndicator,
  ipv6ToBigInt,
  normalizeUrl,
} from './ioc-normalize';
import { prisma } from './prisma';

/**
 * Lista de permissoes de indicadores (item 69): dominios (com subdominios), IPs
 * ou faixas CIDR, hashes e e-mails legitimos. Nao liga amostras nas
 * Relacionadas, nao dispara alertas de IOC e some das sugestoes; nunca apaga o
 * que o analista escreveu no relatorio.
 */

export const ALLOW_KINDS = [
  'DOMAIN',
  'IPV4',
  'IPV6',
  'URL',
  'EMAIL',
  'MD5',
  'SHA1',
  'SHA256',
] as const;
export type AllowKind = (typeof ALLOW_KINDS)[number];

const HASH_LENGTH: Partial<Record<AllowKind, number>> = { MD5: 32, SHA1: 40, SHA256: 64 };
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** Valor normalizado (minusculas, sem ponto final) ou null se nao vale para o tipo. */
export function normalizeAllowed(kind: AllowKind, raw: string): string | null {
  // URL exata (item 167): o caminho guarda maiusculas, entao nao passa pelo toLowerCase.
  if (kind === 'URL') return normalizeUrl(raw);
  const value = raw.trim().toLowerCase().replace(/\.$/, '');
  switch (kind) {
    case 'DOMAIN':
      return DOMAIN.test(value) ? value : null;
    case 'IPV4': {
      const [ip, bits, ...rest] = value.split('/');
      if (rest.length || isIP(ip) !== 4) return null;
      if (bits === undefined) return ip;
      if (!/^\d{1,2}$/.test(bits) || Number(bits) > 32) return null;
      // Faixa guardada pelo endereco de rede (10.1.2.3/8 -> 10.0.0.0/8).
      const n = Number(bits);
      const network = n === 0 ? 0 : (ipToInt(ip) & (~0 << (32 - n))) >>> 0;
      return `${intToIp(network)}/${n}`;
    }
    case 'IPV6': {
      // Endereco ou faixa CIDR, guardada pelo endereco de rede na forma canonica.
      const [ip, bits, ...rest] = value.split('/');
      const canonical = canonicalIpv6(ip);
      if (rest.length || !canonical) return null;
      if (bits === undefined) return canonical;
      if (!/^\d{1,3}$/.test(bits) || Number(bits) > 128) return null;
      const n = Number(bits);
      return `${bigIntToIpv6(ipv6ToBigInt(canonical) & mask6(n))}/${n}`;
    }
    case 'EMAIL':
      return /^[^\s@]+@[^\s@]+$/.test(value) && DOMAIN.test(value.split('@')[1]) ? value : null;
    default:
      return new RegExp(`^[a-f0-9]{${HASH_LENGTH[kind]}}$`).test(value) ? value : null;
  }
}

/** Mascara de 128 bits com os `bits` primeiros ligados. */
function mask6(bits: number): bigint {
  return bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

export interface Allowlist {
  domains: Set<string>;
  ips: Set<string>;
  ranges: { network: number; mask: number }[];
  /** IPv6 (item 167): enderecos e faixas, com o texto do item para o motivo. */
  ips6: Set<string>;
  ranges6: { network: bigint; mask: bigint; label: string }[];
  urls: Set<string>;
  emails: Set<string>;
  hashes: Set<string>;
  reasons: Map<string, string>;
}

/** O item da lista que cobre o indicador ("kind:valor" do item), ou null. */
export function allowedBy(list: Allowlist, kind: IocKind | string, raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\.$/, '');
  switch (kind) {
    case 'DOMAIN': {
      // O proprio dominio ou qualquer dominio pai (mail.google.com -> google.com).
      const parts = value.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (list.domains.has(candidate)) return `DOMAIN:${candidate}`;
      }
      return null;
    }
    case 'IPV4': {
      if (list.ips.has(value)) return `IPV4:${value}`;
      if (isIP(value) !== 4) return null;
      const n = ipToInt(value);
      const range = list.ranges.find((r) => (n & r.mask) >>> 0 === r.network);
      if (!range) return null;
      const bits = 32 - Math.log2((~range.mask >>> 0) + 1);
      return `IPV4:${intToIp(range.network)}/${bits}`;
    }
    case 'EMAIL': {
      if (list.emails.has(value)) return `EMAIL:${value}`;
      const domain = value.split('@')[1];
      return domain ? allowedBy(list, 'DOMAIN', domain) : null;
    }
    case 'IPV6': {
      const canonical = canonicalIpv6(value);
      if (!canonical) return null;
      if (list.ips6.has(canonical)) return `IPV6:${canonical}`;
      const n = ipv6ToBigInt(canonical);
      const range = list.ranges6.find((r) => (n & r.mask) === r.network);
      return range ? `IPV6:${range.label}` : null;
    }
    case 'URL': {
      // A URL exata, ou o host dela: dominio (com os pais), IPv4 ou IPv6.
      const url = normalizeUrl(raw);
      if (!url) return null;
      if (list.urls.has(url)) return `URL:${url}`;
      const hostname = new URL(url).hostname;
      const host = hostIndicator(hostname);
      if (host) return allowedBy(list, host.kind, host.value);
      return isIP(hostname.replace(/^\[|\]$/g, '')) ? null : allowedBy(list, 'DOMAIN', hostname);
    }
    case 'MD5':
    case 'SHA1':
    case 'SHA256':
      return list.hashes.has(value) ? `${kind}:${value}` : null;
    default:
      return null;
  }
}

let cache: { at: number; list: Allowlist } | null = null;
/** A lista muda pouco: guardada por 30 s (e descartada a cada alteracao). */
const TTL_MS = 30_000;

export function invalidateAllowlist(): void {
  cache = null;
}

export async function loadAllowlist(): Promise<Allowlist> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const rows = await prisma.allowedIndicator.findMany({
    select: { kind: true, value: true, reason: true },
  });
  const list: Allowlist = {
    domains: new Set(),
    ips: new Set(),
    ranges: [],
    ips6: new Set(),
    ranges6: [],
    urls: new Set(),
    emails: new Set(),
    hashes: new Set(),
    reasons: new Map(),
  };
  for (const row of rows) {
    list.reasons.set(`${row.kind}:${row.value}`, row.reason);
    if (row.kind === 'DOMAIN') list.domains.add(row.value);
    else if (row.kind === 'EMAIL') list.emails.add(row.value);
    else if (row.kind === 'URL') list.urls.add(row.value);
    else if (row.kind === 'IPV6') {
      const [ip, bits] = row.value.split('/');
      if (bits === undefined) list.ips6.add(ip);
      else {
        const mask = mask6(Number(bits));
        list.ranges6.push({ network: ipv6ToBigInt(ip) & mask, mask, label: row.value });
      }
    } else if (row.kind === 'IPV4') {
      const [ip, bits] = row.value.split('/');
      if (bits === undefined) list.ips.add(ip);
      else {
        const n = Number(bits);
        list.ranges.push({ network: ipToInt(ip), mask: n === 0 ? 0 : (~0 << (32 - n)) >>> 0 });
      }
    } else list.hashes.add(row.value);
  }
  cache = { at: Date.now(), list };
  return list;
}
