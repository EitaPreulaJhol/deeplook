import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeText } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { enqueueGhidra, ghidraEnabled, ghidraIneligible, readGhidraFunction } from '../lib/ghidra';
import { prisma } from '../lib/prisma';
import { isMissingObject, MISSING_OBJECT_MESSAGE, s3 } from '../lib/s3';
import { sendValidationError } from '../lib/validation';

const analysisSelect = {
  status: true,
  summary: true,
  gzfKey: true,
  gzfSize: true,
  gzfError: true,
  pseudoKey: true,
  pseudoSize: true,
  pseudoError: true,
  pseudoTotal: true,
  pseudoDeadlineHit: true,
  pseudoCapHit: true,
  _count: { select: { functions: true } },
  error: true,
  version: true,
  ms: true,
  attempts: true,
  nextAttemptAt: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: { select: { id: true, displayName: true } },
} as const;

const entrySelect = {
  type: true,
  fileSize: true,
  filePurgedAt: true,
  staticInfo: true,
  ownerId: true,
  title: true,
  originalFilename: true,
} as const;

const NO_PSEUDO_MESSAGE = 'O pseudo-C completo desta análise não está disponível.';

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
/** Filtro e ordem da lista de funcoes (a especificacao OpenAPI sai daqui, lib/openapi.ts). */
export const FunctionsQuery = z.object({
  q: z.string().trim().max(200).default(''),
  sensitive: flag,
  hideLibrary: flag,
  sort: z.enum(['priority', 'name', 'address', 'size', 'complexity']).default('priority'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const ORDER = {
  priority: [{ rank: 'asc' }],
  name: [{ name: 'asc' }, { rank: 'asc' }],
  // O Ghidra escreve os enderecos de um programa com a mesma largura: a ordem do texto basta.
  address: [{ entry: 'asc' }],
  size: [{ size: 'desc' }, { rank: 'asc' }],
  complexity: [{ complexity: 'desc' }, { rank: 'asc' }],
} as const;

/** A analise da amostra com o pseudo-C completo, ou null. */
const pseudoOf = (entryId: string) =>
  prisma.ghidraAnalysis.findFirst({
    where: { entryId, pseudoKey: { not: null } },
    select: {
      id: true,
      pseudoKey: true,
      pseudoTotal: true,
      pseudoDeadlineHit: true,
      pseudoCapHit: true,
    },
  });

/**
 * Analise com o Ghidra (item 7.3), sob demanda: analistas pedem; quem ve a amostra ve o resumo e o
 * pseudo-C (o requireUser ja barra a amostra de outro dono). O projeto .gzf tem os bytes da
 * amostra: baixa-lo segue a regra de baixar a amostra (quem enviou e os analistas) e fica na
 * Auditoria.
 */
export async function ghidraRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/ghidra', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const analysis = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: analysisSelect,
    });
    const ahead =
      analysis?.status === 'PENDING'
        ? await prisma.ghidraAnalysis.count({
            where: {
              status: { in: ['PENDING', 'RUNNING'] },
              createdAt: { lt: analysis.createdAt },
            },
          })
        : null;
    const reason = ghidraIneligible(entry);
    // Motivos no idioma de quem pede (plano pos-revisao, item 1.4).
    const lang = requestLang(req);
    const { gzfKey, pseudoKey, _count, ...rest } = analysis ?? {
      gzfKey: null,
      pseudoKey: null,
      _count: { functions: 0 },
    };
    const kind = (entry.staticInfo as { detectedType?: { id?: string } | null } | null)
      ?.detectedType?.id;
    return reply.send({
      enabled: ghidraEnabled(),
      // Executavel (a secao aparece); eligible diz se da para pedir agora (.NET, teto, expurgo).
      applicable: entry.type === 'FILE' && (kind === 'pe' || kind === 'elf'),
      eligible: reason === null,
      reason: localizeText(reason, lang),
      maxMb: env.GHIDRA_MAX_MB,
      // Baixar o projeto: quem enviou e os analistas (como a amostra).
      canDownload: entry.ownerId === user.id || isAnalyst(user),
      analysis: analysis
        ? {
            ...rest,
            error: localizeText(analysis.error, lang),
            gzfError: localizeText(analysis.gzfError, lang),
            hasProject: Boolean(gzfKey),
            // Pseudo-C de todas as funcoes (plans/ghidra-pseudo-c): a janela abre por ele.
            pseudoError: localizeText(analysis.pseudoError, lang),
            hasPseudo: Boolean(pseudoKey),
            pseudoFunctions: _count.functions,
            ahead,
          }
        : null,
    });
  });

  app.post('/api/entries/:id/ghidra', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem a análise com o Ghidra.' });
    }
    if (!ghidraEnabled()) {
      return reply
        .code(503)
        .send({ error: 'A análise com o Ghidra está desligada (GHIDRA_URL / GHIDRA_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const reason = ghidraIneligible(entry);
    if (reason) return reply.code(400).send({ error: reason });
    const current = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: { status: true },
    });
    if (current && (current.status === 'PENDING' || current.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'A análise com o Ghidra já está na fila.' });
    }
    await enqueueGhidra(id, user.id);
    return reply.code(202).send({ ok: true });
  });

  app.get('/api/entries/:id/ghidra/project', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    // So quem enviou e os analistas (como "Baixar amostra", item 122): o .gzf tem os bytes dela.
    if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
      return reply
        .code(403)
        .send({ error: 'Somente quem enviou e os analistas baixam o projeto do Ghidra.' });
    }
    if (entry?.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    const analysis = await prisma.ghidraAnalysis.findUnique({
      where: { entryId: id },
      select: { gzfKey: true },
    });
    if (!entry || !analysis?.gzfKey) {
      return reply.code(404).send({ error: 'Projeto do Ghidra não encontrado.' });
    }
    const obj = await s3
      .send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: analysis.gzfKey }))
      .catch((err: unknown) => {
        if (isMissingObject(err)) return null;
        throw err;
      });
    if (!obj) return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: user.id,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: 'projeto do Ghidra (.gzf)',
    });
    const safeName = (entry.originalFilename || 'amostra').replace(/[^\w.-]+/g, '_');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `attachment; filename="${safeName}.gzf"`);
    if (obj.ContentLength) reply.header('Content-Length', String(obj.ContentLength));
    return reply.send(obj.Body as Readable);
  });

  // ---------------------------------------------------------------- pseudo-C de todas as funcoes

  /** Lista paginada das funcoes, com filtro e ordem. Quem ve a amostra ve a lista, como o resumo. */
  app.get('/api/entries/:id/ghidra/functions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = FunctionsQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { q, sensitive, hideLibrary, sort, page, pageSize } = parsed.data;
    const { id } = req.params as { id: string };
    const analysis = await pseudoOf(id);
    if (!analysis) return reply.code(404).send({ error: NO_PSEUDO_MESSAGE });
    const where = {
      analysisId: analysis.id,
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { entry: { contains: q.toLowerCase() } },
        ],
      }),
      ...(sensitive && { sensitive: { isEmpty: false } }),
      ...(hideLibrary && { library: false }),
    };
    const [listed, matching, rows] = await Promise.all([
      prisma.ghidraFunction.count({ where: { analysisId: analysis.id } }),
      prisma.ghidraFunction.count({ where }),
      prisma.ghidraFunction.findMany({
        where,
        orderBy: [...ORDER[sort]],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          entry: true,
          name: true,
          size: true,
          complexity: true,
          isEntryPoint: true,
          library: true,
          sensitive: true,
          cLength: true,
          truncated: true,
          skipped: true,
          error: true,
        },
      }),
    ]);
    const lang = requestLang(req);
    return reply.send({
      total: analysis.pseudoTotal,
      listed,
      deadlineHit: analysis.pseudoDeadlineHit,
      capHit: analysis.pseudoCapHit,
      matching,
      page,
      pageSize,
      functions: rows.map(({ cLength, error, ...f }) => ({
        ...f,
        hasCode: cLength !== null,
        error: localizeText(error, lang),
      })),
    });
  });

  /** Uma funcao: metadados, chamadores e chamadas com nome, e o codigo lido por Range no MinIO. */
  app.get('/api/entries/:id/ghidra/functions/:entry', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id, entry } = req.params as { id: string; entry: string };
    if (entry.length > 32) return reply.code(404).send({ error: 'Função não encontrada.' });
    const analysis = await pseudoOf(id);
    if (!analysis) return reply.code(404).send({ error: NO_PSEUDO_MESSAGE });
    const fn = await prisma.ghidraFunction.findUnique({
      where: { analysisId_entry: { analysisId: analysis.id, entry } },
    });
    if (!fn) return reply.code(404).send({ error: 'Função não encontrada.' });
    const linked = await prisma.ghidraFunction.findMany({
      where: { analysisId: analysis.id, entry: { in: [...fn.callers, ...fn.callees] } },
      select: { entry: true, name: true },
    });
    const names = new Map(linked.map((l) => [l.entry, l.name]));
    // Fora da lista (teto de 20 000 funcoes), vai so o endereco.
    const withNames = (list: string[]) =>
      list.map((a) => ({ entry: a, name: names.get(a) ?? null }));
    let c: string | null = null;
    if (fn.cOffset !== null && fn.cLength !== null) {
      try {
        c = await readGhidraFunction(analysis.pseudoKey!, fn.cOffset, fn.cLength);
      } catch (err) {
        if (isMissingObject(err)) return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
        req.log.error({ err }, 'Falha ao ler o pseudo-C no MinIO');
        return reply.code(502).send({ error: 'Não foi possível ler o pseudo-C no armazenamento.' });
      }
    }
    return reply.send({
      entry: fn.entry,
      name: fn.name,
      size: fn.size,
      complexity: fn.complexity,
      isEntryPoint: fn.isEntryPoint,
      library: fn.library,
      sensitive: fn.sensitive,
      apis: fn.apis,
      callers: withNames(fn.callers),
      callerCount: fn.callerCount,
      callees: withNames(fn.callees),
      calleeCount: fn.calleeCount,
      c,
      truncated: fn.truncated,
      skipped: fn.skipped,
      error: localizeText(fn.error, requestLang(req)),
    });
  });

  /**
   * O pseudo-C completo num .c so. Como o .gzf (decisao do dono): quem enviou e os analistas, na
   * Auditoria. Ao contrario dele, nao tem os bytes da amostra e continua depois do expurgo.
   */
  app.get('/api/entries/:id/ghidra/pseudo-c', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id }, select: entrySelect });
    if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
      return reply
        .code(403)
        .send({ error: 'Somente quem enviou e os analistas baixam o pseudo-C do Ghidra.' });
    }
    const analysis = entry ? await pseudoOf(id) : null;
    if (!entry || !analysis) return reply.code(404).send({ error: NO_PSEUDO_MESSAGE });
    const obj = await s3
      .send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: analysis.pseudoKey! }))
      .catch((err: unknown) => {
        if (isMissingObject(err)) return null;
        throw err;
      });
    if (!obj) return reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: user.id,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: 'pseudo-C do Ghidra (.c)',
    });
    const safeName = (entry.originalFilename || 'amostra').replace(/[^\w.-]+/g, '_');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `attachment; filename="${safeName}.c"`);
    if (obj.ContentLength) reply.header('Content-Length', String(obj.ContentLength));
    return reply.send(obj.Body as Readable);
  });
}
