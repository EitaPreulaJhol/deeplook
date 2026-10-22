import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { EntryStatus, Prisma, Verdict } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { scanInBackground } from '../lib/clamav';
import { sha256Hex } from '../lib/crypto';
import { toCsv } from '../lib/csv';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { excerpt, notify, resolveMentions } from '../lib/notifications';
import type { Tx } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { attemptLimit, sessionKey } from '../lib/rate-limit';
import { checkReputationInBackground } from '../lib/reputation';
import { s3 } from '../lib/s3';
import { slaConfig, slaCutoff } from '../lib/sla';
import { analyzeBuffer } from '../lib/static-analysis';
import { sendValidationError } from '../lib/validation';
import type { ZipEntry } from '../lib/zip';
import { extractZipEntry, listZip, ZipError } from '../lib/zip';
import { reviewRequired } from './reports';

/**
 * Texto da atualizacao: texto puro (o front exibe escapado), quebras de linha
 * normalizadas e sem caracteres de controle; 1 a 4000 caracteres.
 */
const CommentSchema = z.object({
  text: z
    .string()
    .transform((value) =>
      value
        .replace(/\r\n?/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .trim(),
    )
    .pipe(z.string().min(1).max(4000)),
  /** Usuarios escolhidos no autocompletar de "@" (validados na API). */
  mentions: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const ListQuery = z.object({
  scope: z.enum(['all', 'mine']).default('all'),
  type: z.enum(['FILE', 'URL']).optional(),
  status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
  q: z.string().optional(),
  /** Responsavel: `me` (atribuidas a mim) ou `none` (sem responsavel). */
  assignee: z.union([z.enum(['me', 'none']), z.string().regex(/^c[a-z0-9]{20,32}$/)]).optional(),
  /** Prazo: nao concluidas ha mais de SLA_WARN_HOURS (`warn`) ou SLA_LATE_HOURS (`late`). */
  age: z.enum(['warn', 'late']).optional(),
  /** Enviadas a partir deste instante (links do Painel). */
  submittedFrom: z.coerce.date().optional(),
  /** Concluidas (sem duplicatas) a partir deste instante (links do Painel). */
  completedFrom: z.coerce.date().optional(),
  /** Hash exato (64 hex): usado para avisar que a amostra ja foi enviada. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  sort: z
    .enum([
      'title',
      'type',
      'owner',
      'assignee',
      'status',
      'age',
      'verdict',
      'reports',
      'createdAt',
    ])
    .default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

/** Coluna da lista -> orderBy do Prisma (o id desempata para a paginacao ficar estavel). */
function listOrderBy(sort: z.infer<typeof ListQuery>['sort'], dir: 'asc' | 'desc') {
  const primary =
    sort === 'owner'
      ? { owner: { displayName: dir } }
      : sort === 'assignee'
        ? { assignee: { displayName: dir } }
        : sort === 'reports'
          ? { reports: { _count: dir } }
          : sort === 'age'
            ? // Idade decrescente = ha mais tempo no status (data mais antiga primeiro).
              { statusChangedAt: dir === 'desc' ? ('asc' as const) : ('desc' as const) }
            : { [sort]: dir };
  return [primary, { id: 'asc' as const }];
}

const UrlSchema = z.object({
  url: z.string().url(),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  tags: z.string().optional(),
});

const PatchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
  /** Analista responsavel (id) ou null para remover a atribuicao. */
  assigneeId: z.string().min(1).nullable().optional(),
});

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function parseTags(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

async function resolveTags(names: string[]) {
  const links: { id: string }[] = [];
  for (const name of names) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    links.push({ id: tag.id });
  }
  return links;
}

/** Filtros da lista (tambem usados na exportacao CSV). */
function listWhere(
  filters: Pick<
    z.infer<typeof ListQuery>,
    | 'scope'
    | 'type'
    | 'status'
    | 'verdict'
    | 'q'
    | 'sha256'
    | 'assignee'
    | 'age'
    | 'submittedFrom'
    | 'completedFrom'
  >,
  userId: string,
): Prisma.EntryWhereInput {
  const { scope, type, status, verdict, q, sha256, assignee, age, submittedFrom, completedFrom } =
    filters;
  const where: Prisma.EntryWhereInput = {};
  if (scope === 'mine') where.ownerId = userId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (verdict) where.verdict = verdict;
  if (sha256) where.sha256 = sha256.toLowerCase();
  if (assignee === 'me') where.assigneeId = userId;
  if (assignee === 'none') where.assigneeId = null;
  if (assignee && assignee !== 'me' && assignee !== 'none') where.assigneeId = assignee;
  if (submittedFrom) where.createdAt = { gte: submittedFrom };
  if (completedFrom) {
    where.status = 'COMPLETED';
    where.duplicateOfId = null;
    where.statusChangedAt = { gte: completedFrom };
  }
  if (age) {
    where.AND = [{ status: { not: 'COMPLETED' } }, { statusChangedAt: { lt: slaCutoff(age) } }];
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { url: { contains: q, mode: 'insensitive' } },
      { sha256: { contains: q, mode: 'insensitive' } },
      { originalFilename: { contains: q, mode: 'insensitive' } },
      { tags: { some: { name: { contains: q, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

type Assignee = { id: string; displayName: string } | null;

/**
 * Valida o novo responsavel: null remove a atribuicao; um id precisa ser de um
 * analista/admin ativo. Devolve o responsavel ou a mensagem de erro (400).
 */
async function resolveAssignee(assigneeId: string | null): Promise<Assignee | { error: string }> {
  if (assigneeId === null) return null;
  const target = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, displayName: true, role: true, status: true },
  });
  if (!target || target.status !== 'ACTIVE' || target.role === 'USER') {
    return { error: 'Responsavel deve ser um analista ativo.' };
  }
  return { id: target.id, displayName: target.displayName };
}

/**
 * Aplica uma mudanca de triagem (status, veredito, responsavel) a uma amostra
 * dentro da transacao e grava os eventos correspondentes no historico.
 */
async function applyTriage(
  tx: Tx,
  entry: Prisma.EntryGetPayload<{
    include: { assignee: { select: { id: true; displayName: true } } };
  }>,
  actorId: string,
  data: { status?: EntryStatus; verdict?: Verdict },
  updateData: Prisma.EntryUncheckedUpdateInput,
  newAssignee: Assignee | undefined,
) {
  if (newAssignee !== undefined) updateData.assigneeId = newAssignee?.id ?? null;
  const result = await tx.entry.update({
    where: { id: entry.id },
    data: updateData,
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      assignee: { select: { id: true, displayName: true } },
      tags: true,
    },
  });
  await recordTriageChanges(tx, entry.id, actorId, entry, data);
  if (newAssignee !== undefined && (newAssignee?.id ?? null) !== entry.assigneeId) {
    await recordEvent(tx, {
      entryId: entry.id,
      actorId,
      type: 'ASSIGNED',
      fromValue: entry.assignee?.displayName ?? null,
      toValue: newAssignee?.displayName ?? null,
    });
    if (newAssignee) {
      await notify(tx, [{ userId: newAssignee.id, type: 'ASSIGNED', entryId: entry.id, actorId }]);
    }
  }
  return result;
}

/** Atualizacao em massa: ate 100 amostras, so campos de triagem. */
const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  patch: z
    .object({
      status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
      verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
      assigneeId: z.string().min(1).nullable().optional(),
    })
    .strict()
    .refine((p) => Object.keys(p).length > 0, 'Nada para atualizar.'),
});

/** Limite de linhas da exportacao CSV. */
const EXPORT_MAX_ROWS = 10_000;

const STATUS_LABELS = { PENDING: 'Pendente', IN_REVIEW: 'Em análise', COMPLETED: 'Concluído' };
const VERDICT_LABELS = {
  UNKNOWN: 'Desconhecido',
  CLEAN: 'Limpo',
  SUSPICIOUS: 'Suspeito',
  MALICIOUS: 'Malicioso',
};

/** Envio por .zip: arquivos por pacote e limites de tamanho (por arquivo e total). */
const ZIP_MAX_FILES = 20;
const ZIP_MAX_FILE_BYTES = () => env.MAX_UPLOAD_MB * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = () => 2 * ZIP_MAX_FILE_BYTES();

interface Upload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  fields: Record<string, string>;
}

/** Le o multipart (um arquivo e os campos). Em erro ja responde e devolve null. */
async function readUpload(req: FastifyRequest, reply: FastifyReply): Promise<Upload | null> {
  let buffer: Buffer | null = null;
  let filename = 'arquivo';
  let mimetype = 'application/octet-stream';
  const fields: Record<string, string> = {};

  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        buffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (err: any) {
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
      reply.code(413).send({ error: `Arquivo maior que o limite de ${env.MAX_UPLOAD_MB} MB.` });
      return null;
    }
    req.log.error(err);
    reply.code(400).send({ error: 'Falha ao processar o upload.' });
    return null;
  }

  if (!buffer) {
    reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
    return null;
  }
  return { buffer, filename, mimetype, fields };
}

/**
 * Grava o arquivo no MinIO e cria a amostra (envio unico, lote e .zip). Devolve
 * tambem a primeira amostra ja enviada com o mesmo SHA-256, se houver.
 */
async function createFileEntry(
  req: FastifyRequest,
  ownerId: string,
  input: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    title: string;
    description: string | null;
    tags: { id: string }[];
  },
) {
  const { buffer, filename, mimetype } = input;
  const sha256 = sha256Hex(buffer);
  const storageKey = `samples/${randomUUID()}`;
  // Analise estatica (so leitura, com limites); falha nao impede o envio.
  let staticInfo: ReturnType<typeof analyzeBuffer> | undefined;
  try {
    staticInfo = analyzeBuffer(buffer, filename);
  } catch (err) {
    req.log.warn({ err }, 'Falha na analise estatica');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: mimetype,
      Metadata: { originalfilename: encodeURIComponent(filename), sha256 },
    }),
  );

  const entry = await prisma.entry.create({
    data: {
      ownerId,
      type: 'FILE',
      title: input.title.slice(0, 200),
      description: input.description ? input.description.slice(0, 4000) : null,
      originalFilename: filename,
      storageKey,
      bucket: env.S3_BUCKET,
      fileSize: buffer.length,
      mimeType: mimetype,
      sha256,
      staticInfo: staticInfo ? (staticInfo as unknown as Prisma.InputJsonValue) : undefined,
      tags: { connect: input.tags },
    },
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      tags: true,
    },
  });

  await recordEvent(prisma, { entryId: entry.id, actorId: ownerId, type: 'CREATED' });
  checkReputationInBackground(entry.id, req.log);
  scanInBackground(entry.id, buffer, req.log);
  const previous = await prisma.entry.findFirst({
    where: { sha256, id: { not: entry.id } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true },
  });
  return { entry, previous };
}

export async function entryRoutes(app: FastifyInstance) {
  // Exportacao CSV da lista filtrada/ordenada (sem paginacao, ate 10 mil linhas).
  app.get('/api/entries/export.csv', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parametros invalidos.' });

    const items = await prisma.entry.findMany({
      where: listWhere(parsed.data, user.id),
      orderBy: listOrderBy(parsed.data.sort, parsed.data.dir),
      take: EXPORT_MAX_ROWS,
      include: {
        owner: { select: { displayName: true } },
        assignee: { select: { displayName: true } },
        tags: { select: { name: true } },
        _count: { select: { reports: true } },
      },
    });

    const csv = toCsv(
      [
        'ID',
        'Amostra',
        'Tipo',
        'Enviado por',
        'Responsável',
        'Status',
        'Veredito',
        'Relatórios',
        'SHA-256',
        'URL',
        'Tags',
        'Enviado em',
        'No status desde',
      ],
      items.map((e) => [
        e.id,
        e.title,
        e.type === 'FILE' ? 'Arquivo' : 'Link',
        e.owner.displayName,
        e.assignee?.displayName ?? '',
        STATUS_LABELS[e.status],
        VERDICT_LABELS[e.verdict],
        e._count.reports,
        e.sha256,
        e.url,
        e.tags.map((t) => t.name).join(', '),
        e.createdAt,
        e.statusChangedAt,
      ]),
    );

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="deeplook-amostras-${day}.csv"`)
      .send(csv);
  });

  // Listagem (historico global ou "meus uploads")
  app.get('/api/entries', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parametros invalidos.' });
    const { limit, offset, sort, dir } = parsed.data;

    const where = listWhere(parsed.data, user.id);

    const [total, items] = await Promise.all([
      prisma.entry.count({ where }),
      prisma.entry.findMany({
        where,
        orderBy: listOrderBy(sort, dir),
        skip: offset,
        take: limit,
        omit: { staticInfo: true },
        include: {
          owner: { select: { id: true, displayName: true, email: true } },
          assignee: { select: { id: true, displayName: true } },
          tags: true,
          _count: { select: { reports: true } },
        },
      }),
    ]);

    return reply.send({ total, limit, offset, items, sla: slaConfig() });
  });

  // Submissao de ARQUIVO (multipart)
  // Contadores das filas do Navegador do Sistema (Pendentes, Em analise...).
  // Rota estatica: o find-my-way a prioriza sobre /api/entries/:id.
  app.get('/api/entries/counts', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const [groups, mine, late, reviews] = await Promise.all([
      prisma.entry.groupBy({ by: ['status'], _count: { _all: true } }),
      // Fila "Atribuidas a mim": so as que ainda nao foram concluidas.
      prisma.entry.count({ where: { assigneeId: user.id, status: { not: 'COMPLETED' } } }),
      // Fila "Atrasadas": nao concluidas ha mais de SLA_LATE_HOURS no status atual.
      prisma.entry.count({
        where: { status: { not: 'COMPLETED' }, statusChangedAt: { lt: slaCutoff('late') } },
      }),
      // Fila "Relatorios para revisar": em revisao, de outros analistas.
      prisma.report.count({
        where: { status: 'IN_REVIEW', analystId: { not: user.id }, entry: { deletedAt: null } },
      }),
    ]);
    const counts = { PENDING: 0, IN_REVIEW: 0, COMPLETED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return reply.send({ counts, mine, late, reviews });
  });

  // Analistas que podem ser responsaveis por uma amostra (select da triagem).
  app.get('/api/analysts', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) return reply.code(403).send({ error: 'Acesso negado.' });

    const analysts = await prisma.user.findMany({
      where: { role: { in: ['ANALYST', 'ADMIN'] }, status: 'ACTIVE' },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    });
    return reply.send({ analysts });
  });

  // Nova atualizacao (comentario) na linha do tempo da amostra. Qualquer usuario
  // logado pode registrar; fica visivel para todos e nao e editavel (auditoria).
  // Ate 10 por minuto por sessao.
  const commentLimit = attemptLimit(sessionKey('comment'), { max: 10, windowMs: 60_000 });
  app.post('/api/entries/:id/comments', { config: commentLimit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = CommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(
        reply,
        parsed.error,
        'Escreva a atualização (até 4000 caracteres).',
      );
    }

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { id: true, ownerId: true, assigneeId: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });

    const { text } = parsed.data;
    const mentions = await resolveMentions(text, parsed.data.mentions ?? []);
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.entryEvent.create({
        data: {
          entryId: id,
          actorId: user.id,
          type: 'COMMENT',
          detail: text,
          // Mencoes (id + nome) para o front destacar o "@Nome" no texto.
          toValue: mentions.length ? JSON.stringify(mentions) : null,
        },
        include: { actor: { select: { id: true, displayName: true } } },
      });
      // Mencionados primeiro: quem tambem e dono/responsavel recebe so a mencao.
      const detail = excerpt(text);
      await notify(tx, [
        ...mentions.map((m) => ({
          userId: m.id,
          type: 'MENTION' as const,
          entryId: id,
          actorId: user.id,
          detail,
        })),
        ...[entry.ownerId, entry.assigneeId]
          .filter((userId): userId is string => Boolean(userId))
          .map((userId) => ({
            userId,
            type: 'COMMENT' as const,
            entryId: id,
            actorId: user.id,
            detail,
          })),
      ]);
      return created;
    });
    return reply.code(201).send({ event });
  });

  // Analise estatica sob demanda (amostras enviadas antes do recurso): baixa o
  // objeto do MinIO e analisa (so leitura). Analistas.
  app.post('/api/entries/:id/static-analysis', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas reanalisam amostras.' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    if (entry.type === 'FILE' && entry.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if (entry.type !== 'FILE' || !entry.storageKey) {
      return reply.code(400).send({ error: 'So arquivos tem analise estatica.' });
    }
    let buffer: Buffer;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
      );
      buffer = Buffer.from(await obj.Body!.transformToByteArray());
    } catch (err) {
      req.log.error({ err }, 'Falha ao ler a amostra no MinIO');
      return reply.code(502).send({ error: 'Nao foi possivel ler o arquivo no armazenamento.' });
    }
    const staticInfo = analyzeBuffer(buffer, entry.originalFilename);
    await prisma.entry.update({
      where: { id },
      data: { staticInfo: staticInfo as unknown as Prisma.InputJsonValue },
    });
    return reply.send({ staticInfo });
  });

  // Historico (auditoria) da amostra: quem fez o que e quando.
  app.get('/api/entries/:id/events', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const events = await prisma.entryEvent.findMany({
      where: { entryId: id },
      // Eventos da mesma transacao podem ter o mesmo milissegundo: o id (cuid,
      // crescente) desempata na ordem em que foram gravados.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, displayName: true } } },
    });
    return reply.send({ events });
  });

  app.post('/api/entries/file', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const upload = await readUpload(req, reply);
    if (!upload) return;

    const { entry, previous } = await createFileEntry(req, user.id, {
      buffer: upload.buffer,
      filename: upload.filename,
      mimetype: upload.mimetype,
      title: upload.fields.title || upload.filename,
      description: upload.fields.description || null,
      tags: await resolveTags(parseTags(upload.fields.tags)),
    });
    return reply.code(201).send({ entry, previous });
  });

  // Envio em lote por .zip (ex.: pacote de malware com a senha "infected"):
  // cada arquivo de dentro vira uma amostra, com a mesma descricao e as mesmas
  // tags. O pacote e aberto so na memoria, nunca no disco nem executado.
  app.post('/api/entries/zip', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const upload = await readUpload(req, reply);
    if (!upload) return;

    const password = upload.fields.password ?? '';
    if (password.length > 200) {
      return reply
        .code(400)
        .send({ error: 'Dados invalidos.', details: { password: ['máximo de 200 caracteres'] } });
    }

    let files: ZipEntry[];
    try {
      files = listZip(upload.buffer).filter(
        (e) => !e.dir && !e.path.startsWith('__MACOSX/') && e.name !== '.DS_Store',
      );
    } catch (err) {
      if (err instanceof ZipError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    if (files.length === 0) return reply.code(400).send({ error: 'O .zip não tem arquivos.' });

    const tags = await resolveTags(parseTags(upload.fields.tags));
    const base = upload.fields.description ? upload.fields.description.slice(0, 3600) : '';
    const created: {
      name: string;
      path: string;
      entry: { id: string; title: string; sha256: string | null; fileSize: number | null };
      previous: { id: string; title: string } | null;
    }[] = [];
    const skipped: { name: string; path: string; reason: string }[] = [];
    let total = 0;
    let passwordError: string | null = null;

    for (const file of files) {
      if (created.length >= ZIP_MAX_FILES) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: `limite de ${ZIP_MAX_FILES} arquivos por pacote`,
        });
        continue;
      }
      if (file.size === 0) {
        skipped.push({ name: file.name, path: file.path, reason: 'arquivo vazio' });
        continue;
      }
      if (file.size > ZIP_MAX_FILE_BYTES()) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: 'Arquivo maior que o limite de upload.',
        });
        continue;
      }
      if (total + file.size > ZIP_MAX_TOTAL_BYTES()) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: 'limite total do pacote atingido',
        });
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = extractZipEntry(upload.buffer, file, password, ZIP_MAX_FILE_BYTES());
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        if (err.code === 'BAD_PASSWORD') passwordError ??= err.message;
        skipped.push({ name: file.name, path: file.path, reason: err.message });
        continue;
      }
      total += buffer.length;
      const origin = `Extraído de ${upload.filename}${file.path !== file.name ? ` (${file.path})` : ''}.`;
      const { entry, previous } = await createFileEntry(req, user.id, {
        buffer,
        filename: file.name,
        mimetype: 'application/octet-stream',
        title: file.name,
        description: base ? `${base}\n\n${origin}` : origin,
        tags,
      });
      created.push({
        name: file.name,
        path: file.path,
        entry: { id: entry.id, title: entry.title, sha256: entry.sha256, fileSize: entry.fileSize },
        previous,
      });
    }

    if (created.length === 0) {
      // Nada criado e a senha nao abriu: destaca o campo Senha.
      if (passwordError) {
        return reply.code(400).send({
          error: passwordError,
          details: { password: [passwordError] },
          created,
          skipped,
        });
      }
      return reply
        .code(400)
        .send({ error: 'Nenhum arquivo pôde ser extraído do .zip.', created, skipped });
    }
    return reply.code(201).send({ created, skipped });
  });

  // Submissao de LINK (JSON)
  app.post('/api/entries/url', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = UrlSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { url, title, description, tags: tagRaw } = parsed.data;

    const tags = await resolveTags(parseTags(tagRaw));

    const entry = await prisma.entry.create({
      data: {
        ownerId: user.id,
        type: 'URL',
        title,
        description: description || null,
        url,
        urlDomain: domainOf(url),
        tags: { connect: tags },
      },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        tags: true,
      },
    });

    await recordEvent(prisma, { entryId: entry.id, actorId: user.id, type: 'CREATED' });
    checkReputationInBackground(entry.id, req.log);
    return reply.code(201).send({ entry });
  });

  // Detalhe de uma amostra
  app.get('/api/entries/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        assignee: { select: { id: true, displayName: true } },
        tags: true,
        duplicateOf: { select: { id: true, title: true } },
        duplicates: {
          where: { deletedAt: null },
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: { select: { duplicates: { where: { deletedAt: null } } } },
        // Rascunhos e relatorios em revisao so para analistas.
        reports: {
          where: isAnalyst(user) ? {} : { status: 'PUBLISHED' },
          orderBy: { createdAt: 'desc' },
          include: {
            analyst: { select: { id: true, displayName: true, role: true } },
            reviewedBy: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    return reply.send({
      entry,
      sla: slaConfig(),
      reviewRequired: reviewRequired(),
      retentionDays: env.RETENTION_DAYS,
    });
  });

  // Edicao (dono edita titulo/descricao; analista define status/veredito)
  app.patch('/api/entries/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      include: { assignee: { select: { id: true, displayName: true } } },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;

    const isOwner = entry.ownerId === user.id;
    const canTriage = isAnalyst(user);
    const updateData: Prisma.EntryUncheckedUpdateInput = {};

    if (data.title !== undefined || data.description !== undefined) {
      if (!isOwner && !canTriage) return reply.code(403).send({ error: 'Acesso negado.' });
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
    }
    if (data.status !== undefined || data.verdict !== undefined) {
      if (!canTriage) {
        return reply.code(403).send({ error: 'Somente analistas podem alterar status/veredito.' });
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.verdict !== undefined) updateData.verdict = data.verdict;
    }

    // Atribuicao: so analistas/admins atribuem, e so a analistas/admins ativos.
    let newAssignee: Assignee | undefined;
    if (data.assigneeId !== undefined) {
      if (!canTriage) {
        return reply.code(403).send({ error: 'Somente analistas podem atribuir amostras.' });
      }
      const resolved = await resolveAssignee(data.assigneeId);
      if (resolved && 'error' in resolved) return reply.code(400).send(resolved);
      newAssignee = resolved;
    }

    const updated = await prisma.$transaction((tx) =>
      applyTriage(tx, entry, user.id, data, updateData, newAssignee),
    );
    return reply.send({ entry: updated });
  });

  // Atualizacao em massa (analistas): mesmas regras do PATCH, em uma transacao,
  // com os eventos de historico de cada amostra.
  app.post('/api/entries/bulk', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas podem atualizar em massa.' });
    }

    const parsed = BulkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
    const { ids, patch } = parsed.data;

    let newAssignee: Assignee | undefined;
    if (patch.assigneeId !== undefined) {
      const resolved = await resolveAssignee(patch.assigneeId);
      if (resolved && 'error' in resolved) return reply.code(400).send(resolved);
      newAssignee = resolved;
    }

    const entries = await prisma.entry.findMany({
      where: { id: { in: [...new Set(ids)] } },
      include: { assignee: { select: { id: true, displayName: true } } },
    });
    await prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const updateData: Prisma.EntryUncheckedUpdateInput = {};
        if (patch.status !== undefined) updateData.status = patch.status;
        if (patch.verdict !== undefined) updateData.verdict = patch.verdict;
        await applyTriage(tx, entry, user.id, patch, updateData, newAssignee);
      }
    });

    const found = new Set(entries.map((e) => e.id));
    return reply.send({
      updated: entries.length,
      notFound: ids.filter((id) => !found.has(id)),
    });
  });

  // Download do arquivo (autenticado; objetos nunca ficam publicos no MinIO)
  app.get('/api/entries/:id/download', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
    if (entry && entry.type === 'FILE' && entry.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if (!entry || entry.type !== 'FILE' || !entry.storageKey) {
      return reply.code(404).send({ error: 'Arquivo nao encontrado.' });
    }

    const obj = await s3.send(
      new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
    );

    const safeName = (entry.originalFilename || 'sample.bin').replace(/[^\w.-]+/g, '_');
    reply.header('Content-Type', entry.mimeType || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    if (entry.fileSize) reply.header('Content-Length', String(entry.fileSize));
    return reply.send(obj.Body as Readable);
  });
}
