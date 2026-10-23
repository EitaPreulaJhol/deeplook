import { isIP } from 'node:net';

import type { IocKind } from '@prisma/client';

import { notify } from './notifications';
import type { Db } from './prisma';

/** Rotulo curto do tipo de indicador (texto da notificacao). */
const KIND_LABEL: Record<IocKind, string> = {
  IPV4: 'IP',
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

/** Indicadores da propria amostra: SHA-256 do arquivo; dominio (ou IP) do link. */
export function sampleIndicators(entry: {
  type: 'FILE' | 'URL';
  sha256: string | null;
  urlDomain: string | null;
}): Indicator[] {
  if (entry.type === 'FILE') return entry.sha256 ? [{ kind: 'SHA256', value: entry.sha256 }] : [];
  const host = entry.urlDomain?.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return [];
  return [{ kind: isIP(host) === 4 ? 'IPV4' : 'DOMAIN', value: host }];
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
      detail: `${KIND_LABEL[hits[0].kind]} ${hits[0].value}${hits.length > 1 ? ` (+${hits.length - 1})` : ''} ${where}`,
    })),
  );
}
