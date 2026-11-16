import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { isAnalyst, requireUser } from '../lib/auth';
import { csvSeparator, toCsv } from '../lib/csv';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import { HuntError, huntEvents, huntExport, HuntQuery, huntRuns } from '../lib/sandbox-hunt';
import { sendValidationError } from '../lib/validation';

/**
 * Busca nos eventos do sandbox (plans/caca-e-formatos, item 2): as execucoes que casam, os eventos
 * de uma delas e o CSV. So analistas e admins (os eventos sao artefatos do ambiente).
 */
export async function sandboxHuntRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas veem os artefatos do ambiente.' });
      return null;
    }
    return user;
  };

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof HuntError) return reply.code(400).send({ error: err.message });
    throw err;
  };

  app.get('/api/sandbox/hunt', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = HuntQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    try {
      return reply.send(await huntRuns(parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/sandbox/hunt/export', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = HuntQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    let result;
    try {
      result = await huntExport(parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
    const lang = requestLang(req);
    const en = lang === 'en';
    const csv = toCsv(
      en
        ? [
            'Run',
            'Sample',
            'Run started',
            'Time',
            'EventID',
            'Process',
            'PID',
            'From the sample',
            'What',
          ]
        : [
            'Execução',
            'Amostra',
            'Início da execução',
            'Hora',
            'EventID',
            'Processo',
            'PID',
            'Da amostra',
            'O quê',
          ],
      result.rows.map((r) => [
        r.sessionId,
        r.entryTitle,
        r.startedAt,
        r.event.time,
        r.event.eventId,
        r.event.image ?? '',
        r.event.pid ?? '',
        r.event.sample ? (en ? 'yes' : 'sim') : en ? 'no' : 'não',
        r.event.summary ?? '',
      ]),
      csvSeparator(lang),
    );
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-DeepLook-Truncated', String(result.truncated))
      .header('Content-Disposition', `attachment; filename="deeplook-busca-sandbox-${day}.csv"`)
      .send(csv);
  });

  app.get('/api/sandbox/hunt/:sessionId', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = HuntQuery.extend({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }).safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { sessionId } = req.params as { sessionId: string };
    const exists = await prisma.sandboxSession.count({ where: { id: sessionId } });
    if (!exists) return reply.code(404).send({ error: 'Execução não encontrada.' });
    try {
      return reply.send(await huntEvents(sessionId, parsed.data, parsed.data.page));
    } catch (err) {
      return fail(reply, err);
    }
  });
}
