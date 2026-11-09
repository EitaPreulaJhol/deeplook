import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TECHNIQUE_ID } from '../lib/attack';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { NEEDS_VALUE, triageRuleLabel } from '../lib/triage-rules';
import { sendValidationError } from '../lib/validation';

const CONDITIONS = [
  'DETECTED_TYPE',
  'YARA',
  'ANTIVIRUS',
  'DOMAIN',
  'SENDER',
  'MACRO',
  'DISGUISED',
  'SCRIPT_RISK',
  'DOCUMENT_RISK',
  'LNK',
  'LOOKALIKE',
  'CAPA_CAPABILITY',
  'ATTACK_TECHNIQUE',
  'SIGNATURE_INVALID',
  'PACKED',
  'PE_ALERT',
  'HIDDEN_IOC',
  'DIE_DETECTION',
] as const;

const TAG = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, 'use letras, números, espaço, ponto, hífen ou _');

const RuleSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    condition: z.enum(CONDITIONS),
    value: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .default(null)
      .transform((v) => v || null),
    tags: z
      .array(TAG)
      .max(10)
      .default([])
      .transform((t) => [...new Set(t)]),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']).nullable().default(null),
  })
  .strict()
  .refine((r) => r.tags.length > 0 || r.priority, {
    message: 'inclua ao menos uma tag ou uma prioridade',
    path: ['tags'],
  })
  .refine((r) => !NEEDS_VALUE.includes(r.condition) || r.value, {
    message: 'esta condição precisa de um valor',
    path: ['value'],
  })
  .refine(
    (r) => r.condition !== 'ATTACK_TECHNIQUE' || TECHNIQUE_ID.test((r.value ?? '').toUpperCase()),
    {
      message: 'use o código da técnica, como T1055 ou T1055.012',
      path: ['value'],
    },
  )
  // Normalizacao: T1055 em maiusculas (o valor e comparado com as tecnicas do capa).
  .transform((r) =>
    r.condition === 'ATTACK_TECHNIQUE' && r.value ? { ...r, value: r.value.toUpperCase() } : r,
  );

/**
 * Regras de triagem (item 86): "quando a analise achar X, incluir tags Y e
 * subir a prioridade para Z". Mantidas por analistas e admins.
 */
export async function triageRuleRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas mantêm as regras de triagem.' });
      return null;
    }
    return user;
  };

  app.get('/api/triage-rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const rules = await prisma.triageRule.findMany({
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { id: true, displayName: true } } },
    });
    return reply.send({ rules: rules.map((r) => ({ ...r, label: triageRuleLabel(r) })) });
  });

  app.post('/api/triage-rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const rule = await prisma.triageRule.create({ data: { ...parsed.data, createdById: user.id } });
    await audit(prisma, req, {
      action: 'TRIAGE_RULE_CHANGED',
      actorId: user.id,
      targetLabel: rule.name,
      detail: `criada: ${triageRuleLabel(rule)}`,
    });
    return reply.code(201).send({ rule: { ...rule, label: triageRuleLabel(rule) } });
  });

  app.patch('/api/triage-rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { id } = req.params as { id: string };
    const rule = await prisma.triageRule.findUnique({ where: { id } });
    if (!rule) return reply.code(404).send({ error: 'Regra não encontrada.' });
    await prisma.triageRule.update({ where: { id }, data: parsed.data });
    await audit(prisma, req, {
      action: 'TRIAGE_RULE_CHANGED',
      actorId: user.id,
      targetLabel: rule.name,
      detail: parsed.data.enabled ? 'ligada' : 'desligada',
    });
    return reply.send({ ok: true });
  });

  app.delete('/api/triage-rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const rule = await prisma.triageRule.findUnique({ where: { id } });
    if (!rule) return reply.code(404).send({ error: 'Regra não encontrada.' });
    await prisma.triageRule.delete({ where: { id } });
    await audit(prisma, req, {
      action: 'TRIAGE_RULE_CHANGED',
      actorId: user.id,
      targetLabel: rule.name,
      detail: 'excluída',
    });
    return reply.send({ ok: true });
  });
}
