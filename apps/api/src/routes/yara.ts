import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sendValidationError } from '../lib/validation';
import { validateRule, yaraScanEntry } from '../lib/yara';

const RuleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  source: z
    .string()
    .min(10)
    .max(64 * 1024),
  enabled: z.boolean().default(true),
});

const SourceSchema = z.object({
  source: z
    .string()
    .min(1)
    .max(64 * 1024),
});

const ruleSelect = {
  id: true,
  name: true,
  description: true,
  source: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.YaraRuleSelect;

const duplicateName = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Erro de compilacao no campo "Regra" (a tela marca o campo e mostra a linha). */
function sendCompileErrors(reply: FastifyReply, errors: string[]) {
  return reply.code(400).send({
    error: 'A regra não compila. Corrija e salve de novo.',
    details: { source: errors },
  });
}

/**
 * Regras YARA (item 56): analistas e admins criam, editam, ativam e desativam;
 * a API valida com o YARA-X antes de salvar e aplica as ativas a cada arquivo
 * enviado. Resultado por amostra na secao "Regras YARA" da ficha.
 */
export async function yaraRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: Parameters<typeof requireUser>[0], reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas mantêm regras YARA.' });
      return null;
    }
    return user;
  };

  app.get('/api/yara/rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const rules = await prisma.yaraRule.findMany({ orderBy: { name: 'asc' }, select: ruleSelect });
    return reply.send({ rules });
  });

  /** Valida sem salvar (botao "Validar"). */
  app.post('/api/yara/validate', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = SourceSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { errors, warnings } = validateRule(parsed.data.source);
    return reply.send({ ok: errors.length === 0, errors, warnings });
  });

  app.post('/api/yara/rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { errors, warnings } = validateRule(parsed.data.source);
    if (errors.length) return sendCompileErrors(reply, errors);
    const { description, ...rest } = parsed.data;
    try {
      const rule = await prisma.$transaction(async (tx) => {
        const created = await tx.yaraRule.create({
          data: {
            ...rest,
            description: description || null,
            createdById: user.id,
            updatedById: user.id,
          },
          select: ruleSelect,
        });
        await audit(tx, req, {
          action: 'YARA_RULE_CREATED',
          actorId: user.id,
          targetLabel: created.name,
        });
        return created;
      });
      return reply.code(201).send({ rule, warnings });
    } catch (err) {
      if (duplicateName(err)) {
        return reply.code(409).send({
          error: 'Já existe uma regra com este nome.',
          details: { name: ['nome em uso'] },
        });
      }
      throw err;
    }
  });

  app.patch('/api/yara/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // So "enabled" = ativar/desativar pela lista; com "source" = edicao completa.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const toggle = Object.keys(body).length === 1 && typeof body.enabled === 'boolean';
    const parsed = toggle
      ? { success: true as const, data: { enabled: body.enabled as boolean } }
      : RuleSchema.safeParse(body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    let warnings: string[] = [];
    if ('source' in parsed.data) {
      const result = validateRule(parsed.data.source);
      if (result.errors.length) return sendCompileErrors(reply, result.errors);
      warnings = result.warnings;
    }
    const { description, ...rest } = parsed.data as z.infer<typeof RuleSchema>;
    try {
      const rule = await prisma.$transaction(async (tx) => {
        const updated = await tx.yaraRule.update({
          where: { id },
          data: {
            ...rest,
            ...(toggle ? {} : { description: description || null }),
            updatedById: user.id,
          },
          select: ruleSelect,
        });
        await audit(tx, req, {
          action: 'YARA_RULE_UPDATED',
          actorId: user.id,
          targetLabel: updated.name,
          detail: toggle ? (updated.enabled ? 'ativada' : 'desativada') : undefined,
        });
        return updated;
      });
      return reply.send({ rule, warnings });
    } catch (err) {
      if (duplicateName(err)) {
        return reply.code(409).send({
          error: 'Já existe uma regra com este nome.',
          details: { name: ['nome em uso'] },
        });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ error: 'Regra não encontrada.' });
      }
      throw err;
    }
  });

  app.delete('/api/yara/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.yaraRule.findUnique({ where: { id }, select: { name: true } });
    if (!existing) return reply.code(404).send({ error: 'Regra não encontrada.' });
    await prisma.$transaction(async (tx) => {
      await tx.yaraRule.delete({ where: { id } });
      await audit(tx, req, {
        action: 'YARA_RULE_DELETED',
        actorId: user.id,
        targetLabel: existing.name,
      });
    });
    return reply.send({ ok: true });
  });

  app.get('/api/entries/:id/yara', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, createdAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    const [active, scan] = await Promise.all([
      prisma.yaraRule.count({ where: { enabled: true } }),
      entry.type === 'FILE'
        ? prisma.yaraScan.findUnique({
            where: { entryId: id },
            select: { status: true, matches: true, rulesCount: true, error: true, scannedAt: true },
          })
        : null,
    ]);
    const pending =
      entry.type === 'FILE' &&
      (scan?.status === 'PENDING' ||
        (!scan && active > 0 && Date.now() - entry.createdAt.getTime() < 60_000));
    return reply.send({ activeRules: active, pending, scan });
  });

  app.post('/api/entries/:id/yara', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, storageKey: true, filePurgedAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    if (entry.type !== 'FILE') {
      return reply.code(400).send({ error: 'Só arquivos passam pelas regras YARA.' });
    }
    if (entry.filePurgedAt || !entry.storageKey) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if ((await prisma.yaraRule.count({ where: { enabled: true } })) === 0) {
      return reply.code(409).send({ error: 'Não há regras YARA ativas.' });
    }
    void yaraScanEntry(id).catch((err) => req.log.error({ err }, '[yara] falha'));
    return reply.code(202).send({ ok: true });
  });
}
