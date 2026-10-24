import type { EntryEventType, EntryStatus, Verdict } from '../generated/prisma/client';
import { notify } from './notifications';
import type { Db } from './prisma';

export interface EntryEventInput {
  entryId: string;
  /** Quem fez a acao; null = o sistema (ex.: expiracao do sandbox). */
  actorId: string | null;
  type: EntryEventType;
  fromValue?: string | null;
  toValue?: string | null;
  detail?: string | null;
}

/** Grava um evento no historico da amostra (aba "Historico"). */
export async function recordEvent(db: Db, event: EntryEventInput): Promise<void> {
  await db.entryEvent.create({ data: event });
}

/**
 * Registra as mudancas de status/veredito entre o estado anterior e o novo.
 * Os valores sao os codigos dos enums (o front traduz para os rotulos).
 */
export async function recordTriageChanges(
  db: Db,
  entryId: string,
  actorId: string,
  before: { status: EntryStatus; verdict: Verdict },
  after: { status?: EntryStatus; verdict?: Verdict },
): Promise<void> {
  if (after.status && after.status !== before.status) {
    await recordEvent(db, {
      entryId,
      actorId,
      type: 'STATUS_CHANGED',
      fromValue: before.status,
      toValue: after.status,
    });
    // Caixa de entrada: o dono fica sabendo que a amostra dele foi concluida.
    if (after.status === 'COMPLETED') {
      const entry = await db.entry.findUnique({
        where: { id: entryId },
        select: { ownerId: true, verdict: true },
      });
      if (entry) {
        await notify(db, [
          { userId: entry.ownerId, type: 'COMPLETED', entryId, actorId, detail: entry.verdict },
        ]);
      }
    }
  }
  if (after.verdict && after.verdict !== before.verdict) {
    await recordEvent(db, {
      entryId,
      actorId,
      type: 'VERDICT_CHANGED',
      fromValue: before.verdict,
      toValue: after.verdict,
    });
    // As duplicatas acompanham o veredito da principal (por qualquer caminho:
    // triagem, massa, relatorio). A cadeia e achatada, entao nao ha recursao.
    const duplicates = await db.entry.findMany({
      where: { duplicateOfId: entryId, verdict: { not: after.verdict } },
      select: { id: true, verdict: true },
    });
    if (duplicates.length) {
      await db.entry.updateMany({
        where: { id: { in: duplicates.map((d) => d.id) } },
        data: { verdict: after.verdict },
      });
      for (const dup of duplicates) {
        await recordEvent(db, {
          entryId: dup.id,
          actorId,
          type: 'VERDICT_CHANGED',
          fromValue: dup.verdict,
          toValue: after.verdict,
          detail: 'principal',
        });
      }
    }
  }
}
