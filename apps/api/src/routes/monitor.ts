import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sandboxEnabled } from '../env';
import { audit } from '../lib/audit';
import { requireAdmin } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { recordEvent } from '../lib/events';
import { isQueueId, type QueueId, setQueuePaused, wakeQueue } from '../lib/job-control';
import {
  cachedMonitorSnapshot,
  cancelJobs,
  forgetMonitorSnapshot,
  forgetOrphanCount,
  HISTORY_RANGES,
  monitorHistory,
  queueJobs,
  retryJobs,
} from '../lib/monitor';
import { notify } from '../lib/notifications';
import { prisma } from '../lib/prisma';
import { ACTIVE_STATUSES, dispose, reconcileOrphans } from '../lib/sandbox';
import { localizeStatusText } from '../lib/status';
import { sendValidationError } from '../lib/validation';

/**
 * Monitoramento (plans/monitoramento): a foto da operacao, o historico das metricas e as acoes do
 * admin sobre os ambientes do sandbox e as filas de analise. So administradores; toda acao vai
 * para a auditoria.
 */

const Ids = z.array(z.string().trim().min(1).max(64)).min(1).max(200);

const StopBody = z
  .object({
    ids: Ids.optional(),
    all: z.literal(true).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((b) => Boolean(b.ids) !== Boolean(b.all), {
    message: 'Informe os ambientes ou "todos".',
    path: ['ids'],
  });

const PauseBody = z.object({ paused: z.boolean() });
const JobsQuery = z.object({
  state: z.enum(['pending', 'running', 'failed']).default('pending'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
const CancelBody = z
  .object({ ids: Ids.optional(), allPending: z.literal(true).optional() })
  .refine((b) => Boolean(b.ids) !== Boolean(b.allPending), {
    message: 'Informe os trabalhos ou "todos os pendentes".',
    path: ['ids'],
  });
const RetryBody = z
  .object({
    ids: Ids.optional(),
    failedSinceHours: z.coerce.number().int().min(1).max(168).optional(),
  })
  .refine((b) => Boolean(b.ids) !== Boolean(b.failedSinceHours), {
    message: 'Informe os trabalhos ou o período das falhas.',
    path: ['ids'],
  });
const HistoryQuery = z.object({
  range: z.enum(Object.keys(HISTORY_RANGES) as [keyof typeof HISTORY_RANGES]).default('24h'),
});

/** Detalhe do evento SANDBOX_CLOSED (a ficha mostra "encerrado pela administração"). */
const CLOSED_BY_ADMIN = 'administracao';

export async function monitorRoutes(app: FastifyInstance) {
  const queueParam = (params: unknown): QueueId | null => {
    const { queue } = params as { queue: string };
    return isQueueId(queue) ? queue : null;
  };

  app.get('/api/admin/monitor', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const lang = requestLang(req);
    const snapshot = await cachedMonitorSnapshot();
    return reply.send({
      ...snapshot,
      queues: snapshot.queues.map((q) => ({
        ...q,
        service: q.service
          ? { ...q.service, summary: localizeStatusText(q.service.summary, lang) }
          : null,
      })),
    });
  });

  app.get('/api/admin/monitor/history', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = HistoryQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    return reply.send(await monitorHistory(parsed.data.range));
  });

  // ---- Ambientes do sandbox
  app.post('/api/admin/monitor/sandbox/stop', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    if (!sandboxEnabled) return reply.code(409).send({ error: 'O sandbox está desligado.' });
    const parsed = StopBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { ids, reason } = parsed.data;
    const sessions = await prisma.sandboxSession.findMany({
      where: { status: { in: ACTIVE_STATUSES }, ...(ids ? { id: { in: ids } } : {}) },
      select: {
        id: true,
        analystId: true,
        entryId: true,
        entry: { select: { title: true } },
      },
    });
    const results = await Promise.allSettled(sessions.map((s) => dispose(s.id, 'STOPPED')));
    const stopped = sessions.filter((_, i) => results[i].status === 'fulfilled');
    for (const s of stopped) {
      await recordEvent(prisma, {
        entryId: s.entryId,
        actorId: user.id,
        type: 'SANDBOX_CLOSED',
        detail: CLOSED_BY_ADMIN,
      });
      await audit(prisma, req, {
        action: 'SANDBOX_STOPPED',
        actorId: user.id,
        targetUserId: s.analystId,
        targetLabel: s.entry.title,
        detail: reason ? `ambiente ${s.id} · ${reason}` : `ambiente ${s.id}`,
      });
    }
    await notify(
      prisma,
      stopped.map((s) => ({
        userId: s.analystId,
        type: 'SANDBOX_STOPPED_BY_ADMIN' as const,
        entryId: s.entryId,
        actorId: user.id,
        detail: reason || null,
      })),
    );
    forgetMonitorSnapshot();
    forgetOrphanCount();
    return reply.send({ stopped: stopped.length, failed: sessions.length - stopped.length });
  });

  app.post('/api/admin/monitor/sandbox/orphans/sweep', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    if (!sandboxEnabled) return reply.code(409).send({ error: 'O sandbox está desligado.' });
    const removed = await reconcileOrphans();
    forgetOrphanCount();
    forgetMonitorSnapshot();
    return reply.send(removed);
  });

  // ---- Filas de analise
  app.patch('/api/admin/monitor/queues/:queue', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const queue = queueParam(req.params);
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada.' });
    const parsed = PauseBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const changed = await setQueuePaused(queue, parsed.data.paused);
    if (changed) {
      await audit(prisma, req, {
        action: parsed.data.paused ? 'WORKER_PAUSED' : 'WORKER_RESUMED',
        actorId: user.id,
        targetLabel: queue,
      });
    }
    forgetMonitorSnapshot();
    return reply.send({ queue, paused: parsed.data.paused });
  });

  app.get('/api/admin/monitor/queues/:queue/jobs', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const queue = queueParam(req.params);
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada.' });
    const parsed = JobsQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { total, jobs } = await queueJobs(queue, parsed.data.state, parsed.data.page);
    const lang = requestLang(req);
    return reply.send({
      queue,
      state: parsed.data.state,
      page: parsed.data.page,
      total,
      jobs: jobs.map((j) => ({ ...j, error: localizeText(j.error, lang) })),
    });
  });

  app.post('/api/admin/monitor/queues/:queue/cancel', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const queue = queueParam(req.params);
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada.' });
    const parsed = CancelBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const result = await cancelJobs(queue, parsed.data.ids ?? null);
    const total = result.pending + result.running;
    if (total) {
      await audit(prisma, req, {
        action: 'JOB_CANCELLED',
        actorId: user.id,
        targetLabel: queue,
        detail: parsed.data.ids
          ? `${total} trabalho(s): ${parsed.data.ids.slice(0, 20).join(', ')}`
          : `todos os pendentes (${total})`,
      });
    }
    forgetMonitorSnapshot();
    return reply.send(result);
  });

  app.post('/api/admin/monitor/queues/:queue/retry', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const queue = queueParam(req.params);
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada.' });
    const parsed = RetryBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const hours = parsed.data.failedSinceHours ?? 0;
    const retried = await retryJobs(
      queue,
      parsed.data.ids ?? null,
      new Date(Date.now() - hours * 3_600_000),
    );
    if (retried) {
      wakeQueue(queue);
      await audit(prisma, req, {
        action: 'JOB_RETRIED',
        actorId: user.id,
        targetLabel: queue,
        detail: parsed.data.ids
          ? `${retried} trabalho(s): ${parsed.data.ids.slice(0, 20).join(', ')}`
          : `falhas das últimas ${hours} h (${retried})`,
      });
    }
    forgetMonitorSnapshot();
    return reply.send({ retried });
  });
}
