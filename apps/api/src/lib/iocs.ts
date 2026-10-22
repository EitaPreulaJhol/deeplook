import type { IocKind } from '@prisma/client';

import type { Db } from './prisma';
import { prisma } from './prisma';

export interface Ioc {
  kind: IocKind;
  value: string;
}

/** Maximo de indicadores guardados por relatorio. */
const MAX_PER_REPORT = 200;

/**
 * "Extensoes" que parecem TLD mas sao nomes de arquivo nos relatorios
 * (updater.exe, kernel32.dll...). .zip/.mov tambem sao TLDs reais, mas nos
 * relatorios quase sempre sao arquivos.
 */
const FILE_EXTENSIONS = new Set(
  (
    'exe dll sys bat cmd ps1 psm1 vbs vbe js jse wsf jar doc docx docm dot dotm xls xlsx xlsm ' +
    'ppt pptx pptm pdf rtf txt log ini cfg conf tmp dat bin msi lnk scr hta py sh zip rar 7z gz ' +
    'tar iso img vhd png jpg jpeg gif bmp html htm php asp aspx json xml csv yml yaml reg cab'
  ).split(' '),
);

/** Dominios onipresentes que ligariam quase tudo a quase tudo. */
const IGNORED_DOMAINS = new Set([
  'microsoft.com',
  'windows.com',
  'windowsupdate.com',
  'google.com',
  'gmail.com',
  'outlook.com',
  'live.com',
  'hotmail.com',
  'yahoo.com',
  'apple.com',
  'icloud.com',
  'github.com',
]);

/** Desfaz a "desarmacao" comum em relatorios: hxxp, [.], (.), [dot], [:], [@]. */
export function refang(text: string): string {
  return text
    .replace(/hxxp(s?):\/\//gi, 'http$1://')
    .replace(/\[(\.|dot)\]|\((\.|dot)\)|\{(\.|dot)\}/gi, '.')
    .replace(/\[:\]/g, ':')
    .replace(/\[(@|at)\]|\((@|at)\)/gi, '@');
}

function isPrivateIp(ip: string): boolean {
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

function domainOk(domain: string): boolean {
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (FILE_EXTENSIONS.has(tld) || /^\d+$/.test(tld)) return false;
  return (
    !IGNORED_DOMAINS.has(domain) && ![...IGNORED_DOMAINS].some((d) => domain.endsWith(`.${d}`))
  );
}

const DOMAIN = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}`;
const URL_RE = /\bhttps?:\/\/([^\s/"'<>:?#]+)/gi;
// Parte local com apostrofo so no meio (o'brien@...), sem casar pedaco de palavra.
const EMAIL_RE = new RegExp(
  String.raw`(?<![\w.%+'-])[a-z0-9._%+-]+(?:'[a-z0-9._%+-]+)*@(${DOMAIN})\b`,
  'gi',
);
const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const HASH_RE = /\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi;
const DOMAIN_RE = new RegExp(String.raw`(?<![\w@.-])${DOMAIN}(?![\w-])`, 'gi');

/**
 * Indicadores de um texto livre (campo "IOCs" do relatorio), normalizados:
 * dominios (inclusive o host de URLs), IPv4 publicos, e-mails e hashes
 * MD5/SHA-1/SHA-256, em minusculas e sem repeticao.
 */
export function extractIocs(text: string | null | undefined): Ioc[] {
  if (!text) return [];
  const clean = refang(text);
  const found = new Map<string, Ioc>();
  const add = (kind: IocKind, raw: string) => {
    const value = raw.toLowerCase().replace(/\.$/, '');
    if (value.length > 255 || found.size >= MAX_PER_REPORT) return;
    found.set(`${kind}:${value}`, { kind, value });
  };

  for (const m of clean.matchAll(HASH_RE)) {
    const kind = m[0].length === 64 ? 'SHA256' : m[0].length === 40 ? 'SHA1' : 'MD5';
    add(kind, m[0]);
  }
  for (const m of clean.matchAll(IPV4_RE)) {
    const ok = m[0].split('.').every((octet) => Number(octet) <= 255);
    if (ok && !isPrivateIp(m[0])) add('IPV4', m[0]);
  }
  for (const m of clean.matchAll(EMAIL_RE)) add('EMAIL', m[0]);
  for (const m of clean.matchAll(URL_RE)) {
    const host = m[1].toLowerCase();
    if (new RegExp(`^${DOMAIN}$`, 'i').test(host) && domainOk(host)) add('DOMAIN', host);
    else if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && !isPrivateIp(host)) add('IPV4', host);
  }
  // Dominios soltos (fora de e-mails, que ja contam como EMAIL).
  const withoutEmails = clean.replace(EMAIL_RE, ' ');
  for (const m of withoutEmails.matchAll(DOMAIN_RE)) {
    const domain = m[0].toLowerCase();
    if (domainOk(domain)) add('DOMAIN', domain);
  }
  return [...found.values()];
}

/**
 * Reindexa os IOCs de um relatorio: so relatorios publicados contam (rascunhos
 * podem estar errados). Chamar apos criar/editar/publicar.
 */
export async function syncReportIocs(db: Db, reportId: string): Promise<void> {
  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, entryId: true, status: true, iocs: true },
  });
  await db.reportIoc.deleteMany({ where: { reportId } });
  if (report?.status !== 'PUBLISHED') return;
  const iocs = extractIocs(report.iocs);
  if (iocs.length === 0) return;
  await db.reportIoc.createMany({
    data: iocs.map((ioc) => ({ reportId: report.id, entryId: report.entryId, ...ioc })),
    skipDuplicates: true,
  });
}

/**
 * Na subida da API: indexa os relatorios publicados que ainda nao tem IOCs na
 * tabela (bases anteriores a esta funcao ou relatorios importados).
 */
export async function backfillReportIocs(): Promise<number> {
  const pending = await prisma.report.findMany({
    where: { status: 'PUBLISHED', iocs: { not: null }, extractedIocs: { none: {} } },
    select: { id: true },
  });
  for (const report of pending) await syncReportIocs(prisma, report.id);
  return pending.length;
}
