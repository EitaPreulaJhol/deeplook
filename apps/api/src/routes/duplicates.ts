import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { EntryStatus, Verdict } from '../generated/prisma/client';
import { isAnalyst, requireUser } from '../lib/auth';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

const MarkSchema = z.object({
  /** Amostra principal (id). */
  of: z.string().trim().min(1).max(40),
});

/** Situacao antes de virar duplicata (guardada no evento, para desfazer). */
interface PreviousState {
  status: EntryStatus;
  verdict: Verdict;
  /** Eventos anteriores ao item 103 nao trazem: a resolucao fica como esta. */
  resolution?: string | null;
}

/**
 * Duplicatas (registro pai/filho do HPSM): marcar uma amostra como duplicata de
 * outra (a principal) a conclui com o veredito da principal; desfazer volta a
 * situacao anterior. A cadeia e sempre achatada: duplicata aponta direto para a
 * principal, nunca para outra duplicata.
 */
export async function duplicateRoutes(app: FastifyInstance) {
  app.post('/api/entries/:id/duplicate', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas marcam duplicatas.' });
    }
    const parsed = MarkSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };

    const [entry, target] = await Promise.all([
      prisma.entry.findUnique({ where: { id } }),
      prisma.entry.findUnique({
        where: { id: parsed.data.of },
        include: {
          duplicateOf: { select: { id: true, title: true, verdict: true, resolution: true } },
        },
      }),
    ]);
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (!target) {
      return reply.code(400).send({
        error: 'Amostra principal não encontrada.',
        details: { of: ['amostra não encontrada'] },
      });
    }
    // Duplicata de duplicata: aponta para a principal da cadeia.
    const principal = target.duplicateOf ?? {
      id: target.id,
      title: target.title,
      verdict: target.verdict,
      resolution: target.resolution,
    };
    if (principal.id === entry.id) {
      return reply.code(400).send({
        error: 'Uma amostra não pode ser duplicata dela mesma.',
        details: { of: ['ciclo'] },
      });
    }
    if (entry.duplicateOfId === principal.id) {
      return reply.code(409).send({ error: 'A amostra já é duplicata desta principal.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // As duplicatas desta amostra passam a apontar para a nova principal.
      await tx.entry.updateMany({
        where: { duplicateOfId: entry.id },
        data: {
          duplicateOfId: principal.id,
          verdict: principal.verdict,
          // Sem resolucao na principal, a duplicata fica com a dela.
          resolution: principal.resolution ?? undefined,
        },
      });
      const result = await tx.entry.update({
        where: { id: entry.id },
        data: {
          duplicateOfId: principal.id,
          status: 'COMPLETED',
          verdict: principal.verdict,
          resolution: principal.resolution ?? undefined,
        },
      });
      const previous: PreviousState = {
        status: entry.status,
        verdict: entry.verdict,
        resolution: entry.resolution,
      };
      await recordEvent(tx, {
        entryId: entry.id,
        actorId: user.id,
        type: 'MARKED_DUPLICATE',
        fromValue: JSON.stringify(previous),
        toValue: principal.title,
        detail: principal.id,
      });
      await recordTriageChanges(tx, entry.id, user.id, entry, {
        status: 'COMPLETED',
        verdict: principal.verdict,
      });
      if (principal.resolution && principal.resolution !== entry.resolution) {
        await recordEvent(tx, {
          entryId: entry.id,
          actorId: user.id,
          type: 'RESOLUTION_SET',
          toValue: principal.resolution,
          detail: 'principal',
        });
      }
      return result;
    });
    return reply.send({ entry: updated, principal: { id: principal.id, title: principal.title } });
  });

  app.delete('/api/entries/:id/duplicate', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas desfazem duplicatas.' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (!entry.duplicateOfId) {
      return reply.code(400).send({ error: 'A amostra não está marcada como duplicata.' });
    }

    // Volta a situacao de antes da marcacao (ultimo evento MARKED_DUPLICATE).
    const marked = await prisma.entryEvent.findFirst({
      where: { entryId: id, type: 'MARKED_DUPLICATE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    let previous: PreviousState = { status: 'IN_REVIEW', verdict: 'UNKNOWN' };
    try {
      if (marked?.fromValue) previous = JSON.parse(marked.fromValue) as PreviousState;
    } catch {
      /* evento antigo/invalido: usa o padrao */
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.entry.update({
        where: { id },
        data: {
          duplicateOfId: null,
          status: previous.status,
          verdict: previous.verdict,
          ...(previous.resolution !== undefined ? { resolution: previous.resolution } : {}),
        },
      });
      // Volta a resolucao que a amostra tinha, e nao a herdada da principal.
      if (previous.resolution !== undefined && previous.resolution !== entry.resolution) {
        await recordEvent(tx, {
          entryId: id,
          actorId: user.id,
          type: 'RESOLUTION_SET',
          toValue: previous.resolution,
        });
      }
      await recordEvent(tx, {
        entryId: id,
        actorId: user.id,
        type: 'UNMARKED_DUPLICATE',
        detail: entry.duplicateOfId,
      });
      await recordTriageChanges(tx, id, user.id, entry, previous);
      return result;
    });
    return reply.send({ entry: updated });
  });
}
