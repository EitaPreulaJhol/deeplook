import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';

const ListQuery = z.object({
  scope: z.enum(['all', 'mine']).default('all'),
  type: z.enum(['FILE', 'URL']).optional(),
  status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
  q: z.string().optional(),
  /** Responsavel: `me` (atribuidas a mim) ou `none` (sem responsavel). */
  assignee: z.enum(['me', 'none']).optional(),
  /** Hash exato (64 hex): usado para avisar que a amostra ja foi enviada. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  sort: z
    .enum(['title', 'type', 'owner', 'assignee', 'status', 'verdict', 'reports', 'createdAt'])
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

export async function entryRoutes(app: FastifyInstance) {
  // Listagem (historico global ou "meus uploads")
  app.get('/api/entries', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parametros invalidos.' });
    const { scope, type, status, verdict, q, sha256, assignee, limit, offset, sort, dir } =
      parsed.data;

    const where: any = {};
    if (scope === 'mine') where.ownerId = user.id;
    if (type) where.type = type;
    if (status) where.status = status;
    if (verdict) where.verdict = verdict;
    if (sha256) where.sha256 = sha256.toLowerCase();
    if (assignee === 'me') where.assigneeId = user.id;
    if (assignee === 'none') where.assigneeId = null;
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

    const [total, items] = await Promise.all([
      prisma.entry.count({ where }),
      prisma.entry.findMany({
        where,
        orderBy: listOrderBy(sort, dir),
        skip: offset,
        take: limit,
        include: {
          owner: { select: { id: true, displayName: true, email: true } },
          assignee: { select: { id: true, displayName: true } },
          tags: true,
          _count: { select: { reports: true } },
        },
      }),
    ]);

    return reply.send({ total, limit, offset, items });
  });

  // Submissao de ARQUIVO (multipart)
  // Contadores das filas do Navegador do Sistema (Pendentes, Em analise...).
  // Rota estatica: o find-my-way a prioriza sobre /api/entries/:id.
  app.get('/api/entries/counts', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const [groups, mine] = await Promise.all([
      prisma.entry.groupBy({ by: ['status'], _count: { _all: true } }),
      // Fila "Atribuidas a mim": so as que ainda nao foram concluidas.
      prisma.entry.count({ where: { assigneeId: user.id, status: { not: 'COMPLETED' } } }),
    ]);
    const counts = { PENDING: 0, IN_REVIEW: 0, COMPLETED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;
    return reply.send({ counts, mine });
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

    let fileBuffer: Buffer | null = null;
    let filename = 'arquivo';
    let mimetype = 'application/octet-stream';
    const fields: Record<string, string> = {};

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
          fileBuffer = await part.toBuffer();
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (err: any) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply
          .code(413)
          .send({ error: `Arquivo maior que o limite de ${env.MAX_UPLOAD_MB} MB.` });
      }
      req.log.error(err);
      return reply.code(400).send({ error: 'Falha ao processar o upload.' });
    }

    if (!fileBuffer) return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });

    const title = (fields.title || filename).slice(0, 200);
    const description = fields.description ? fields.description.slice(0, 4000) : null;
    const tagNames = parseTags(fields.tags);

    const sha256 = sha256Hex(fileBuffer);
    const storageKey = `samples/${randomUUID()}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: mimetype,
        Metadata: { originalfilename: encodeURIComponent(filename), sha256 },
      }),
    );

    const tags = await resolveTags(tagNames);

    const entry = await prisma.entry.create({
      data: {
        ownerId: user.id,
        type: 'FILE',
        title,
        description,
        originalFilename: filename,
        storageKey,
        bucket: env.S3_BUCKET,
        fileSize: fileBuffer.length,
        mimeType: mimetype,
        sha256,
        tags: { connect: tags },
      },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        tags: true,
      },
    });

    await recordEvent(prisma, { entryId: entry.id, actorId: user.id, type: 'CREATED' });
    return reply.code(201).send({ entry });
  });

  // Submissao de LINK (JSON)
  app.post('/api/entries/url', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = UrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Dados invalidos.', details: parsed.error.flatten().fieldErrors });
    }
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
        reports: {
          orderBy: { createdAt: 'desc' },
          include: { analyst: { select: { id: true, displayName: true, role: true } } },
        },
      },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra nao encontrada.' });
    return reply.send({ entry });
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
    if (!parsed.success) return reply.code(400).send({ error: 'Dados invalidos.' });
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
    let newAssignee: { id: string; displayName: string } | null | undefined;
    if (data.assigneeId !== undefined) {
      if (!canTriage) {
        return reply.code(403).send({ error: 'Somente analistas podem atribuir amostras.' });
      }
      if (data.assigneeId === null) {
        newAssignee = null;
      } else {
        const target = await prisma.user.findUnique({
          where: { id: data.assigneeId },
          select: { id: true, displayName: true, role: true, status: true },
        });
        if (!target || target.status !== 'ACTIVE' || target.role === 'USER') {
          return reply.code(400).send({ error: 'Responsavel deve ser um analista ativo.' });
        }
        newAssignee = { id: target.id, displayName: target.displayName };
      }
      updateData.assigneeId = newAssignee?.id ?? null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.entry.update({
        where: { id },
        data: updateData,
        include: {
          owner: { select: { id: true, displayName: true, email: true } },
          assignee: { select: { id: true, displayName: true } },
          tags: true,
        },
      });
      await recordTriageChanges(tx, id, user.id, entry, data);
      if (newAssignee !== undefined && (newAssignee?.id ?? null) !== entry.assigneeId) {
        await recordEvent(tx, {
          entryId: id,
          actorId: user.id,
          type: 'ASSIGNED',
          fromValue: entry.assignee?.displayName ?? null,
          toValue: newAssignee?.displayName ?? null,
        });
      }
      return result;
    });
    return reply.send({ entry: updated });
  });

  // Download do arquivo (autenticado; objetos nunca ficam publicos no MinIO)
  app.get('/api/entries/:id/download', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({ where: { id } });
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
