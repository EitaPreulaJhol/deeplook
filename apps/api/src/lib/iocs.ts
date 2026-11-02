import { isIP } from 'node:net';

import type { IocKind } from '../generated/prisma/client';
import { hostIndicator, isPrivateIpv4, normalizeIpv6, normalizeUrl, urlKey } from './ioc-normalize';
import { notifyWatchers } from './ioc-watch';
import { scanLookalikes } from './lookalike';
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

function domainOk(domain: string): boolean {
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (FILE_EXTENSIONS.has(tld) || /^\d+$/.test(tld)) return false;
  return (
    !IGNORED_DOMAINS.has(domain) && ![...IGNORED_DOMAINS].some((d) => domain.endsWith(`.${d}`))
  );
}

const DOMAIN = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}`;
/** Link inteiro: termina no espaco, em aspas ou em sinais de HTML. */
const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+/gi;
/** Pontuacao que fecha a frase, nao o link ("veja http://x.com/a)."). */
const URL_TRAIL = /[.,;:!?)\]}*]+$/;
// Parte local com apostrofo so no meio (o'brien@...), sem casar pedaco de palavra.
const EMAIL_RE = new RegExp(
  String.raw`(?<![\w.%+'-])[a-z0-9._%+-]+(?:'[a-z0-9._%+-]+)*@(${DOMAIN})\b`,
  'gi',
);
const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const HASH_RE = /\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi;
const DOMAIN_RE = new RegExp(String.raw`(?<![\w@.-])${DOMAIN}(?![\w-])`, 'gi');
/**
 * Candidato a IPv6: entre colchetes, ou solto com tres grupos nao vazios ou mais (conferido
 * no laco). Com menos ("add::", "bad::") seria palavra comum; relogio e MAC nao passam
 * pelo isIP.
 */
const IPV6_RE =
  /\[([0-9a-f:.]{2,45})\]|(?<![\w:.])((?:[0-9a-f]{0,4}:){2,7}(?:[0-9a-f]{1,4}|(?:\d{1,3}\.){3}\d{1,3})?)(?![\w:])/gi;

/** Host de um link ja normalizado como indicador: IP publico ou dominio que liga amostras. */
function urlHost(hostname: string): Ioc | null {
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return hostIndicator(hostname);
  return new RegExp(`^${DOMAIN}$`, 'i').test(hostname) && domainOk(hostname)
    ? { kind: 'DOMAIN', value: hostname }
    : null;
}

/**
 * Indicadores de um texto livre (campo "IOCs" do relatorio), normalizados: URLs
 * (item 165) e o host delas, dominios, IPv4 e IPv6 publicos, e-mails e hashes
 * MD5/SHA-1/SHA-256, sem repeticao. So a URL guarda maiusculas.
 */
export function extractIocs(text: string | null | undefined): Ioc[] {
  if (!text) return [];
  const clean = refang(text);
  const found = new Map<string, Ioc>();
  const add = (kind: IocKind, raw: string) => {
    const value = kind === 'URL' ? raw : raw.toLowerCase().replace(/\.$/, '');
    if (value.length > (kind === 'URL' ? 2048 : 255) || found.size >= MAX_PER_REPORT) return;
    found.set(`${kind}:${value}`, { kind, value });
  };

  for (const m of clean.matchAll(HASH_RE)) {
    const kind = m[0].length === 64 ? 'SHA256' : m[0].length === 40 ? 'SHA1' : 'MD5';
    add(kind, m[0]);
  }
  for (const m of clean.matchAll(IPV4_RE)) {
    const ok = m[0].split('.').every((octet) => Number(octet) <= 255);
    if (ok && !isPrivateIpv4(m[0])) add('IPV4', m[0]);
  }
  for (const m of clean.matchAll(IPV6_RE)) {
    if (!m[1] && m[2].split(':').filter(Boolean).length < 3) continue;
    const ip = normalizeIpv6(m[1] ?? m[2]);
    if (ip) add(ip.kind, ip.value);
  }
  // Links: o host entra ja; o link inteiro, depois dos outros (a busca "Ir para:" pega o
  // primeiro, e o host continua vindo antes). O texto segue sem os links: um e-mail ou
  // dominio na query ("?u=vitima@empresa.com") nao e indicador da amostra.
  const urls: string[] = [];
  for (const m of clean.matchAll(URL_RE)) {
    const url = normalizeUrl(m[0].replace(URL_TRAIL, ''));
    if (!url) continue;
    // Host de rede interna, dominio ignorado (microsoft.com...) ou com cara de arquivo:
    // nem o host nem o link entram.
    const host = urlHost(new URL(url).hostname);
    if (!host) continue;
    add(host.kind, host.value);
    urls.push(url);
  }
  const withoutUrls = clean.replace(URL_RE, ' ');
  for (const m of withoutUrls.matchAll(EMAIL_RE)) add('EMAIL', m[0]);
  // Dominios soltos (fora de e-mails, que ja contam como EMAIL).
  const withoutEmails = withoutUrls.replace(EMAIL_RE, ' ');
  for (const m of withoutEmails.matchAll(DOMAIN_RE)) {
    const domain = m[0].toLowerCase();
    if (domainOk(domain)) add('DOMAIN', domain);
  }
  for (const url of urls) add('URL', url);
  return [...found.values()];
}

/** Guarda as URLs pela chave (item 165), para a ficha e a vigilancia acharem o valor. */
export async function rememberUrls(db: Db, iocs: Ioc[]): Promise<void> {
  const urls = iocs.filter((i) => i.kind === 'URL');
  if (!urls.length) return;
  await db.iocUrl.createMany({
    data: urls.map((u) => ({ key: urlKey(u.value), value: u.value })),
    skipDuplicates: true,
  });
}

/**
 * Reindexa os IOCs de um relatorio: so relatorios publicados contam (rascunhos
 * podem estar errados). Chamar apos criar/editar/publicar.
 */
export async function syncReportIocs(
  db: Db,
  reportId: string,
  options: { actorId?: string | null; notify?: boolean } = {},
): Promise<void> {
  const report = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, entryId: true, status: true, iocs: true },
  });
  // Indicadores que ja estavam no relatorio: so os novos avisam quem os segue.
  const before = new Set(
    (await db.reportIoc.findMany({ where: { reportId }, select: { kind: true, value: true } })).map(
      (i) => `${i.kind}:${i.value}`,
    ),
  );
  await db.reportIoc.deleteMany({ where: { reportId } });
  if (!report) return;
  const iocs = report.status === 'PUBLISHED' ? extractIocs(report.iocs) : [];
  if (iocs.length) {
    await rememberUrls(db, iocs);
    await db.reportIoc.createMany({
      data: iocs.map((ioc) => ({ reportId: report.id, entryId: report.entryId, ...ioc })),
      skipDuplicates: true,
    });
  }
  // Dominios parecidos com os da empresa (item 92) seguem os indicadores.
  await scanLookalikes(db, report.entryId);
  if (!iocs.length) return;
  if (options.notify === false) return;
  const fresh = iocs.filter((i) => !before.has(`${i.kind}:${i.value}`));
  await notifyWatchers(db, fresh, report.entryId, options.actorId ?? null, 'report');
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
  for (const report of pending) await syncReportIocs(prisma, report.id, { notify: false });
  return pending.length;
}
