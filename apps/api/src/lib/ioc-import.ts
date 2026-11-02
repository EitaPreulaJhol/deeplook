import type { IocKind } from '../generated/prisma/client';
import { normalizeAllowed } from './allowlist';
import { isPrivateIpv4, normalizeIpv6, normalizeUrl } from './ioc-normalize';
import { refang } from './iocs';

/**
 * Importacao de indicadores (item 78): lista em CSV/texto (um por linha, com ou
 * sem coluna de tipo) ou pacote STIX 2.1 (indicadores com pattern e objetos
 * observaveis). So le o texto; nada e buscado na internet.
 */

/** Linhas (CSV) ou objetos (STIX) lidos no maximo. */
export const IMPORT_MAX_ITEMS = 5000;
/** Tamanho maximo do texto importado. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type ImportTarget = 'watch' | 'allow';

export interface ImportedIoc {
  kind: IocKind;
  value: string;
  /** Onde estava: "linha 3" ou o id do objeto STIX. */
  where: string;
}

export interface InvalidLine {
  where: string;
  text: string;
  reason: string;
}

export interface ParsedImport {
  format: 'csv' | 'stix';
  items: ImportedIoc[];
  invalid: InvalidLine[];
  /** Repetidos dentro do proprio arquivo (contados uma vez). */
  repeated: number;
}

export class ImportError extends Error {}

/** Nomes de tipo aceitos numa coluna (CSV) -> tipo. */
const KIND_NAMES: Record<string, IocKind> = {
  ip: 'IPV4',
  ipv4: 'IPV4',
  'ipv4-addr': 'IPV4',
  'ip-dst': 'IPV4',
  'ip-src': 'IPV4',
  ipv6: 'IPV6',
  'ipv6-addr': 'IPV6',
  url: 'URL',
  link: 'URL',
  dominio: 'DOMAIN',
  domínio: 'DOMAIN',
  domain: 'DOMAIN',
  'domain-name': 'DOMAIN',
  hostname: 'DOMAIN',
  host: 'DOMAIN',
  email: 'EMAIL',
  'e-mail': 'EMAIL',
  'email-addr': 'EMAIL',
  'email-src': 'EMAIL',
  md5: 'MD5',
  sha1: 'SHA1',
  'sha-1': 'SHA1',
  sha256: 'SHA256',
  'sha-256': 'SHA256',
};

/** Tipo pelo formato do valor (ja sem desarmacao). */
function guessKind(v: string): IocKind | null {
  if (/^https?:\/\//i.test(v)) return 'URL';
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(v)) return 'IPV4';
  if (/^\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(\/\d{1,3})?$/i.test(v)) return 'IPV6';
  if (v.includes('@')) return 'EMAIL';
  if (/^[a-f0-9]{64}$/i.test(v)) return 'SHA256';
  if (/^[a-f0-9]{40}$/i.test(v)) return 'SHA1';
  if (/^[a-f0-9]{32}$/i.test(v)) return 'MD5';
  if (/^[a-z0-9.-]+\.[a-z][a-z0-9-]*\.?$/i.test(v)) return 'DOMAIN';
  return null;
}

/**
 * Valida um valor para o destino. Seguir so aceita indicadores exatos que podem
 * aparecer nos relatorios (sem faixa e sem IP privado); a lista de permissoes
 * aceita faixas CIDR.
 */
export function validateImported(
  kind: IocKind,
  raw: string,
  target: ImportTarget,
): { kind: IocKind; value: string } | { reason: string } {
  // A URL fica URL (item 167): permitir ou seguir um link nao vale para o dominio inteiro.
  if (kind === 'URL') {
    const value = normalizeUrl(raw);
    return value ? { kind, value } : { reason: 'URL inválida (só http e https)' };
  }
  const value = normalizeAllowed(kind, raw);
  if (!value) return { reason: `não é um ${LABEL[kind]} válido` };
  if ((kind === 'IPV4' || kind === 'IPV6') && target === 'watch') {
    if (value.includes('/')) return { reason: 'faixa de IPs só vale na lista de permissões' };
    const ok = kind === 'IPV4' ? !isPrivateIpv4(value) : normalizeIpv6(value)?.kind === 'IPV6';
    if (!ok) return { reason: 'IP privado não aparece nos relatórios' };
  }
  return { kind, value };
}

const LABEL: Record<IocKind, string> = {
  IPV4: 'IP',
  IPV6: 'IPv6',
  URL: 'URL',
  DOMAIN: 'domínio',
  EMAIL: 'e-mail',
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
};

/** Celulas de uma linha de CSV (";", "," ou tab; aspas simples de CSV). */
function cells(line: string): string[] {
  const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

function parseCsv(text: string, target: ImportTarget): ParsedImport {
  const lines = text.split(/\r?\n/);
  if (lines.length > IMPORT_MAX_ITEMS + 1) {
    throw new ImportError(`No máximo ${IMPORT_MAX_ITEMS} linhas por importação.`);
  }
  const result: ParsedImport = { format: 'csv', items: [], invalid: [], repeated: 0 };
  lines.forEach((line, index) => {
    const where = `linha ${index + 1}`;
    // trim() tira tambem o BOM que o Excel poe no inicio.
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    // Link inteiro na linha, com ou sem coluna de tipo antes: ";" e "," na query nao separam.
    const link = /^(?:[\w-]+\s*[;,\t]\s*)?(https?:\/\/\S+)$/i.exec(refang(raw));
    const row = link ? [link[1]] : cells(refang(raw));
    // Coluna de tipo ("ip;1.2.3.4" ou "1.2.3.4,domain") e o primeiro valor que parece IOC.
    const hint = row.map((c) => KIND_NAMES[c.toLowerCase()]).find(Boolean);
    const candidates = row.filter((c) => !KIND_NAMES[c.toLowerCase()]);
    const guessed = candidates.map((c) => ({ c, kind: guessKind(c) })).find((x) => x.kind !== null);
    if (!guessed) {
      // Cabecalho ("tipo;valor") na primeira linha nao e erro.
      if (index === 0 && /\b(tipo|type|valor|value|indicador|indicator|ioc)\b/i.test(raw)) return;
      result.invalid.push({
        where,
        text: raw.slice(0, 200),
        reason: 'não é um indicador reconhecido',
      });
      return;
    }
    // A URL e o IPv6 pelo formato: "ip-dst" tambem marca IPv6 no MISP.
    const kind =
      guessed.kind === 'URL' || guessed.kind === 'IPV6' ? guessed.kind : (hint ?? guessed.kind!);
    const checked = validateImported(kind, guessed.c, target);
    if ('reason' in checked) {
      result.invalid.push({ where, text: raw.slice(0, 200), reason: checked.reason });
    } else {
      result.items.push({ ...checked, where });
    }
  });
  return result;
}

/** Comparacoes de um pattern STIX: [tipo:caminho = 'valor'] (OR/AND aceitos). */
const STIX_COMPARISON = /([a-z0-9-]+):([a-z0-9_.'-]+)\s*=\s*'((?:[^'\\]|\\.)*)'/gi;
const STIX_PATHS: Record<string, IocKind> = {
  'ipv4-addr:value': 'IPV4',
  'ipv6-addr:value': 'IPV6',
  'domain-name:value': 'DOMAIN',
  'email-addr:value': 'EMAIL',
  'url:value': 'URL',
  "file:hashes.'sha-256'": 'SHA256',
  'file:hashes.sha256': 'SHA256',
  "file:hashes.'sha-1'": 'SHA1',
  'file:hashes.sha1': 'SHA1',
  'file:hashes.md5': 'MD5',
};

function parseStix(json: unknown, target: ImportTarget): ParsedImport {
  const objects = (json as { objects?: unknown })?.objects;
  if (!Array.isArray(objects)) throw new ImportError('Pacote STIX sem "objects".');
  if (objects.length > IMPORT_MAX_ITEMS) {
    throw new ImportError(`No máximo ${IMPORT_MAX_ITEMS} objetos por importação.`);
  }
  const result: ParsedImport = { format: 'stix', items: [], invalid: [], repeated: 0 };
  const take = (kind: IocKind, value: string, where: string, text: string) => {
    const checked = validateImported(kind, value, target);
    if ('reason' in checked)
      result.invalid.push({ where, text: text.slice(0, 200), reason: checked.reason });
    else result.items.push({ ...checked, where });
  };
  for (const obj of objects as Record<string, unknown>[]) {
    if (!obj || typeof obj !== 'object') continue;
    const where = String(obj.id ?? obj.type ?? 'objeto');
    const type = String(obj.type ?? '');
    if (type === 'indicator') {
      const pattern = String(obj.pattern ?? '');
      if (obj.pattern_type && obj.pattern_type !== 'stix') {
        result.invalid.push({
          where,
          text: pattern.slice(0, 200),
          reason: `pattern ${String(obj.pattern_type)} não é lido`,
        });
        continue;
      }
      let found = 0;
      for (const m of pattern.matchAll(STIX_COMPARISON)) {
        const path = `${m[1]}:${m[2]}`.toLowerCase();
        const kind = STIX_PATHS[path];
        if (!kind) continue;
        found++;
        take(kind, m[3].replace(/\\(.)/g, '$1'), where, pattern);
      }
      if (!found) {
        result.invalid.push({
          where,
          text: pattern.slice(0, 200),
          reason: 'pattern sem indicador suportado',
        });
      }
    } else if (
      type === 'ipv4-addr' ||
      type === 'ipv6-addr' ||
      type === 'domain-name' ||
      type === 'email-addr' ||
      type === 'url'
    ) {
      const kind = STIX_PATHS[`${type}:value`];
      take(kind, String(obj.value ?? ''), where, String(obj.value ?? ''));
    } else if (type === 'file' && obj.hashes && typeof obj.hashes === 'object') {
      for (const [name, value] of Object.entries(obj.hashes as Record<string, unknown>)) {
        const kind =
          STIX_PATHS[
            `file:hashes.${/[-]/.test(name) ? `'${name.toLowerCase()}'` : name.toLowerCase()}`
          ];
        if (kind) take(kind, String(value), where, String(value));
      }
    }
    // Outros objetos (identity, relationship, malware...) sao ignorados.
  }
  return result;
}

/** Le o texto importado (formato automatico: JSON com "objects" = STIX). */
export function parseImport(text: string, target: ImportTarget): ParsedImport {
  if (Buffer.byteLength(text) > IMPORT_MAX_BYTES) {
    throw new ImportError('Arquivo grande demais (máximo 2 MB).');
  }
  const trimmed = text.trim();
  let parsed: ParsedImport;
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new ImportError('JSON inválido: envie um pacote STIX 2.1 ou uma lista em CSV.');
    }
    parsed = parseStix(json, target);
  } else {
    parsed = parseCsv(text, target);
  }
  // Sem repetir (o primeiro lugar onde apareceu vale).
  const seen = new Set<string>();
  const unique: ImportedIoc[] = [];
  for (const item of parsed.items) {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) parsed.repeated++;
    else {
      seen.add(key);
      unique.push(item);
    }
  }
  parsed.items = unique;
  return parsed;
}
