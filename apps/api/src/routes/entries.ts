import { pipeline, type Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import type { EntryStatus, Priority, Prisma, Verdict } from '../generated/prisma/client';
import { withSubtechniques } from '../lib/attack';
import { audit } from '../lib/audit';
import {
  isAnalyst,
  linksForViewer,
  ownerForViewer,
  type PublicUser,
  requireUser,
  visibleEntries,
} from '../lib/auth';
import { csvSeparator, toCsv } from '../lib/csv';
import { localizeStaticInfo } from '../lib/data-language';
import { extractDiskFile } from '../lib/disk-image';
import { createFileEntry, createUrlEntry } from '../lib/entry-create';
import { requestLang } from '../lib/error-language';
import { recordEvent, recordTriageChanges } from '../lib/events';
import { scrubForViewer } from '../lib/exfil-store';
import { localizeEntryEvents } from '../lib/history-language';
import { hashingStream, judge, recordIntegrity } from '../lib/integrity';
import { rememberUrls } from '../lib/iocs';
import { scanLookalikesQuietly } from '../lib/lookalike';
import { excerpt, notify, resolveMentions } from '../lib/notifications';
import { relationHashes } from '../lib/pe-analysis';
import { replacePivots, staticPivots } from '../lib/pivots';
import type { Tx } from '../lib/prisma';
import { prisma } from '../lib/prisma';
import { QuotaExceeded, quotaMessage, uploadQuota } from '../lib/quota';
import { attemptLimit, sessionKey } from '../lib/rate-limit';
import { isMissingObject, MISSING_OBJECT_MESSAGE, s3 } from '../lib/s3';
import { SAMPLE_ZIP_PASSWORD, sampleZipStream, zipEntryName } from '../lib/sample-zip';
import { slaConfig, slaWhere } from '../lib/sla';
import type { StaticInfo } from '../lib/static-analysis';
import { analyzeInThread, diskImageInThread } from '../lib/static-analysis-thread';
import { applyTriageRules } from '../lib/triage-rules';
import { enterUpload, spoolGate, uploadGate, uploadLimits } from '../lib/upload-gate';
import { spoolToDisk } from '../lib/upload-spool';
import { sendValidationError } from '../lib/validation';
import type { ZipEntry } from '../lib/zip';
import { extractZipEntryAsync, listZip, ZipError } from '../lib/zip';
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

export const ListQuery = z.object({
  scope: z.enum(['all', 'mine']).default('all'),
  type: z.enum(['FILE', 'URL']).optional(),
  status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  /** Tecnica ATT&CK de um relatorio publicado (inclui as subtecnicas). */
  attack: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^T\d{4}(\.\d{3})?$/)
    .optional(),
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
      'priority',
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
            : sort === 'priority'
              ? // Decrescente = mais urgente primeiro (P1); empate pela idade no status.
                { priority: dir === 'desc' ? ('asc' as const) : ('desc' as const) }
              : { [sort]: dir };
  if (sort === 'priority')
    return [primary, { statusChangedAt: 'asc' as const }, { id: 'asc' as const }];
  return [primary, { id: 'asc' as const }];
}

/** Tamanho maximo de um link enviado (item 163); acima disso nao e um link de verdade. */
export const URL_MAX = 2048;

export const UrlSchema = z.object({
  // So http/https (item 163): javascript:, ftp: e afins nao sao links a analisar.
  url: z.url({ protocol: /^https?$/ }).max(URL_MAX),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  tags: z.string().optional(),
});

/** Resolucao para quem enviou: curta, para leigos (item 87). */
const RESOLUTION_MAX = 500;
/** Vazio ou null remove. */
const ResolutionField = z
  .string()
  .trim()
  .max(RESOLUTION_MAX)
  .transform((v) => v || null)
  .nullable()
  .optional();

const PatchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
  verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  /** Analista responsavel (id) ou null para remover a atribuicao. */
  assigneeId: z.string().min(1).nullable().optional(),
  /** Resolucao para quem enviou (item 87). */
  resolution: ResolutionField,
});

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
export function listWhere(
  filters: Pick<
    z.infer<typeof ListQuery>,
    | 'scope'
    | 'type'
    | 'status'
    | 'verdict'
    | 'priority'
    | 'attack'
    | 'q'
    | 'sha256'
    | 'assignee'
    | 'age'
    | 'submittedFrom'
    | 'completedFrom'
  >,
  userId: string,
): Prisma.EntryWhereInput {
  const {
    scope,
    type,
    status,
    verdict,
    priority,
    attack,
    q,
    sha256,
    assignee,
    age,
    submittedFrom,
    completedFrom,
  } = filters;
  const where: Prisma.EntryWhereInput = {};
  if (scope === 'mine') where.ownerId = userId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (verdict) where.verdict = verdict;
  if (priority) where.priority = priority;
  if (attack) {
    where.reports = {
      some: { status: 'PUBLISHED', attackTechniques: { hasSome: withSubtechniques(attack) } },
    };
  }
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
    // Prazo da propria prioridade (P1 atrasa antes de P4).
    where.AND = [slaWhere(age)];
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
  data: {
    status?: EntryStatus;
    verdict?: Verdict;
    priority?: Priority;
    resolution?: string | null;
  },
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
  if (data.resolution !== undefined && data.resolution !== entry.resolution) {
    await recordResolution(tx, entry, result.status, actorId, data.resolution);
  }
  if (data.priority && data.priority !== entry.priority) {
    await recordEvent(tx, {
      entryId: entry.id,
      actorId,
      type: 'PRIORITY_CHANGED',
      fromValue: entry.priority,
      toValue: data.priority,
    });
  }
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

/**
 * Resolucao para quem enviou (item 87): historico, as duplicatas herdam e quem
 * enviou e avisado se a amostra ja estava concluida (na conclusao, o aviso de
 * concluida ja mostra a resolucao).
 */
async function recordResolution(
  tx: Tx,
  entry: { id: string; ownerId: string; status: EntryStatus },
  statusAfter: EntryStatus,
  actorId: string,
  resolution: string | null,
) {
  await recordEvent(tx, {
    entryId: entry.id,
    actorId,
    type: 'RESOLUTION_SET',
    toValue: resolution,
  });
  // "<> texto" no SQL nao pega as que ainda nao tem resolucao (null).
  const targets = await tx.entry.findMany({
    where: {
      duplicateOfId: entry.id,
      OR: resolution
        ? [{ resolution: null }, { resolution: { not: resolution } }]
        : [{ resolution: { not: null } }],
    },
    select: { id: true, ownerId: true },
  });
  if (targets.length) {
    await tx.entry.updateMany({
      where: { id: { in: targets.map((d) => d.id) } },
      data: { resolution },
    });
    for (const dup of targets) {
      await recordEvent(tx, {
        entryId: dup.id,
        actorId,
        type: 'RESOLUTION_SET',
        toValue: resolution,
        detail: 'principal',
      });
    }
  }
  if (!resolution) return;
  const owners = [
    ...(entry.status === 'COMPLETED' && statusAfter === 'COMPLETED' ? [entry] : []),
    // Duplicatas ja nascem concluidas.
    ...targets,
  ];
  await notify(
    tx,
    owners.map((o) => ({
      userId: o.ownerId,
      type: 'RESOLUTION' as const,
      entryId: o.id,
      actorId,
      detail: resolution,
    })),
  );
}

/** Atualizacao em massa: ate 100 amostras, so campos de triagem. */
const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  patch: z
    .object({
      status: z.enum(['PENDING', 'IN_REVIEW', 'COMPLETED']).optional(),
      verdict: z.enum(['UNKNOWN', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS']).optional(),
      priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
      assigneeId: z.string().min(1).nullable().optional(),
      resolution: ResolutionField,
    })
    .strict()
    .refine((p) => Object.keys(p).length > 0, 'Nada para atualizar.'),
});

/** Limite de linhas da exportacao CSV. */
const EXPORT_MAX_ROWS = 10_000;

// Rotulos do CSV, em portugues e em ingles (plano pos-revisao, item 1.4): o link manda ?lang=.
const PRIORITY_LABELS = {
  P1: ['P1 Crítica', 'P1 Critical'],
  P2: ['P2 Alta', 'P2 High'],
  P3: ['P3 Média', 'P3 Medium'],
  P4: ['P4 Baixa', 'P4 Low'],
} as const;
const STATUS_LABELS = {
  PENDING: ['Pendente', 'Pending'],
  IN_REVIEW: ['Em análise', 'In analysis'],
  COMPLETED: ['Concluído', 'Completed'],
} as const;
const VERDICT_LABELS = {
  UNKNOWN: ['Desconhecido', 'Unknown'],
  CLEAN: ['Limpo', 'Clean'],
  SUSPICIOUS: ['Suspeito', 'Suspicious'],
  MALICIOUS: ['Malicioso', 'Malicious'],
} as const;
const CSV_HEADER = {
  pt: [
    'ID',
    'Amostra',
    'Tipo',
    'Enviado por',
    'Responsável',
    'Prioridade',
    'Status',
    'Veredito',
    'Resolução',
    'Relatórios',
    'SHA-256',
    'URL',
    'Tags',
    'Enviado em',
    'No status desde',
  ],
  en: [
    'ID',
    'Sample',
    'Type',
    'Submitted by',
    'Assignee',
    'Priority',
    'Status',
    'Verdict',
    'Resolution',
    'Reports',
    'SHA-256',
    'URL',
    'Tags',
    'Submitted at',
    'In status since',
  ],
};

/**
 * Etapas da revisao de relatorio: nota do revisor e veredito de rascunho, que a rota de
 * relatorios so mostra a analistas. A falha do sandbox traz erro do Proxmox, e a regra de
 * triagem, o nome que os analistas deram a ela.
 */
const ANALYST_ONLY_EVENTS = [
  'REPORT_CREATED',
  'REPORT_SUBMITTED',
  'REPORT_RETURNED',
  'REPORT_APPROVED',
  'SANDBOX_FAILED',
  // Nome da regra de triagem: configuracao dos analistas (item 163). As tags ficam na amostra.
  'TRIAGE_RULE',
] as const;

/** Com a restricao ligada, a principal de outra pessoa nao aparece no historico (item 140). */
async function eventsForViewer<
  T extends { type: string; toValue: string | null; detail: string | null },
>(events: T[], user: PublicUser): Promise<T[]> {
  const { ownerId } = await visibleEntries(user);
  if (!ownerId) return events;
  const isLink = (e: T) => e.type === 'MARKED_DUPLICATE' || e.type === 'UNMARKED_DUPLICATE';
  const own = new Set(
    (
      await prisma.entry.findMany({
        where: { id: { in: events.filter(isLink).map((e) => e.detail ?? '') }, ownerId },
        select: { id: true },
      })
    ).map((e) => e.id),
  );
  return events.map((e) =>
    isLink(e) && !own.has(e.detail ?? '') ? { ...e, toValue: null, detail: null } : e,
  );
}

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

const busy = (reply: FastifyReply) =>
  reply
    .code(503)
    .header('Retry-After', '30')
    .send({ error: 'Muitos envios ao mesmo tempo. Tente de novo em instantes.' });

/**
 * Le o multipart (um arquivo e os campos). Em erro ja responde e devolve null.
 *
 * O corpo vai para o disco enquanto chega (revisao de novembro, 2.3); so depois de inteiro ele
 * entra na memoria, com a reserva feita pelo tamanho real. Enquanto chega, o que limita e o
 * orcamento de disco (pelo tamanho declarado) e a parte dele que cabe a cada pessoa.
 */
async function readUpload(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<Upload | null> {
  // Item 117: antes de ler. Sem Content-Length, conta como o maior envio possivel.
  const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers['content-length']) || limit;
  // Folga para os campos e separadores do formulario.
  if (declared > limit + 1024 * 1024) {
    reply.code(413).send({ error: `Arquivo maior que o limite de ${env.MAX_UPLOAD_MB} MB.` });
    return null;
  }
  const leave = enterUpload(userId, declared);
  if (!leave) {
    reply.code(429).header('Retry-After', '30').send({
      error: 'Você tem envios grandes demais em andamento. Aguarde um deles terminar.',
    });
    return null;
  }
  // Tudo o que foi reservado e devolvido quando a resposta termina ou a conexao cai.
  const cleanup: (() => void | Promise<void>)[] = [leave];
  const done = () => {
    for (const fn of cleanup.splice(0)) void Promise.resolve(fn()).catch(() => undefined);
  };
  reply.raw.once('finish', done);
  reply.raw.once('close', done);

  const disk = spoolGate.tryAcquire(declared);
  if (!disk) {
    busy(reply);
    return null;
  }
  cleanup.push(disk);

  let spooled: Awaited<ReturnType<typeof spoolToDisk>> | null = null;
  let filename = 'arquivo';
  let mimetype = 'application/octet-stream';
  const fields: Record<string, string> = {};

  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
        spooled = await spoolToDisk(part.file);
        cleanup.push(spooled.remove);
        // Passou do limite: o multipart corta o fluxo e marca (o toBuffer de antes lancava).
        if (part.file.truncated) {
          await spooled.remove();
          reply.code(413).send({ error: `Arquivo maior que o limite de ${env.MAX_UPLOAD_MB} MB.` });
          return null;
        }
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

  if (!spooled) {
    reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
    return null;
  }
  // O corpo ja chegou inteiro: espera a vez da memoria em vez de mandar a pessoa enviar de novo.
  const memory = await uploadGate.acquire(spooled.size, uploadLimits.waitMs);
  if (!memory) {
    // Apagado antes de responder: o envio recusado nao ocupa disco nem por um instante a mais.
    await spooled.remove();
    busy(reply);
    return null;
  }
  cleanup.push(memory);
  let buffer: Buffer;
  try {
    buffer = await spooled.read();
  } catch (err) {
    req.log.error(err);
    reply.code(500).send({ error: 'Falha ao ler o arquivo enviado.' });
    return null;
  }
  // Em memoria, o disco ja pode ser devolvido para os envios que estao chegando.
  await spooled.remove();
  disk();
  return { buffer, filename, mimetype, fields };
}

/**
 * Grava o arquivo no MinIO e cria a amostra (envio unico, lote e .zip). Devolve
 * tambem a primeira amostra ja enviada com o mesmo SHA-256, se houver.
 */
/** Primeiro envio do mesmo arquivo que a pessoa pode ver ("ja enviada antes"). */
async function previousSubmission(entry: { id: string; sha256: string | null }, user: PublicUser) {
  return prisma.entry.findFirst({
    where: { sha256: entry.sha256, id: { not: entry.id }, ...(await visibleEntries(user)) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true },
  });
}

/** Arquivos extraidos por vez de uma imagem de disco (item 84). */
const EXTRACT_MAX_FILES = 50;

export async function entryRoutes(app: FastifyInstance) {
  // Imagem de disco (item 84): extrai os arquivos como amostras filhas (analistas).
  app.post('/api/entries/:id/extract-image', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas extraem arquivos.' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        type: true,
        ownerId: true,
        storageKey: true,
        bucket: true,
        filePurgedAt: true,
        tags: { select: { id: true } },
      },
    });
    if (!entry || entry.type !== 'FILE')
      return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (entry.filePurgedAt || !entry.storageKey) {
      return reply.code(410).send({ error: 'O arquivo foi expurgado pela política de retenção.' });
    }
    if (await prisma.entry.count({ where: { parentEntryId: id } })) {
      return reply.code(409).send({ error: 'Os arquivos desta imagem já foram extraídos.' });
    }
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
    );
    const buffer = Buffer.from(await obj.Body!.transformToByteArray());
    // Listar a imagem roda na thread de analise (item 163): imagem hostil nao trava a API.
    const image = await diskImageInThread(buffer).catch(() => null);
    if (!image || !image.files.length) {
      return reply
        .code(400)
        .send({ error: 'Não é uma imagem de disco com arquivos que o DeepLook consiga listar.' });
    }
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    const skipped: { path: string; reason: string }[] = [];
    const children: { id: string; title: string }[] = [];
    for (const file of image.files) {
      if (children.length >= EXTRACT_MAX_FILES) {
        skipped.push({
          path: file.path,
          reason: `limite de ${EXTRACT_MAX_FILES} arquivos por vez`,
        });
        continue;
      }
      if (file.size > maxBytes) {
        skipped.push({ path: file.path, reason: `maior que ${env.MAX_UPLOAD_MB} MB` });
        continue;
      }
      const data = extractDiskFile(buffer, file, maxBytes);
      if (!data) {
        skipped.push({ path: file.path, reason: 'não foi possível ler os bytes' });
        continue;
      }
      const filename = file.path.split('/').pop() || 'arquivo';
      // A filha e do mesmo dono da imagem (aparece nos Meus Uploads de quem enviou).
      const { entry: child } = await createFileEntry(
        req,
        entry.ownerId,
        {
          buffer: data,
          filename,
          mimetype: 'application/octet-stream',
          title: file.path.slice(0, 200),
          description: `Extraído da imagem "${entry.title}" (${file.path}).`,
          tags: entry.tags,
          parentEntryId: entry.id,
        },
        { remaining: null },
        1,
      );
      children.push({ id: child.id, title: child.title });
    }
    await recordEvent(prisma, {
      entryId: entry.id,
      actorId: user.id,
      type: 'FILES_EXTRACTED',
      detail: `${children.length} arquivo(s)`,
    });
    return reply.send({ created: children.length, children, skipped });
  });

  // Amostras filhas (anexos de e-mail, arquivos extraidos de imagem).
  app.get('/api/entries/:id/children', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const children = await prisma.entry.findMany({
      where: { parentEntryId: id, ...(await visibleEntries(user)) },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, title: true, originalFilename: true, status: true, verdict: true },
    });
    return reply.send({ children });
  });

  // Exportacao CSV da lista filtrada/ordenada (sem paginacao, ate 10 mil linhas).
  app.get('/api/entries/export.csv', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Parâmetros inválidos.' });

    const items = await prisma.entry.findMany({
      where: { ...listWhere(parsed.data, user.id), ...(await visibleEntries(user)) },
      orderBy: listOrderBy(parsed.data.sort, parsed.data.dir),
      take: EXPORT_MAX_ROWS,
      include: {
        owner: { select: { displayName: true } },
        assignee: { select: { displayName: true } },
        tags: { select: { name: true } },
        _count: { select: { reports: true } },
      },
    });

    const lang = requestLang(req);
    const en = lang === 'en';
    const pick = (pair: readonly [string, string]) => pair[en ? 1 : 0];
    const csv = toCsv(
      en ? CSV_HEADER.en : CSV_HEADER.pt,
      items.map((e) => [
        e.id,
        e.title,
        e.type === 'FILE' ? (en ? 'File' : 'Arquivo') : 'Link',
        e.owner.displayName,
        e.assignee?.displayName ?? '',
        pick(PRIORITY_LABELS[e.priority]),
        pick(STATUS_LABELS[e.status]),
        pick(VERDICT_LABELS[e.verdict]),
        e.resolution,
        e._count.reports,
        e.sha256,
        e.url,
        e.tags.map((t) => t.name).join(', '),
        e.createdAt,
        e.statusChangedAt,
      ]),
      csvSeparator(lang),
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
    if (!parsed.success) return reply.code(400).send({ error: 'Parâmetros inválidos.' });
    const { limit, offset, sort, dir } = parsed.data;

    const where = { ...listWhere(parsed.data, user.id), ...(await visibleEntries(user)) };

    const [total, items] = await Promise.all([
      prisma.entry.count({ where }),
      prisma.entry.findMany({
        where,
        orderBy: listOrderBy(sort, dir),
        skip: offset,
        take: limit,
        omit: { staticInfo: true, emailInfo: true },
        include: {
          owner: { select: { id: true, displayName: true, email: true } },
          assignee: { select: { id: true, displayName: true } },
          tags: true,
          _count: { select: { reports: true } },
        },
      }),
    ]);

    return reply.send({
      total,
      limit,
      offset,
      items: (await linksForViewer(items, user)).map((e) => ownerForViewer(e, user)),
      sla: slaConfig(),
    });
  });

  // Submissao de ARQUIVO (multipart)
  // Contadores das filas do Navegador do Sistema (Pendentes, Em analise...).
  // Rota estatica: o find-my-way a prioriza sobre /api/entries/:id.
  app.get('/api/entries/counts', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const visible = await visibleEntries(user);
    const [groups, mine, late, reviews] = await Promise.all([
      prisma.entry.groupBy({ by: ['status'], where: visible, _count: { _all: true } }),
      // Fila "Atribuidas a mim": so as que ainda nao foram concluidas.
      prisma.entry.count({
        where: { ...visible, assigneeId: user.id, status: { not: 'COMPLETED' } },
      }),
      // Fila "Atrasadas": nao concluidas ha mais de SLA_LATE_HOURS no status atual.
      prisma.entry.count({
        where: { ...slaWhere('late'), ...visible },
      }),
      // Fila "Relatorios para revisar": em revisao, de outros analistas.
      prisma.report.count({
        where: {
          status: 'IN_REVIEW',
          analystId: { not: user.id },
          entry: { deletedAt: null, ...visible },
        },
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
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });

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
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (entry.type === 'FILE' && entry.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if (entry.type !== 'FILE' || !entry.storageKey) {
      return reply.code(400).send({ error: 'Só arquivos têm análise estática.' });
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
    let staticInfo: StaticInfo;
    try {
      staticInfo = await analyzeInThread(buffer, entry.originalFilename);
    } catch (err) {
      req.log.warn({ err }, 'Falha na analise estatica');
      return reply.code(422).send({ error: 'Não foi possível analisar este arquivo.' });
    }
    await rememberUrls(prisma, staticInfo.iocCandidates);
    await prisma.entry.update({
      where: { id },
      data: {
        staticInfo: staticInfo as unknown as Prisma.InputJsonValue,
        ...relationHashes(staticInfo.pe),
      },
    });
    await replacePivots(prisma, id, 'static', staticPivots(staticInfo));
    await scanLookalikesQuietly(id);
    // A analise nova pode casar regras de triagem do executavel (item 7.4).
    await applyTriageRules(id).catch((err: unknown) =>
      req.log.error({ err }, 'Falha nas regras de triagem'),
    );
    return reply.send({ staticInfo: localizeStaticInfo(staticInfo, requestLang(req)) });
  });

  // Historico (auditoria) da amostra: quem fez o que e quando.
  app.get('/api/entries/:id/events', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const analyst = isAnalyst(user);
    const events = await prisma.entryEvent.findMany({
      where: {
        entryId: id,
        // Usuario comum nao ve o historico de amostra na lixeira (a ficha ja da 404);
        // a extensao do Prisma so filtra Entry, nao EntryEvent (item: vazamento lixeira).
        ...(analyst
          ? {}
          : { type: { notIn: [...ANALYST_ONLY_EVENTS] }, entry: { deletedAt: null } }),
      },
      // Eventos da mesma transacao podem ter o mesmo milissegundo: o id (cuid,
      // crescente) desempata na ordem em que foram gravados.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, displayName: true } } },
    });
    // Detalhe do sistema no idioma de quem pede (plano pos-revisao, item 1.4).
    return reply.send({
      events: localizeEntryEvents(await eventsForViewer(events, user), requestLang(req)),
    });
  });

  /** Cota de envio esgotada (item 64): 429 com a espera; devolve as vagas restantes. */
  const checkQuota = async (user: PublicUser, reply: FastifyReply) => {
    const quota = await uploadQuota(user);
    if (quota.remaining === 0) {
      reply.code(429).send({ error: quotaMessage(quota), resetAt: quota.resetAt });
      return null;
    }
    return quota;
  };
  /** A cota acabou durante o envio: mesma resposta da conferencia na entrada. */
  const quotaRefused = async (user: PublicUser, reply: FastifyReply) => {
    const quota = await uploadQuota(user);
    return reply.code(429).send({ error: quotaMessage(quota), resetAt: quota.resetAt });
  };

  app.post('/api/entries/file', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const quota = await checkQuota(user, reply);
    if (!quota) return;
    const upload = await readUpload(req, reply, user.id);
    if (!upload) return;

    try {
      const { entry } = await createFileEntry(
        req,
        user.id,
        {
          buffer: upload.buffer,
          filename: upload.filename,
          mimetype: upload.mimetype,
          title: upload.fields.title || upload.filename,
          description: upload.fields.description || null,
          tags: await resolveTags(parseTags(upload.fields.tags)),
        },
        { remaining: quota.remaining },
      );
      return await reply.code(201).send({ entry, previous: await previousSubmission(entry, user) });
    } catch (err) {
      if (!(err instanceof QuotaExceeded)) throw err;
      return quotaRefused(user, reply);
    }
  });

  // Envio em lote por .zip (ex.: pacote de malware com a senha "infected"):
  // cada arquivo de dentro vira uma amostra, com a mesma descricao e as mesmas
  // tags. O pacote e aberto so na memoria, nunca no disco nem executado.
  // Entrada que falha nao gasta cota, mas custa a descompactacao: pacotes por sessao
  // tambem tem limite.
  const zipLimit = attemptLimit(sessionKey('zip'), { max: 20 });
  app.post('/api/entries/zip', { config: zipLimit }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const quota = await checkQuota(user, reply);
    if (!quota) return;
    const upload = await readUpload(req, reply, user.id);
    if (!upload) return;

    const password = upload.fields.password ?? '';
    if (password.length > 200) {
      return reply
        .code(400)
        .send({ error: 'Dados inválidos.', details: { password: ['máximo de 200 caracteres'] } });
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
    // Tentativas e bytes contam mesmo se a extracao falhar: quem falha tambem custa,
    // e o pacote nao pode ficar descompactando entrada ruim sem parar.
    let attempts = 0;
    let total = 0;
    let passwordError: string | null = null;

    // Vagas da cota: cada arquivo (e cada anexo de um .eml de dentro) gasta uma.
    const left = { remaining: quota.remaining };
    for (const file of files) {
      // Cota do usuario comum: o resto do pacote fica de fora (cada arquivo conta).
      if (left.remaining !== null && left.remaining <= 0) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: `cota de ${quota.limit} envios em 24 horas atingida`,
        });
        continue;
      }
      if (attempts >= ZIP_MAX_FILES) {
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
      const cost = Math.max(file.size, file.compressedSize);
      if (total + cost > ZIP_MAX_TOTAL_BYTES()) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: 'limite total do pacote atingido',
        });
        continue;
      }
      attempts += 1;
      total += cost;
      let buffer: Buffer;
      try {
        buffer = await extractZipEntryAsync(upload.buffer, file, password, ZIP_MAX_FILE_BYTES());
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        if (err.code === 'BAD_PASSWORD') passwordError ??= err.message;
        skipped.push({ name: file.name, path: file.path, reason: err.message });
        continue;
      }
      const origin = `Extraído de ${upload.filename}${file.path !== file.name ? ` (${file.path})` : ''}.`;
      let entry;
      try {
        ({ entry } = await createFileEntry(
          req,
          user.id,
          {
            buffer,
            filename: file.name,
            mimetype: 'application/octet-stream',
            title: file.name,
            description: base ? `${base}\n\n${origin}` : origin,
            tags,
          },
          left,
        ));
      } catch (err) {
        if (!(err instanceof QuotaExceeded)) throw err;
        left.remaining = 0;
        skipped.push({
          name: file.name,
          path: file.path,
          reason: `cota de ${quota.limit} envios em 24 horas atingida`,
        });
        continue;
      }
      created.push({
        name: file.name,
        path: file.path,
        entry: { id: entry.id, title: entry.title, sha256: entry.sha256, fileSize: entry.fileSize },
        previous: await previousSubmission(entry, user),
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
    if (!(await checkQuota(user, reply))) return;
    const { url, title, description, tags: tagRaw } = parsed.data;

    const tags = await resolveTags(parseTags(tagRaw));
    let entry;
    try {
      entry = await createUrlEntry(
        req,
        { id: user.id, analyst: isAnalyst(user) },
        { url, title, description, tags },
      );
    } catch (err) {
      if (!(err instanceof QuotaExceeded)) throw err;
      return quotaRefused(user, reply);
    }
    return reply.code(201).send({ entry });
  });

  // Detalhe de uma amostra
  app.get('/api/entries/:id', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const visible = await visibleEntries(user);
    const found = await prisma.entry.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        assignee: { select: { id: true, displayName: true } },
        tags: true,
        duplicateOf: { select: { id: true, title: true, ownerId: true } },
        parentEntry: { select: { id: true, title: true, originalFilename: true, ownerId: true } },
        duplicates: {
          where: { deletedAt: null, ...visible },
          select: { id: true, title: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: { select: { duplicates: { where: { deletedAt: null, ...visible } } } },
        lookalikeHits: {
          select: { domain: true, companyDomain: true, reason: true, detail: true, sources: true },
          orderBy: { domain: 'asc' },
        },
        // Rascunhos e relatorios em revisao so para analistas.
        reports: {
          where: isAnalyst(user) ? {} : { status: 'PUBLISHED' },
          orderBy: { createdAt: 'desc' },
          include: {
            analyst: { select: { id: true, displayName: true, role: true } },
            reviewedBy: { select: { id: true, displayName: true } },
            kbArticles: { select: { id: true, title: true }, orderBy: { title: 'asc' } },
          },
        },
      },
    });
    if (!found) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    // Principal e pacote de origem de outra pessoa ficam de fora (item 140).
    const linked = <T extends { ownerId: string }>(other: T | null) => {
      if (!other || (visible.ownerId && other.ownerId !== visible.ownerId)) return null;
      const { ownerId: _owner, ...rest } = other;
      return rest;
    };
    const [withLinks] = await linksForViewer([found], user);
    const entry = {
      ...withLinks,
      // Alertas e motivos da analise no idioma de quem pede (plano pos-revisao, item 1.4).
      // Credencial dos canais de exfiltracao so inteira para analistas (item 3).
      staticInfo: await scrubForViewer(
        id,
        isAnalyst(user),
        localizeStaticInfo(withLinks.staticInfo, requestLang(req)),
      ),
      duplicateOf: linked(found.duplicateOf),
      parentEntry: linked(found.parentEntry),
    };
    return reply.send({
      entry: ownerForViewer(entry, user),
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
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });

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
    if (data.status !== undefined || data.verdict !== undefined || data.priority !== undefined) {
      if (!canTriage) {
        return reply
          .code(403)
          .send({ error: 'Somente analistas podem alterar status, veredito ou prioridade.' });
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.verdict !== undefined) updateData.verdict = data.verdict;
      if (data.priority !== undefined) updateData.priority = data.priority;
    }
    if (data.resolution !== undefined) {
      if (!canTriage) {
        return reply
          .code(403)
          .send({ error: 'Somente analistas escrevem a resolução para quem enviou.' });
      }
      updateData.resolution = data.resolution;
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
    const [withLinks] = await linksForViewer([updated], user);
    return reply.send({ entry: ownerForViewer(withLinks, user) });
  });

  // "Pegar a proxima" (Next in queue): atribui ao analista a pendente sem
  // responsavel mais antiga no status (as atrasadas primeiro) e a poe Em analise.
  // A atualizacao so vale se ela ainda estiver livre: dois cliques ao mesmo tempo
  // nunca pegam a mesma; quem perder a corrida tenta a seguinte.
  app.post('/api/entries/next', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pegam amostras da fila.' });
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = await prisma.entry.findFirst({
        where: { status: 'PENDING', assigneeId: null, duplicateOfId: null },
        // Mais urgente primeiro (P1), depois ha mais tempo no status.
        orderBy: [
          { priority: 'asc' },
          { statusChangedAt: 'asc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        select: { id: true, title: true, status: true, verdict: true },
      });
      if (!candidate) {
        return reply.code(404).send({ error: 'Nenhuma amostra pendente sem responsável.' });
      }
      const claimed = await prisma.$transaction(async (tx) => {
        const { count } = await tx.entry.updateMany({
          where: { id: candidate.id, status: 'PENDING', assigneeId: null },
          data: { assigneeId: user.id, status: 'IN_REVIEW' },
        });
        if (!count) return false;
        await recordTriageChanges(tx, candidate.id, user.id, candidate, { status: 'IN_REVIEW' });
        await recordEvent(tx, {
          entryId: candidate.id,
          actorId: user.id,
          type: 'ASSIGNED',
          fromValue: null,
          toValue: user.displayName,
        });
        return true;
      });
      if (claimed) return reply.send({ entry: { id: candidate.id, title: candidate.title } });
    }
    return reply
      .code(409)
      .send({ error: 'Outros analistas pegaram as amostras ao mesmo tempo. Tente de novo.' });
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
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos.' });
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
        if (patch.priority !== undefined) updateData.priority = patch.priority;
        if (patch.resolution === undefined) {
          await applyTriage(tx, entry, user.id, patch, updateData, newAssignee);
          continue;
        }
        updateData.resolution = patch.resolution;
        // A principal marcada junto ja passou a resolucao para a duplicata: sem reler,
        // quem enviou a duplicata receberia dois avisos.
        const { resolution } = await tx.entry.findUniqueOrThrow({
          where: { id: entry.id },
          select: { resolution: true },
        });
        await applyTriage(tx, { ...entry, resolution }, user.id, patch, updateData, newAssignee);
      }
    });

    const found = new Set(entries.map((e) => e.id));
    return reply.send({
      updated: entries.length,
      notFound: ids.filter((id) => !found.has(id)),
    });
  });

  // Download do arquivo (autenticado; objetos nunca ficam publicos no MinIO).
  // ?format=zip (plano pos-revisao, item 2.1): dentro de um ZIP com a senha "infected", que e o
  // que a interface pede. Sem `format`, o arquivo cru, como antes (links antigos). Token de API
  // nao baixa amostra (lib/api-tokens.ts): so o navegador chega aqui.
  const DownloadQuery = z.object({ format: z.enum(['raw', 'zip']).default('raw') });
  app.get('/api/entries/:id/download', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const query = DownloadQuery.safeParse(req.query);
    if (!query.success) return sendValidationError(reply, query.error);
    const zip = query.data.format === 'zip';
    const entry = await prisma.entry.findUnique({ where: { id } });
    // So quem enviou e os analistas (item 122); a resposta nao revela o estado do arquivo.
    if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
      return reply
        .code(403)
        .send({ error: 'Somente quem enviou e os analistas baixam a amostra.' });
    }
    if (entry && entry.type === 'FILE' && entry.filePurgedAt) {
      return reply
        .code(410)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if (!entry || entry.type !== 'FILE' || !entry.storageKey) {
      return reply.code(404).send({ error: 'Arquivo não encontrado.' });
    }

    const obj = await s3
      .send(new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }))
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
      detail: [
        entry.sha256 ? `SHA-256 ${entry.sha256}` : null,
        zip ? `ZIP com senha (${SAMPLE_ZIP_PASSWORD})` : 'arquivo original',
      ]
        .filter(Boolean)
        .join(' · '),
    });

    const safeName = (entry.originalFilename || 'sample.bin').replace(/[^\w.-]+/g, '_');
    // Sempre octet-stream: o mimeType gravado veio do navegador de quem enviou (pode dizer
    // text/html ou image/svg+xml), e a amostra e maliciosa por definicao. Com nosniff e o
    // sandbox, nenhum navegador interpreta o conteudo, mesmo chamado direto na API (sem o nginx).
    reply.header('Content-Type', zip ? 'application/zip' : 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `attachment; filename="${safeName}${zip ? '.zip' : ''}"`);
    // O tamanho do objeto de verdade, e nao o da ficha: se os dois divergirem, o corpo
    // continua bem formado para o cliente e a divergencia aparece na conferencia abaixo.
    const length = obj.ContentLength ?? entry.fileSize;

    const body = obj.Body as Readable;
    // O ZIP vai depois da conferencia: o SHA-256 e o tamanho sao dos bytes originais. Sem o
    // tamanho exato (nao acontece com o MinIO) nao da para montar o ZIP em fluxo.
    let packed: ReturnType<typeof sampleZipStream> | null = null;
    if (zip) {
      if (length == null) {
        body.destroy();
        return reply
          .code(502)
          .send({ error: 'O armazenamento não informou o tamanho do arquivo.' });
      }
      packed = sampleZipStream({ name: zipEntryName(entry.originalFilename), size: length });
      reply.header('Content-Length', String(packed.length));
      reply.header('X-DeepLook-Zip-Password', SAMPLE_ZIP_PASSWORD);
    } else if (length) {
      reply.header('Content-Length', String(length));
    }
    const onBroken = (err: Error | null) => {
      if (err) req.log.warn({ err }, '[download] interrompido');
    };

    // Amostra sem hash gravado nao tem com o que comparar.
    if (!entry.sha256) {
      return reply.send(packed ? pipeline(body, packed.stream, onBroken) : body);
    }

    // Integridade (item 4.2): confere o SHA-256 e o tamanho enquanto os bytes passam, sem ler
    // duas vezes. O arquivo e entregue de qualquer jeito (recusar tiraria do analista a unica
    // copia que resta); a divergencia vai para a Auditoria, marca a amostra e a ficha avisa.
    // Download abortado no meio nao tem veredito. Se ja estava marcada, os seguintes saem com
    // o cabecalho abaixo.
    if (entry.integrityFailedAt) reply.header('X-DeepLook-Integrity', 'mismatch');
    const target = {
      id: entry.id,
      title: entry.title,
      ownerId: entry.ownerId,
      sha256: entry.sha256,
      fileSize: entry.fileSize,
    };
    const hashing = hashingStream((read) =>
      recordIntegrity(target, judge(target, read), {
        via: 'download',
        actorId: user.id,
        req,
      }),
    );
    const onChecked = (err: Error | null) => {
      if (err) req.log.warn({ err }, '[integridade] download interrompido: sem conferencia');
    };
    const checked = packed
      ? pipeline(body, hashing, packed.stream, onChecked)
      : pipeline(body, hashing, onChecked);
    return reply.send(checked);
  });
}
