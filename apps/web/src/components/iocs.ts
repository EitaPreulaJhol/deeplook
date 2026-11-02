import type { IocKind } from '../api/types';
import { sha256Hex } from './sha256';

/** Rotulo do tipo de indicador. */
export const IOC_KIND_LABELS: Record<IocKind, string> = {
  IPV4: 'IPv4',
  IPV6: 'IPv6',
  DOMAIN: 'Domínio',
  EMAIL: 'E-mail',
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  URL: 'URL',
};

/**
 * Caminho da ficha do indicador (o mesmo na tela e na API, sem o /api). A URL vai pela
 * chave (SHA-256 do link, item 166): o link, com token ou e-mail da vitima, fica fora do
 * endereco, do historico do navegador e dos logs.
 */
export function iocHref(kind: IocKind, value: string): string {
  const id = kind === 'URL' ? sha256Hex(value) : value;
  return `/iocs/${kind.toLowerCase()}/${encodeURIComponent(id)}`;
}

/** Host de uma URL como indicador (ficha do dominio ou do IP). */
export function urlHostIoc(url: string): { kind: IocKind; value: string } | null {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return { kind: iocKindOf(host), value: host };
  } catch {
    return null;
  }
}

/** Tipo de um valor ja normalizado pela API (ex.: detalhe "IOCs em comum"). */
export function iocKindOf(value: string): IocKind {
  if (/^[a-f0-9]{64}$/.test(value)) return 'SHA256';
  if (/^[a-f0-9]{40}$/.test(value)) return 'SHA1';
  if (/^[a-f0-9]{32}$/.test(value)) return 'MD5';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'IPV4';
  if (/^https?:\/\//.test(value)) return 'URL';
  if (value.includes(':')) return 'IPV6';
  if (value.includes('@')) return 'EMAIL';
  return 'DOMAIN';
}

/** Hash longo encurtado para caber na grade (o valor completo vai na dica). */
export function shortIoc(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…` : value;
}

/**
 * Parece um indicador (IP, dominio, e-mail, hash, URL, inclusive desarmado)?
 * So decide se vale consultar a API; quem reconhece de fato e /api/iocs/lookup.
 */
export function looksLikeIoc(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  return (
    /^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(t) ||
    /^h(?:tt|xx)ps?:\/\//i.test(t) ||
    /\[(?:\.|dot|@|at)\]/i.test(t) ||
    /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(t) ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(t) ||
    /^\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?$/i.test(t) ||
    /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(t)
  );
}
