import type { EntryType, Priority } from '../generated/prisma/client';
import { recordEvent } from './events';
import { notify } from './notifications';
import { prisma } from './prisma';

const TYPE_LABEL: Record<EntryType, string> = { FILE: 'arquivo', URL: 'link' };

/** "tipo link, tag phishing, P2" (ou "qualquer amostra"). */
export function ruleLabel(rule: {
  entryType: EntryType | null;
  tag: string | null;
  priority: Priority | null;
}): string {
  const parts = [
    rule.entryType && `tipo ${TYPE_LABEL[rule.entryType]}`,
    rule.tag && `tag ${rule.tag}`,
    rule.priority,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'qualquer amostra';
}

/**
 * Atribuicao automatica (item 72) de uma amostra recem-criada: a primeira regra
 * ativa que casar (tipo, tag, prioridade) escolhe o grupo; dentro dele, o rodizio
 * vai para o membro ativo e presente que recebeu ha mais tempo. Sem regra ou sem
 * ninguem disponivel, a amostra fica sem responsavel. Nunca troca um
 * responsavel ja definido. Devolve quem recebeu (ou null).
 */
export async function autoAssign(
  entryId: string,
): Promise<{ userId: string; groupName: string } | null> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { type: true, priority: true, assigneeId: true, tags: { select: { name: true } } },
  });
  if (!entry || entry.assigneeId) return null;
  const rules = await prisma.assignmentRule.findMany({
    where: { enabled: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { group: { select: { id: true, name: true } } },
  });
  const tags = new Set(entry.tags.map((t) => t.name.toLowerCase()));
  const rule = rules.find(
    (r) =>
      (!r.entryType || r.entryType === entry.type) &&
      (!r.priority || r.priority === entry.priority) &&
      (!r.tag || tags.has(r.tag.toLowerCase())),
  );
  if (!rule) return null;

  return prisma.$transaction(async (tx) => {
    // Um envio por vez por grupo: o rodizio nao repete a mesma pessoa.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign:${rule.groupId}`}))`;
    const member = await tx.assignmentGroupMember.findFirst({
      where: {
        groupId: rule.groupId,
        user: { status: 'ACTIVE', away: false, role: { in: ['ANALYST', 'ADMIN'] } },
      },
      orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { userId: 'asc' }],
      include: { user: { select: { id: true, displayName: true } } },
    });
    if (!member) return null;
    const { count } = await tx.entry.updateMany({
      where: { id: entryId, assigneeId: null },
      data: { assigneeId: member.userId },
    });
    if (!count) return null;
    await tx.assignmentGroupMember.update({
      where: { groupId_userId: { groupId: rule.groupId, userId: member.userId } },
      data: { lastAssignedAt: new Date() },
    });
    await recordEvent(tx, {
      entryId,
      actorId: null,
      type: 'ASSIGNED',
      fromValue: null,
      toValue: member.user.displayName,
      detail: `automática: grupo ${rule.group.name} (${ruleLabel(rule)})`,
    });
    await notify(tx, [{ userId: member.userId, type: 'ASSIGNED', entryId, actorId: null }]);
    return { userId: member.userId, groupName: rule.group.name };
  });
}
