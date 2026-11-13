import type { FastifyInstance } from 'fastify';

import { isAnalyst, requireUser } from '../lib/auth';
import { localizeData, localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import {
  checkReputation,
  enabledServices,
  indicatorOf,
  SERVICE_NAMES,
  type ServiceId,
  servicesFor,
} from '../lib/reputation';

/**
 * Reputacao externa da amostra: resultados por servico (secao da ficha) e
 * "Consultar de novo" para analistas (ignora o cache de 24 h).
 */
export async function reputationRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/reputation', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, sha256: true, urlDomain: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const services = enabledServices();
    const rows = await prisma.reputationResult.findMany({
      where: { entryId: id, service: { in: services } },
      select: {
        service: true,
        kind: true,
        indicator: true,
        status: true,
        verdict: true,
        summary: true,
        link: true,
        checkedAt: true,
      },
    });
    const order = new Map(services.map((s, i) => [s, i]));
    rows.sort(
      (a, b) => (order.get(a.service as ServiceId) ?? 9) - (order.get(b.service as ServiceId) ?? 9),
    );
    // Consulta em andamento: algum "consultando..." ou servico que ainda nao respondeu.
    const indicator = indicatorOf(entry);
    const expected = indicator ? servicesFor(indicator.kind) : [];
    const pending =
      rows.some((r) => r.status === 'PENDING') ||
      expected.some((s) => !rows.some((r) => r.service === s));
    // Nomes e resumos no idioma de quem pede (plano pos-revisao, item 1.4).
    const lang = requestLang(req);
    return reply.send({
      services: services.map((s) => ({ id: s, name: localizeText(SERVICE_NAMES[s], lang) })),
      indicator,
      pending,
      results: rows.map((r) => ({
        ...r,
        summary: localizeData({ summary: r.summary }, lang).summary,
        name: localizeText(SERVICE_NAMES[r.service as ServiceId] ?? r.service, lang),
      })),
    });
  });

  app.post('/api/entries/:id/reputation', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas consultam a reputação de novo.' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: { id: true } });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (enabledServices().length === 0) {
      return reply.code(409).send({ error: 'Nenhum serviço de reputação configurado.' });
    }
    // Em segundo plano: a ficha acompanha os "consultando..." ate terminar.
    void checkReputation(id, true).catch((err) => req.log.error({ err }, '[reputacao] falha'));
    return reply.code(202).send({ ok: true });
  });
}
