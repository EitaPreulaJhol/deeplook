import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { invalidateAllowlist, normalizeAllowed } from '../lib/allowlist';
import { isAnalyst, requireUser } from '../lib/auth';
import { normalizeHost, REASON_LABEL, rescanAllLookalikes } from '../lib/lookalike';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';

/** Dominios da empresa cadastrados (no maximo). */
export const COMPANY_DOMAINS_MAX = 20;
/** Motivo do item que o cadastro poe na lista de permissoes (e tira ao excluir). */
export const COMPANY_ALLOW_REASON = 'Domínio da empresa';

const CreateSchema = z.object({ domain: z.string().trim().min(3).max(253) }).strict();

/** Revarredura em segundo plano; os testes esperam por ela. */
export let lastRescan: Promise<number> = Promise.resolve(0);
function rescan(app: FastifyInstance) {
  lastRescan = rescanAllLookalikes().catch((err) => {
    app.log.error({ err }, 'Falha ao revarrer dominios parecidos');
    return 0;
  });
}

/**
 * Dominios parecidos com os da empresa (item 92): o admin cadastra os dominios;
 * analistas veem as variacoes ja vistas, com as amostras.
 */
export async function companyDomainRoutes(app: FastifyInstance) {
  const requireRole = async (req: FastifyRequest, reply: FastifyReply, admin: boolean) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (admin ? user.role !== 'ADMIN' : !isAnalyst(user)) {
      reply.code(403).send({
        error: admin
          ? 'Somente administradores cadastram os domínios da empresa.'
          : 'Somente analistas veem os domínios parecidos.',
      });
      return null;
    }
    return user;
  };

  app.get('/api/company-domains', async (req, reply) => {
    if (!(await requireRole(req, reply, false))) return;
    const [domains, hits] = await Promise.all([
      prisma.companyDomain.findMany({
        orderBy: { domain: 'asc' },
        select: {
          id: true,
          domain: true,
          createdAt: true,
          createdBy: { select: { id: true, displayName: true } },
        },
      }),
      prisma.lookalikeHit.findMany({
        where: { entry: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
        select: {
          domain: true,
          companyDomain: true,
          reason: true,
          detail: true,
          sources: true,
          createdAt: true,
          entry: { select: { id: true, title: true, verdict: true, createdAt: true } },
        },
      }),
    ]);
    // Variacoes vistas: uma linha por dominio, com as amostras (mais recentes primeiro).
    const seen = new Map<
      string,
      {
        domain: string;
        companyDomain: string;
        reason: string;
        label: string;
        detail: string | null;
        sources: Set<string>;
        entries: { id: string; title: string; verdict: string }[];
        lastSeen: Date;
      }
    >();
    for (const h of hits) {
      const row = seen.get(h.domain) ?? {
        domain: h.domain,
        companyDomain: h.companyDomain,
        reason: h.reason,
        label: REASON_LABEL[h.reason],
        detail: h.detail,
        sources: new Set<string>(),
        entries: [],
        lastSeen: h.entry.createdAt,
      };
      h.sources.forEach((s) => row.sources.add(s));
      row.entries.push({ id: h.entry.id, title: h.entry.title, verdict: h.entry.verdict });
      if (h.entry.createdAt > row.lastSeen) row.lastSeen = h.entry.createdAt;
      seen.set(h.domain, row);
    }
    return reply.send({
      domains,
      max: COMPANY_DOMAINS_MAX,
      seen: [...seen.values()]
        .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
        .map((r) => ({
          ...r,
          sources: [...r.sources],
          total: r.entries.length,
          entries: r.entries.slice(0, 5),
        })),
    });
  });

  app.post('/api/company-domains', async (req, reply) => {
    const user = await requireRole(req, reply, true);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    // Aceita "https://www.empresa.com.br/..." e guarda "empresa.com.br".
    const raw = parsed.data.domain.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
    const host = normalizeHost(raw);
    const domain = host ? normalizeAllowed('DOMAIN', host) : null;
    if (!domain) {
      return reply.code(400).send({
        error: 'Dados invalidos.',
        details: { domain: ['domínio inválido (ex.: empresa.com.br)'] },
      });
    }
    if (await prisma.companyDomain.count({ where: { domain } })) {
      return reply.code(409).send({ error: `${domain} já está na lista.` });
    }
    if ((await prisma.companyDomain.count()) >= COMPANY_DOMAINS_MAX) {
      return reply
        .code(409)
        .send({ error: `No máximo ${COMPANY_DOMAINS_MAX} domínios da empresa.` });
    }
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.companyDomain.create({ data: { domain, createdById: user.id } });
      // O proprio dominio e legitimo: entra na lista de permissoes (item 69).
      await tx.allowedIndicator.upsert({
        where: { kind_value: { kind: 'DOMAIN', value: domain } },
        create: {
          kind: 'DOMAIN',
          value: domain,
          reason: COMPANY_ALLOW_REASON,
          createdById: user.id,
        },
        update: {},
      });
      return created;
    });
    invalidateAllowlist();
    rescan(app);
    return reply.code(201).send({ item });
  });

  app.delete('/api/company-domains/:id', async (req, reply) => {
    if (!(await requireRole(req, reply, true))) return;
    const { id } = req.params as { id: string };
    const found = await prisma.companyDomain.findUnique({ where: { id } });
    if (!found) return reply.code(404).send({ error: 'Domínio não encontrado.' });
    await prisma.$transaction([
      prisma.companyDomain.delete({ where: { id } }),
      // So sai da lista de permissoes o item que o cadastro pos.
      prisma.allowedIndicator.deleteMany({
        where: { kind: 'DOMAIN', value: found.domain, reason: COMPANY_ALLOW_REASON },
      }),
    ]);
    invalidateAllowlist();
    rescan(app);
    return reply.send({ ok: true });
  });
}
