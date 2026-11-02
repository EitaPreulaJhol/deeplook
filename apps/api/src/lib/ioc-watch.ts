import type { IocKind } from '../generated/prisma/client';
import { allowedBy, loadAllowlist } from './allowlist';
import { hostIndicator, normalizeUrl } from './ioc-normalize';
import { notify } from './notifications';
import type { Db } from './prisma';

/** Rotulo curto do tipo de indicador (texto da notificacao). */
const KIND_LABEL: Record<IocKind, string> = {
  IPV4: 'IP',
  IPV6: 'IPv6',
  URL: 'URL',
  DOMAIN: 'Domínio',
  EMAIL: 'E-mail',
  MD5: 'MD5',
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
};

export interface Indicator {
  kind: IocKind;
  value: string;
}

/** Indicadores da propria amostra: SHA-256 do arquivo; o link e o dominio (ou IP) dele. */
export function sampleIndicators(entry: {
  type: 'FILE' | 'URL';
  sha256: string | null;
  url: string | null;
  urlDomain: string | null;
}): Indicator[] {
  if (entry.type === 'FILE') return entry.sha256 ? [{ kind: 'SHA256', value: entry.sha256 }] : [];
  return [linkHostIndicator(entry.urlDomain), linkIndicator(entry.url)].filter(
    (i): i is Indicator => Boolean(i),
  );
}

/** Host do link: IP (IPv4 ou IPv6, sem colchetes) ou dominio (item 165). */
export function linkHostIndicator(urlDomain: string | null): Indicator | null {
  const host = urlDomain?.toLowerCase();
  if (!host) return null;
  return /^\[|^[\d.]+$/.test(host) ? hostIndicator(host) : { kind: 'DOMAIN', value: host };
}

/** O link normalizado como indicador de URL (item 165). */
export function linkIndicator(url: string | null): Indicator | null {
  const value = url ? normalizeUrl(url) : null;
  return value ? { kind: 'URL', value } : null;
}

/** Valor curto no aviso: de uma URL, so o host, sem o caminho com o token da vitima. */
function shortValue(i: Indicator): string {
  return i.kind === 'URL' ? `${new URL(i.value).origin}/…` : i.value;
}

/**
 * Alertas de IOC (item 60): avisa na Caixa de entrada quem segue algum dos
 * indicadores que acabaram de aparecer (amostra nova ou relatorio publicado).
 * Uma notificacao por pessoa e por evento; quem fez a acao nao e avisado.
 */
export async function notifyWatchers(
  db: Db,
  indicators: Indicator[],
  entryId: string,
  actorId: string | null,
  origin: 'sample' | 'report',
): Promise<void> {
  const list = await loadAllowlist();
  indicators = indicators.filter((i) => !allowedBy(list, i.kind, i.value));
  if (indicators.length === 0) return;
  const watches = await db.iocWatch.findMany({
    where: { OR: indicators.map((i) => ({ kind: i.kind, value: i.value })) },
    select: { userId: true, kind: true, value: true },
    orderBy: { createdAt: 'asc' },
  });
  if (watches.length === 0) return;
  const byUser = new Map<string, Indicator[]>();
  for (const w of watches) byUser.set(w.userId, [...(byUser.get(w.userId) ?? []), w]);
  const where = origin === 'report' ? 'num relatório publicado' : 'numa amostra nova';
  await notify(
    db,
    [...byUser.entries()].map(([userId, hits]) => ({
      userId,
      type: 'IOC_SEEN' as const,
      entryId,
      actorId,
      detail: `${KIND_LABEL[hits[0].kind]} ${shortValue(hits[0])}${hits.length > 1 ? ` (+${hits.length - 1})` : ''} ${where}`,
    })),
  );
}
