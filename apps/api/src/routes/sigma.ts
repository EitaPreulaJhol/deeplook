import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { sampleFileName } from '../lib/sandbox';
import { type SigmaRule, SigmaUnsupported } from '../lib/sigma';
import {
  activeSigmaCount,
  compileTeamRule,
  safeMatch,
  setVendoredEnabled,
  sigmaDisabled,
  sigmaManifest,
  sigmaRules,
  sigmaRuleUrl,
  TEAM_PREFIX,
} from '../lib/sigma-rules';
import { SIGMA_LEVEL_ORDER, sigmaRetroState, sigmaRuleChanged } from '../lib/sigma-store';
import { apiTime, sampleTree, sysmonOffset } from '../lib/sysmon-store';
import { sendValidationError } from '../lib/validation';

/**
 * Regras Sigma da equipe e o catalogo das vendorizadas (plans/caca-e-formatos, item 1). Analistas e
 * admins criam, validam, testam numa execucao, ligam e desligam; cada mudanca refaz as deteccoes
 * da regra sobre os eventos ja guardados (sigma-store.ts, em segundo plano).
 */

const MAX_SOURCE = 64 * 1024;
const SourceSchema = z.object({ source: z.string().min(1).max(MAX_SOURCE) });
const RuleSchema = SourceSchema.extend({ enabled: z.boolean().default(true) });
const TestSchema = SourceSchema.extend({ sessionId: z.string().min(1).max(64) });
const CatalogQuery = z.object({
  q: z.string().trim().max(200).optional(),
  level: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
  state: z.enum(['all', 'on', 'off']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** Regras do catalogo por pagina. */
const CATALOG_PAGE = 100;
/** Eventos devolvidos no teste (o total vem contado). */
const TEST_EVENTS = 20;
/** Eventos lidos no teste (uma execucao longa tem dezenas de milhares). */
const TEST_SCAN_MAX = 200_000;
const TEST_BATCH = 2000;

const ruleSelect = {
  id: true,
  name: true,
  source: true,
  enabled: true,
  evaluatedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SigmaRuleSelect;

/** O resumo da regra compilada (a tela mostra o que o compilador entendeu). */
const summary = (rule: SigmaRule) => ({
  ruleId: rule.id,
  title: rule.title,
  level: rule.level,
  eventIds: rule.eventIds,
  techniques: rule.techniques,
});

/** Compila ou devolve o motivo legivel; o id provisorio so serve para compilar. */
function compile(source: string, id = 'nova'): { rule: SigmaRule } | { error: string } {
  try {
    return { rule: compileTeamRule(source, id) };
  } catch (err) {
    if (err instanceof SigmaUnsupported) return { error: err.message };
    throw err;
  }
}

const compileError = (reply: FastifyReply, why: string) =>
  reply.code(400).send({
    error: `A regra não compila: ${why}`,
    details: { source: [why] },
  });

/** Quantas execucoes cada regra disparou (deteccoes por regra, ambientes distintos). */
async function firedRuns(ruleIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.sandboxSigmaHit.groupBy({
    by: ['ruleId', 'sessionId'],
    ...(ruleIds && { where: { ruleId: { in: ruleIds } } }),
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.ruleId, (out.get(r.ruleId) ?? 0) + 1);
  return out;
}

export async function sigmaRoutes(app: FastifyInstance) {
  const requireAnalyst = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(req, reply);
    if (!user) return null;
    if (!isAnalyst(user)) {
      reply.code(403).send({ error: 'Somente analistas mantêm regras Sigma.' });
      return null;
    }
    return user;
  };

  const retroView = () => {
    const { current, queued } = sigmaRetroState();
    return { current, queued };
  };

  // ---- Regras da equipe
  app.get('/api/sigma/rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const rows = await prisma.sigmaRule.findMany({ orderBy: { name: 'asc' }, select: ruleSelect });
    const fired = await firedRuns(rows.map((r) => `${TEAM_PREFIX}${r.id}`));
    const retro = retroView();
    return reply.send({
      // Quantas valem agora: as vendorizadas ligadas e as da equipe ligadas.
      active: activeSigmaCount(),
      rules: rows.map((r) => {
        const compiled = compile(r.source, r.id);
        const ruleId = `${TEAM_PREFIX}${r.id}`;
        return {
          ...r,
          ruleId,
          rule: 'rule' in compiled ? summary(compiled.rule) : null,
          firedRuns: fired.get(ruleId) ?? 0,
          evaluating: retro.current === ruleId || retro.queued.includes(ruleId),
        };
      }),
    });
  });

  app.get('/api/sigma/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const rule = await prisma.sigmaRule.findUnique({ where: { id }, select: ruleSelect });
    if (!rule) return reply.code(404).send({ error: 'Regra não encontrada.' });
    return reply.send({ rule });
  });

  /** Valida sem salvar (botao "Validar"): o motivo ou o que o compilador entendeu. */
  app.post('/api/sigma/validate', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = SourceSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const compiled = compile(parsed.data.source);
    return reply.send(
      'rule' in compiled
        ? { ok: true, errors: [], rule: summary(compiled.rule) }
        : { ok: false, errors: [compiled.error] },
    );
  });

  app.post('/api/sigma/rules', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const compiled = compile(parsed.data.source);
    if ('error' in compiled) return compileError(reply, compiled.error);
    try {
      const rule = await prisma.$transaction(async (tx) => {
        const created = await tx.sigmaRule.create({
          data: {
            name: compiled.rule.title,
            source: parsed.data.source,
            enabled: parsed.data.enabled,
            createdById: user.id,
            updatedById: user.id,
          },
          select: ruleSelect,
        });
        await audit(tx, req, {
          action: 'SIGMA_RULE_CREATED',
          actorId: user.id,
          targetLabel: created.name,
        });
        return created;
      });
      await sigmaRuleChanged(`${TEAM_PREFIX}${rule.id}`);
      return reply.code(201).send({ rule: { ...rule, rule: summary(compiled.rule) } });
    } catch (err) {
      if (duplicate(err)) return duplicateTitle(reply);
      throw err;
    }
  });

  app.patch('/api/sigma/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    // So "enabled" = ligar/desligar pela lista; com "source" = edicao completa.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const toggle = Object.keys(body).length === 1 && typeof body.enabled === 'boolean';
    const parsed = toggle
      ? { success: true as const, data: { enabled: body.enabled as boolean } }
      : RuleSchema.safeParse(body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    let name: string | undefined;
    if ('source' in parsed.data) {
      const compiled = compile(parsed.data.source, id);
      if ('error' in compiled) return compileError(reply, compiled.error);
      name = compiled.rule.title;
    }
    try {
      const rule = await prisma.$transaction(async (tx) => {
        const updated = await tx.sigmaRule.update({
          where: { id },
          data: {
            ...parsed.data,
            ...(name && { name }),
            // Vai ser refeita sobre os eventos guardados: a tela mostra "avaliando".
            evaluatedAt: null,
            updatedById: user.id,
          },
          select: ruleSelect,
        });
        await audit(tx, req, {
          action: 'SIGMA_RULE_UPDATED',
          actorId: user.id,
          targetLabel: updated.name,
          detail: toggle ? (updated.enabled ? 'ativada' : 'desativada') : undefined,
        });
        return updated;
      });
      await sigmaRuleChanged(`${TEAM_PREFIX}${id}`);
      return reply.send({ rule });
    } catch (err) {
      if (duplicate(err)) return duplicateTitle(reply);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ error: 'Regra não encontrada.' });
      }
      throw err;
    }
  });

  app.delete('/api/sigma/rules/:id', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const existing = await prisma.sigmaRule.findUnique({ where: { id }, select: { name: true } });
    if (!existing) return reply.code(404).send({ error: 'Regra não encontrada.' });
    await prisma.$transaction(async (tx) => {
      await tx.sigmaRule.delete({ where: { id } });
      await audit(tx, req, {
        action: 'SIGMA_RULE_DELETED',
        actorId: user.id,
        targetLabel: existing.name,
      });
    });
    await sigmaRuleChanged(`${TEAM_PREFIX}${id}`);
    return reply.send({ ok: true });
  });

  // ---- Testar uma regra (salva ou nao) numa execucao, sem gravar nada
  app.post('/api/sigma/test', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = TestSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const compiled = compile(parsed.data.source);
    if ('error' in compiled) return compileError(reply, compiled.error);
    const { rule } = compiled;
    const session = await prisma.sandboxSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: { id: true, entry: { select: { originalFilename: true } } },
    });
    if (!session) return reply.code(404).send({ error: 'Execução não encontrada.' });
    const [tree, offsetMs] = await Promise.all([
      sampleTree(session.id, sampleFileName({ originalFilename: session.entry.originalFilename })),
      sysmonOffset(session.id),
    ]);
    let matched = 0;
    let scanned = 0;
    let cursor: string | undefined;
    const events: unknown[] = [];
    while (scanned < TEST_SCAN_MAX) {
      const rows = await prisma.sandboxSysmonEvent.findMany({
        where: {
          sessionId: session.id,
          ...(rule.eventIds.length && { eventId: { in: rule.eventIds } }),
        },
        orderBy: { id: 'asc' },
        take: TEST_BATCH,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: { id: true, eventId: true, time: true, processGuid: true, image: true, data: true },
      });
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      scanned += rows.length;
      for (const row of rows) {
        const data = row.data as Record<string, string | null>;
        if (!safeMatch(rule, { eventId: row.eventId, data })) continue;
        matched += 1;
        if (events.length < TEST_EVENTS) {
          const pid = Number(data.ProcessId ?? data.SourceProcessId);
          events.push({
            time: apiTime(row.time, offsetMs),
            eventId: row.eventId,
            image: row.image,
            pid: Number.isInteger(pid) ? pid : null,
            sample: Boolean(row.processGuid && tree.has(row.processGuid)),
            event: data,
          });
        }
      }
      if (rows.length < TEST_BATCH) break;
    }
    return reply.send({
      rule: summary(rule),
      matched,
      scanned,
      truncated: scanned >= TEST_SCAN_MAX,
      events,
    });
  });

  /** Execucoes com eventos do Sysmon, as mais recentes primeiro (o seletor do "Testar"). */
  app.get('/api/sigma/runs', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const q = String((req.query as { q?: string }).q ?? '')
      .trim()
      .slice(0, 200);
    const sessions = await prisma.sandboxSession.findMany({
      where: {
        sysmonEvents: { some: {} },
        ...(q && {
          OR: [
            { id: q },
            { entry: { title: { contains: q, mode: 'insensitive' } } },
            { entry: { originalFilename: { contains: q, mode: 'insensitive' } } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        createdAt: true,
        startedAt: true,
        entry: { select: { id: true, title: true } },
        _count: { select: { sysmonEvents: true } },
      },
    });
    return reply.send({
      runs: sessions.map((s) => ({
        id: s.id,
        startedAt: (s.startedAt ?? s.createdAt).toISOString(),
        entryId: s.entry.id,
        entryTitle: s.entry.title,
        events: s._count.sysmonEvents,
      })),
    });
  });

  // ---- Catalogo das vendorizadas: busca, ligar e desligar
  app.get('/api/sigma/catalog', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const parsed = CatalogQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { q, level, state, page } = parsed.data;
    const disabled = sigmaDisabled();
    const needle = q?.toLowerCase();
    const rank = (l: string) => SIGMA_LEVEL_ORDER.indexOf(l);
    const all = sigmaRules()
      .rules.filter(
        (r) =>
          (!level || r.level === level) &&
          (state === 'all' || (state === 'off') === disabled.has(r.id)) &&
          (!needle ||
            r.title.toLowerCase().includes(needle) ||
            r.id.toLowerCase() === needle ||
            r.path.toLowerCase().includes(needle) ||
            r.techniques.some((t) => t.toLowerCase() === needle)),
      )
      .sort((a, b) => rank(a.level) - rank(b.level) || a.title.localeCompare(b.title));
    const slice = all.slice((page - 1) * CATALOG_PAGE, page * CATALOG_PAGE);
    const fired = await firedRuns(slice.map((r) => r.id));
    const retro = retroView();
    const manifest = sigmaManifest();
    return reply.send({
      source: {
        name: manifest?.name ?? null,
        release: manifest?.release ?? null,
        license: manifest?.license ?? null,
        url: manifest?.url ?? null,
      },
      total: all.length,
      disabledTotal: disabled.size,
      page,
      pageSize: CATALOG_PAGE,
      rules: slice.map((r) => ({
        ...summary(r),
        path: r.path,
        description: r.description,
        enabled: !disabled.has(r.id),
        firedRuns: fired.get(r.id) ?? 0,
        url: sigmaRuleUrl(r),
        evaluating: retro.current === r.id || retro.queued.includes(r.id),
      })),
    });
  });

  app.patch('/api/sigma/catalog/:ruleId', async (req, reply) => {
    const user = await requireAnalyst(req, reply);
    if (!user) return;
    const { ruleId } = req.params as { ruleId: string };
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const rule = sigmaRules().rules.find((r) => r.id === ruleId);
    if (!rule) return reply.code(404).send({ error: 'Regra não encontrada.' });
    await setVendoredEnabled(rule.id, parsed.data.enabled);
    await audit(prisma, req, {
      action: 'SIGMA_RULE_UPDATED',
      actorId: user.id,
      targetLabel: rule.title,
      detail: parsed.data.enabled ? 'SigmaHQ: ativada' : 'SigmaHQ: desativada',
    });
    await sigmaRuleChanged(rule.id);
    return reply.send({ ok: true, enabled: parsed.data.enabled });
  });
}

const duplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const duplicateTitle = (reply: FastifyReply) =>
  reply.code(409).send({
    error: 'Já existe uma regra da equipe com este título.',
    details: { source: ['título em uso'] },
  });
