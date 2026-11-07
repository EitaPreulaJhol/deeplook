import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { audit } from '../lib/audit';
import { requireAdmin } from '../lib/auth';
import {
  backupFilePath,
  checkBackupDir,
  deleteBackupObject,
  expireBackups,
  inBucket,
  runBackup,
} from '../lib/backup';
import { advisoryLock, prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';
import { sendValidationError } from '../lib/validation';

const BACKUP_LOCK = 880_002;
/** Senha do ZIP ou a escolha explicita de exportar sem ela (item 116). */
const CreateSchema = z
  .object({
    includeSamples: z.boolean().default(false),
    password: z.string().min(12, 'use 12 caracteres ou mais').max(200).optional(),
    noPassword: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.noPassword !== Boolean(b.password), {
    path: ['password'],
    message: 'informe a senha ou marque a exportação sem senha',
  });

const select = {
  id: true,
  status: true,
  includeSamples: true,
  encrypted: true,
  step: true,
  progress: true,
  size: true,
  manifest: true,
  error: true,
  createdAt: true,
  finishedAt: true,
  expiresAt: true,
  createdBy: { select: { id: true, displayName: true } },
} as const;

/** BigInt nao vai em JSON: o tamanho segue como numero. */
const out = <T extends { size: bigint | null }>(b: T) => ({
  ...b,
  size: b.size === null ? null : Number(b.size),
});

/** Para os testes: espera o backup em segundo plano terminar. */
export let lastRun: Promise<void> = Promise.resolve();

/**
 * Backup em ZIP para baixar (item 81), so admin e so pelo navegador (as rotas
 * nao aceitam token): gerar (um por vez), acompanhar, baixar e excluir.
 */
export async function backupRoutes(app: FastifyInstance) {
  app.get('/api/admin/backups', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    await expireBackups();
    const items = await prisma.backup.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select,
    });
    // Onde os proximos ZIPs vao parar (item 6.13) e, na pasta, o que impede de gravar.
    const dir = env.BACKUP_DIR ? await checkBackupDir() : null;
    return reply.send({
      items: items.map(out),
      retentionDays: env.BACKUP_RETENTION_DAYS,
      destination: env.BACKUP_DIR ? 'dir' : 'bucket',
      destinationProblem: dir && !dir.ok ? dir.error : null,
    });
  });

  app.post('/api/admin/backups', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = CreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const backup = await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, BACKUP_LOCK);
      if (await tx.backup.count({ where: { status: 'RUNNING' } })) return null;
      const created = await tx.backup.create({
        data: {
          includeSamples: parsed.data.includeSamples,
          encrypted: Boolean(parsed.data.password),
          step: 'Na fila...',
          createdById: user.id,
        },
        select,
      });
      await audit(tx, req, {
        action: 'BACKUP_CREATED',
        actorId: user.id,
        targetLabel: created.id,
        detail: [
          parsed.data.includeSamples ? 'com os arquivos das amostras' : 'sem as amostras',
          parsed.data.password ? 'com senha' : 'sem senha',
        ].join(' · '),
      });
      return created;
    });
    if (!backup) {
      return reply.code(409).send({ error: 'Já há um backup em andamento. Aguarde terminar.' });
    }
    lastRun = runBackup(backup.id, parsed.data.password ?? null).catch((err: unknown) =>
      req.log.error({ err }, '[backup] falha inesperada'),
    );
    return reply.code(202).send({ item: out(backup) });
  });

  app.get('/api/admin/backups/:id/download', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const backup = await prisma.backup.findUnique({ where: { id } });
    if (!backup || backup.status !== 'READY' || !backup.key) {
      return reply
        .code(404)
        .send({ error: 'Backup não disponível (vencido, excluído ou não terminou).' });
    }
    if (backup.expiresAt && backup.expiresAt <= new Date()) {
      await expireBackups();
      return reply.code(410).send({ error: 'Backup vencido.' });
    }
    // Na pasta (item 6.13) ou no bucket (antes dele, ou sem BACKUP_DIR).
    let body: Readable;
    let length: number | undefined;
    if (inBucket(backup.key)) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: backup.key }));
      body = obj.Body as Readable;
      length = obj.ContentLength;
    } else {
      const file = env.BACKUP_DIR ? backupFilePath(backup.key) : null;
      const found = file ? await stat(file).catch(() => null) : null;
      if (!file || !found?.isFile()) {
        return reply.code(404).send({
          error:
            'O arquivo do backup não está na pasta de backup (BACKUP_DIR): o disco pode estar ' +
            'desmontado, ou o arquivo foi movido ou apagado fora do DeepLook.',
        });
      }
      body = createReadStream(file);
      length = found.size;
    }
    await audit(prisma, req, {
      action: 'BACKUP_DOWNLOADED',
      actorId: user.id,
      targetLabel: backup.id,
      detail: backup.includeSamples ? 'com os arquivos das amostras' : 'sem as amostras',
    });
    const day = backup.createdAt.toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/zip')
      .header('content-length', String(backup.size ?? length ?? ''))
      .header(
        'content-disposition',
        `attachment; filename="deeplook-backup-${day}-${backup.id.slice(-6)}.zip"`,
      )
      .header('cache-control', 'no-store')
      .send(body);
  });

  app.delete('/api/admin/backups/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const backup = await prisma.backup.findUnique({ where: { id } });
    if (!backup) return reply.code(404).send({ error: 'Backup não encontrado.' });
    if (backup.status === 'RUNNING') {
      return reply.code(409).send({ error: 'Espere o backup terminar para excluí-lo.' });
    }
    await deleteBackupObject(backup.key);
    await prisma.backup.delete({ where: { id } });
    await audit(prisma, req, { action: 'BACKUP_DELETED', actorId: user.id, targetLabel: id });
    return reply.send({ ok: true });
  });
}
