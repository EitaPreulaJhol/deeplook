import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requireAdmin } from '../lib/auth';
import { dotnetKeysOf } from '../lib/dotnet';
import { recordEvent } from '../lib/events';
import { deleteGhidraProject, deleteGhidraPseudo, queueBsimDeletion } from '../lib/ghidra';
import { jarKeysOf } from '../lib/jar';
import { captureKeysOf } from '../lib/network-capture';
import { prisma } from '../lib/prisma';
import { pydecKeysOf } from '../lib/pydec';
import { deleteStoredFile } from '../lib/retention';
import { activeSessionForEntry } from '../lib/sandbox';
import { artifactKeysOf } from '../lib/sandbox-artifacts';
import { memdumpKeysOf } from '../lib/sandbox-memdump';
import { sendValidationError } from '../lib/validation';
import { deleteEvidenceObjects } from './evidence';

const TrashQuery = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** So amostras que estao na lixeira (o `deletedAt` no where desliga o filtro automatico). */
const inTrash = (id: string) => ({ id, deletedAt: { not: null } });

/**
 * Lixeira (admin): mover uma amostra para a lixeira, listar, restaurar e
 * excluir de vez (arquivo no MinIO + ficha, relatorios, historico...). Tudo
 * entra na auditoria.
 */
export async function trashRoutes(app: FastifyInstance) {
  app.post('/api/entries/:id/trash', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (await activeSessionForEntry(id)) {
      return reply.code(409).send({
        error:
          'Descarte o ambiente isolado (sandbox) desta amostra antes de movê-la para a lixeira.',
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.entry.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id },
      });
      await recordEvent(tx, { entryId: id, actorId: user.id, type: 'TRASHED' });
      await audit(tx, req, {
        action: 'ENTRY_TRASHED',
        actorId: user.id,
        targetLabel: entry.title,
        detail: id,
      });
    });
    return reply.send({ ok: true });
  });

  app.get('/api/admin/trash', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const parsed = TrashQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { q, limit, offset } = parsed.data;
    const text = q ? { contains: q, mode: 'insensitive' as const } : null;
    const where: Prisma.EntryWhereInput = {
      deletedAt: { not: null },
      ...(text ? { OR: [{ title: text }, { sha256: text }, { url: text }] } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.entry.count({ where }),
      prisma.entry.findMany({
        where,
        orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          verdict: true,
          sha256: true,
          url: true,
          fileSize: true,
          filePurgedAt: true,
          createdAt: true,
          deletedAt: true,
          owner: { select: { id: true, displayName: true } },
          deletedBy: { select: { id: true, displayName: true } },
          _count: { select: { reports: true } },
        },
      }),
    ]);
    return reply.send({ total, items });
  });

  app.post('/api/admin/trash/:id/restore', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findFirst({ where: inTrash(id), select: { title: true } });
    if (!entry) return reply.code(404).send({ error: 'A amostra não está na lixeira.' });
    await prisma.$transaction(async (tx) => {
      await tx.entry.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
      await recordEvent(tx, { entryId: id, actorId: user.id, type: 'RESTORED' });
      await audit(tx, req, {
        action: 'ENTRY_RESTORED',
        actorId: user.id,
        targetLabel: entry.title,
        detail: id,
      });
    });
    return reply.send({ ok: true });
  });

  app.delete('/api/admin/trash/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findFirst({
      where: inTrash(id),
      select: { title: true, sha256: true, url: true, storageKey: true, bucket: true },
    });
    if (!entry) return reply.code(404).send({ error: 'A amostra não está na lixeira.' });
    // Imagens de evidencia dos relatorios (item 76) e capturas de pagina (item 80)
    // tambem saem do MinIO.
    const evidence = await prisma.reportEvidence.findMany({
      where: { report: { entryId: id } },
      select: { storageKey: true },
    });
    const captures = await prisma.pageCapture.findMany({
      where: { entryId: id },
      select: { screenshotKey: true, htmlKey: true },
    });
    // Arquivos primeiro: se o MinIO falhar, a ficha continua na lixeira para tentar de novo.
    try {
      await deleteStoredFile(entry);
      // O projeto do Ghidra (item 7.3) tem os bytes da amostra; o pseudo-C completo
      // (plans/ghidra-pseudo-c) fica fora de samples/ e so sai aqui.
      // As assinaturas do BSim (item 23) saem na proxima analise do Ghidra.
      await queueBsimDeletion(id);
      await deleteGhidraProject(id);
      await deleteGhidraPseudo(id);
      await deleteEvidenceObjects([
        ...evidence.map((e) => e.storageKey),
        // Prints do sandbox (revisao 3.7) e o pcap da captura de rede (plano pos-revisao, 5.4).
        ...(await artifactKeysOf(id)),
        // Dumps de memoria do sandbox (plans/novas-analises, item 3).
        ...(await memdumpKeysOf(id)),
        // O fonte descompilado do .NET (plans/caca-e-formatos, item 3).
        ...(await dotnetKeysOf(id)),
        // O fonte Java descompilado (CFR).
        ...(await jarKeysOf(id)),
        // O fonte Python descompilado (pycdc).
        ...(await pydecKeysOf(id)),
        ...(await captureKeysOf(id)),
        ...captures
          .flatMap((c) => [c.screenshotKey, c.htmlKey])
          .filter((k): k is string => Boolean(k)),
      ]);
    } catch (err) {
      req.log.error({ err }, 'Falha ao apagar o arquivo no MinIO');
      return reply
        .code(502)
        .send({ error: 'Não foi possível apagar o arquivo no armazenamento. Tente de novo.' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.entry.delete({ where: { id } });
      await audit(tx, req, {
        action: 'ENTRY_DELETED',
        actorId: user.id,
        targetLabel: entry.title,
        detail: entry.sha256 ? `SHA-256 ${entry.sha256}` : entry.url,
      });
    });
    return reply.send({ ok: true });
  });
}
