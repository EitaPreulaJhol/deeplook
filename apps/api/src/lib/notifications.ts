import type { NotificationType } from '../generated/prisma/client';
import { resolvePreferences } from './preferences';
import type { Db } from './prisma';
import { prisma } from './prisma';

export interface NotificationInput {
  /** Destinatario. */
  userId: string;
  type: NotificationType;
  /** Amostra ou caso (item 89). */
  entryId?: string;
  caseId?: string;
  /** Quem causou; null = o sistema. */
  actorId: string | null;
  /** Complemento (veredito, trecho da atualizacao...). */
  detail?: string | null;
}

/** Trecho curto de um texto para a notificacao (uma linha, ate 140 caracteres). */
export function excerpt(text: string, max = 140): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Cria notificacoes na caixa de entrada (sininho do masthead). Nunca notifica
 * a pessoa da propria acao e nao repete o mesmo destinatario na mesma chamada.
 * Respeita os avisos que a pessoa silenciou (item 164).
 */
export async function notify(db: Db, items: NotificationInput[]): Promise<void> {
  const recipients = [...new Set(items.map((n) => n.userId))];
  const users = recipients.length
    ? await db.user.findMany({
        where: { id: { in: recipients } },
        select: { id: true, preferences: true },
      })
    : [];
  const muted = new Map(
    users.map((u) => [u.id, new Set<string>(resolvePreferences(u.preferences).mutedNotifications)]),
  );
  const seen = new Set<string>();
  const data = items.filter((n) => {
    if (n.actorId && n.userId === n.actorId) return false;
    // Antes da deduplicacao: uma mencao silenciada nao leva junto a atualizacao.
    if (muted.get(n.userId)?.has(n.type)) return false;
    if (seen.has(n.userId)) return false;
    seen.add(n.userId);
    return true;
  });
  if (data.length) await db.notification.createMany({ data });
}

/** Menção gravada junto da atualizacao (EntryEvent.toValue, em JSON). */
export interface Mention {
  id: string;
  name: string;
}

/**
 * Mencoes validas de uma atualizacao: ids de usuarios ATIVOS cujo "@Nome"
 * ainda aparece no texto (o front manda os ids escolhidos no autocompletar).
 */
export async function resolveMentions(
  text: string,
  ids: string[],
  /** Casos (item 89): so quem pode abrir o caso. */
  analystsOnly = false,
): Promise<Mention[]> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) return [];
  const users = await prisma.user.findMany({
    where: {
      id: { in: unique },
      status: 'ACTIVE',
      ...(analystsOnly ? { role: { not: 'USER' as const } } : {}),
    },
    select: { id: true, displayName: true },
  });
  return users
    .filter((u) => text.includes(`@${u.displayName}`))
    .map((u) => ({ id: u.id, name: u.displayName }));
}
