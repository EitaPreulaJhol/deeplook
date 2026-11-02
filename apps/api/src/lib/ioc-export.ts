import { createHash, randomUUID } from 'node:crypto';

import type { EntryStatus, IocKind, Verdict } from '../generated/prisma/client';
import { toCsv } from './csv';

/** Tipos exportados: os do indice (desde o item 165, a URL tambem e IocKind). */
export type ExportKind = IocKind;

export interface ExportIoc {
  kind: ExportKind;
  value: string;
  /** De onde veio: relatorio publicado ou a propria amostra (arquivo/URL). */
  source: 'REPORT' | 'SAMPLE';
}

export interface ExportEntry {
  id: string;
  title: string;
  status: EntryStatus;
  verdict: Verdict;
  createdAt: Date;
}

const KIND_LABELS: Record<ExportKind, string> = {
  IPV4: 'IPv4',
  IPV6: 'IPv6',
  DOMAIN: 'Domínio',
  EMAIL: 'E-mail',
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  URL: 'URL',
};

/** UUID v5 (SHA-1): ids estaveis para o mesmo indicador em exportacoes diferentes. */
const NAMESPACE = '6f6a1c2e-6a8b-5c7e-9d5e-3e0c2f1b7a10';
export function uuidV5(name: string, namespace = NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------ CSV

export function iocsCsv(entry: ExportEntry, iocs: ExportIoc[]): string {
  return toCsv(
    ['Tipo', 'Valor', 'Origem', 'Amostra', 'ID da amostra'],
    iocs.map((ioc) => [
      KIND_LABELS[ioc.kind],
      ioc.value,
      ioc.source === 'REPORT' ? 'Relatório publicado' : 'Própria amostra',
      entry.title,
      entry.id,
    ]),
  );
}

// ------------------------------------------------------------------ STIX 2.1

/** Valor dentro de um pattern STIX: aspas simples e barras escapadas. */
function stixLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const STIX_PATTERNS: Record<ExportKind, (v: string) => string> = {
  IPV4: (v) => `[ipv4-addr:value = ${stixLiteral(v)}]`,
  IPV6: (v) => `[ipv6-addr:value = ${stixLiteral(v)}]`,
  DOMAIN: (v) => `[domain-name:value = ${stixLiteral(v)}]`,
  EMAIL: (v) => `[email-addr:value = ${stixLiteral(v)}]`,
  MD5: (v) => `[file:hashes.MD5 = ${stixLiteral(v)}]`,
  SHA1: (v) => `[file:hashes.'SHA-1' = ${stixLiteral(v)}]`,
  SHA256: (v) => `[file:hashes.'SHA-256' = ${stixLiteral(v)}]`,
  URL: (v) => `[url:value = ${stixLiteral(v)}]`,
};

const STIX_INDICATOR_TYPES: Record<Verdict, string[]> = {
  MALICIOUS: ['malicious-activity'],
  SUSPICIOUS: ['anomalous-activity'],
  CLEAN: ['benign'],
  UNKNOWN: ['unknown'],
};

/** Bundle STIX 2.1: identidade "DeepLook" + um indicator por IOC (ids estaveis). */
export function iocsStix(entry: ExportEntry, iocs: ExportIoc[], now = new Date()): object {
  const ts = now.toISOString();
  const identityId = `identity--${uuidV5('deeplook')}`;
  return {
    type: 'bundle',
    id: `bundle--${randomUUID()}`,
    objects: [
      {
        type: 'identity',
        spec_version: '2.1',
        id: identityId,
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        name: 'DeepLook',
        identity_class: 'system',
      },
      ...iocs.map((ioc) => ({
        type: 'indicator',
        spec_version: '2.1',
        id: `indicator--${uuidV5(`${ioc.kind}:${ioc.value}`)}`,
        created: ts,
        modified: ts,
        created_by_ref: identityId,
        name: ioc.value,
        description: `DeepLook: ${entry.title} (${entry.id})`,
        indicator_types: STIX_INDICATOR_TYPES[entry.verdict],
        pattern: STIX_PATTERNS[ioc.kind](ioc.value),
        pattern_type: 'stix',
        valid_from: entry.createdAt.toISOString(),
      })),
    ],
  };
}

// ------------------------------------------------------------------ MISP

const MISP_TYPES: Record<ExportKind, { type: string; category: string }> = {
  IPV4: { type: 'ip-dst', category: 'Network activity' },
  IPV6: { type: 'ip-dst', category: 'Network activity' },
  DOMAIN: { type: 'domain', category: 'Network activity' },
  EMAIL: { type: 'email-src', category: 'Payload delivery' },
  MD5: { type: 'md5', category: 'Payload delivery' },
  SHA1: { type: 'sha1', category: 'Payload delivery' },
  SHA256: { type: 'sha256', category: 'Payload delivery' },
  URL: { type: 'url', category: 'Network activity' },
};

/** threat_level_id do MISP: 1 alto, 2 medio, 3 baixo, 4 indefinido. */
const MISP_THREAT: Record<Verdict, string> = {
  MALICIOUS: '1',
  SUSPICIOUS: '2',
  CLEAN: '3',
  UNKNOWN: '4',
};

/** Evento MISP (formato de importacao JSON) com um atributo por IOC. */
export function iocsMisp(entry: ExportEntry, iocs: ExportIoc[]): object {
  return {
    Event: {
      uuid: uuidV5(`entry:${entry.id}`),
      info: `DeepLook: ${entry.title}`,
      date: entry.createdAt.toISOString().slice(0, 10),
      threat_level_id: MISP_THREAT[entry.verdict],
      // 0 inicial, 1 em andamento, 2 concluida.
      analysis: entry.status === 'COMPLETED' ? '2' : entry.status === 'IN_REVIEW' ? '1' : '0',
      distribution: '0',
      Attribute: iocs.map((ioc) => ({
        uuid: uuidV5(`${entry.id}:${ioc.kind}:${ioc.value}`),
        ...MISP_TYPES[ioc.kind],
        value: ioc.value,
        to_ids: ioc.kind !== 'EMAIL',
        comment:
          ioc.source === 'REPORT'
            ? 'Relatório publicado no DeepLook'
            : 'Amostra enviada ao DeepLook',
      })),
    },
  };
}

// ------------------------------------------------------------------ Caso (item 74)

export interface CaseIoc extends ExportIoc {
  /** Amostras do caso onde o indicador aparece. */
  entries: { id: string; title: string; verdict: Verdict }[];
}

export interface ExportCase {
  id: string;
  code: string;
  title: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
  createdAt: Date;
}

/** Pior veredito entre as amostras (desconhecido pesa mais que limpo). */
const VERDICT_WEIGHT: Verdict[] = ['MALICIOUS', 'SUSPICIOUS', 'UNKNOWN', 'CLEAN'];
export function worstVerdict(verdicts: Verdict[]): Verdict {
  return VERDICT_WEIGHT.find((v) => verdicts.includes(v)) ?? 'UNKNOWN';
}

export function caseIocsCsv(c: ExportCase, iocs: CaseIoc[]): string {
  return toCsv(
    ['Tipo', 'Valor', 'Origem', 'Amostras', 'IDs das amostras', 'Caso'],
    iocs.map((ioc) => [
      KIND_LABELS[ioc.kind],
      ioc.value,
      ioc.source === 'REPORT' ? 'Relatório publicado' : 'Própria amostra',
      ioc.entries.map((e) => e.title).join(' | '),
      ioc.entries.map((e) => e.id).join(' | '),
      `${c.code} ${c.title}`,
    ]),
  );
}

/**
 * Bundle STIX 2.1 do caso: identidade, um indicator por IOC (mesmos ids da
 * exportacao da amostra) e um grouping com o caso apontando para todos.
 */
export function caseIocsStix(c: ExportCase, iocs: CaseIoc[], now = new Date()): object {
  const ts = now.toISOString();
  const identityId = `identity--${uuidV5('deeplook')}`;
  const indicators = iocs.map((ioc) => ({
    type: 'indicator',
    spec_version: '2.1',
    id: `indicator--${uuidV5(`${ioc.kind}:${ioc.value}`)}`,
    created: ts,
    modified: ts,
    created_by_ref: identityId,
    name: ioc.value,
    description: `DeepLook ${c.code}: ${ioc.entries.map((e) => `${e.title} (${e.id})`).join(', ')}`,
    indicator_types: STIX_INDICATOR_TYPES[worstVerdict(ioc.entries.map((e) => e.verdict))],
    pattern: STIX_PATTERNS[ioc.kind](ioc.value),
    pattern_type: 'stix',
    valid_from: c.createdAt.toISOString(),
  }));
  return {
    type: 'bundle',
    id: `bundle--${randomUUID()}`,
    objects: [
      {
        type: 'identity',
        spec_version: '2.1',
        id: identityId,
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-01T00:00:00.000Z',
        name: 'DeepLook',
        identity_class: 'system',
      },
      ...indicators,
      ...(indicators.length
        ? [
            {
              type: 'grouping',
              spec_version: '2.1',
              id: `grouping--${uuidV5(`case:${c.id}`)}`,
              created: ts,
              modified: ts,
              created_by_ref: identityId,
              name: `${c.code} ${c.title}`,
              context: 'suspicious-activity',
              object_refs: indicators.map((i) => i.id),
            },
          ]
        : []),
    ],
  };
}

/** Evento MISP do caso: um atributo por IOC, com as amostras no comentario. */
export function caseIocsMisp(c: ExportCase, iocs: CaseIoc[]): object {
  return {
    Event: {
      uuid: uuidV5(`case:${c.id}`),
      info: `DeepLook ${c.code}: ${c.title}`,
      date: c.createdAt.toISOString().slice(0, 10),
      threat_level_id:
        MISP_THREAT[worstVerdict(iocs.flatMap((i) => i.entries.map((e) => e.verdict)))],
      analysis: c.status === 'CLOSED' ? '2' : c.status === 'IN_PROGRESS' ? '1' : '0',
      distribution: '0',
      Attribute: iocs.map((ioc) => ({
        uuid: uuidV5(`${c.id}:${ioc.kind}:${ioc.value}`),
        ...MISP_TYPES[ioc.kind],
        value: ioc.value,
        to_ids: ioc.kind !== 'EMAIL',
        comment: `Amostras: ${ioc.entries.map((e) => e.title).join(', ')}`,
      })),
    },
  };
}
