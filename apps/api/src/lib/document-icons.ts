import { Prisma } from '../generated/prisma/client';
import { iconDistance } from './icon-hash';
import { prisma } from './prisma';

/**
 * Icone de documento num executavel (plans/analise-estatica-ampliada, item 2): a isca classica, o
 * .exe com o icone do Word ou do PDF. Os icones sao de terceiros e nao vem no repositorio: o admin
 * marca o de uma amostra ja vista, e todo PE com icone parecido (dHash a ate 4 bits) ganha o alerta,
 * na chegada e, quando a lista muda, nos que ja estao na base.
 */

export const DOCUMENT_ICON_MAX = 4;
/** O alerta desta regra (para trocar pelo novo quando a lista muda). */
const OWN_ALERT = /^Ícone de documento \(/;

export const documentIconAlert = (label: string) => ({
  level: 'high' as const,
  text: `Ícone de documento (${label}) num executável: isca para abrir achando que é um documento.`,
});

type Icon = { hash: string; label: string };
type Alert = { level: string; text: string };
type WithPe = { pe?: { icon?: { hash: string } | null; alerts?: Alert[] } | null } | null;

/** O icone da lista mais parecido com o do PE, se estiver a ate 4 bits. */
export function matchDocumentIcon(hash: string | null | undefined, icons: Icon[]): Icon | null {
  if (!hash) return null;
  let best: { icon: Icon; d: number } | null = null;
  for (const icon of icons) {
    const d = iconDistance(hash, icon.hash);
    if (d !== null && d <= DOCUMENT_ICON_MAX && (!best || d < best.d)) best = { icon, d };
  }
  return best?.icon ?? null;
}

/** O staticInfo com o alerta conforme a lista (tira o antigo; null se nada mudou). */
export function withDocumentIconAlert<T extends WithPe>(staticInfo: T, icons: Icon[]): T | null {
  const pe = staticInfo?.pe;
  if (!pe) return null;
  const alerts = pe.alerts ?? [];
  const kept = alerts.filter((a) => !OWN_ALERT.test(a.text));
  const icon = matchDocumentIcon(pe.icon?.hash, icons);
  const next = icon ? [documentIconAlert(icon.label), ...kept] : kept;
  if (JSON.stringify(next) === JSON.stringify(alerts)) return null;
  return { ...staticInfo, pe: { ...pe, alerts: next } };
}

export const documentIcons = () =>
  prisma.documentIcon.findMany({ select: { hash: true, label: true } });

/**
 * A lista mudou: refaz o alerta nas amostras com icone (pelo pivo ICON_DHASH, item 2). Devolve
 * quantas fichas mudaram.
 */
export async function refreshDocumentIconAlerts(): Promise<number> {
  const icons = await documentIcons();
  const pivots = await prisma.entryPivot.findMany({
    where: { kind: 'ICON_DHASH' },
    select: { entryId: true },
    distinct: ['entryId'],
  });
  let changed = 0;
  for (let i = 0; i < pivots.length; i += 200) {
    const rows = await prisma.entry.findMany({
      where: { id: { in: pivots.slice(i, i + 200).map((p) => p.entryId) } },
      select: { id: true, staticInfo: true },
    });
    for (const row of rows) {
      const next = withDocumentIconAlert(row.staticInfo as WithPe, icons);
      if (!next) continue;
      await prisma.entry.update({
        where: { id: row.id },
        data: { staticInfo: next as unknown as Prisma.InputJsonValue },
      });
      changed++;
    }
  }
  return changed;
}
