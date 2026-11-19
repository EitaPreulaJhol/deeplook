import type { FastifyInstance } from 'fastify';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { localizeStaticInfo } from '../lib/data-language';
import { requestLang } from '../lib/error-language';
import { prisma } from '../lib/prisma';
import { requestUnpack, unpackEnabled } from '../lib/unpack';

/**
 * Identificar e desempacotar (itens 7.8 e 7.9): roda sozinho na chegada de todo executavel (o
 * Detect It Easy identifica; os desempacotadores agem quando reconhecem); analistas pedem de novo
 * enquanto nao houver filhas. Quem ve a amostra ve o resultado (o requireUser ja barra a amostra
 * de outro dono).
 */
export async function unpackRoutes(app: FastifyInstance) {
  const executable = (staticInfo: unknown) => {
    const kind = (staticInfo as { detectedType?: { id?: string } | null } | null)?.detectedType?.id;
    return kind === 'pe' || kind === 'elf';
  };

  app.get('/api/entries/:id/unpack', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, staticInfo: true, fileSize: true, filePurgedAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    const job = await prisma.unpackJob.findUnique({
      where: { entryId: id },
      select: {
        status: true,
        unpacker: true,
        label: true,
        note: true,
        files: true,
        detections: true,
        dieVersion: true,
        dieError: true,
        go: true,
        magika: true,
        decoded: true,
        error: true,
        ms: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    // Titulo das filhas criadas (a lista guarda so o id).
    const files = (job?.files ?? []) as { entryId?: string }[];
    const ids = files.map((f) => f.entryId).filter((x): x is string => Boolean(x));
    const children = ids.length
      ? await prisma.entry.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { id: true, title: true, verdict: true },
        })
      : [];
    return reply.send({
      enabled: unpackEnabled(),
      applicable: entry.type === 'FILE' && executable(entry.staticInfo),
      maxMb: env.UNPACK_MAX_MB,
      // Motivos e notas no idioma de quem pede (plano pos-revisao, item 1.4).
      job: localizeStaticInfo(job, requestLang(req)),
      children,
    });
  });

  app.post('/api/entries/:id/unpack', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!isAnalyst(user)) {
      return reply.code(403).send({ error: 'Somente analistas pedem o desempacotamento.' });
    }
    if (!unpackEnabled()) {
      return reply
        .code(503)
        .send({ error: 'O desempacotamento está desligado (UNPACK_URL / UNPACK_TOKEN).' });
    }
    const { id } = req.params as { id: string };
    const entry = await prisma.entry.findUnique({
      where: { id },
      select: { type: true, staticInfo: true, fileSize: true, filePurgedAt: true },
    });
    if (!entry) return reply.code(404).send({ error: 'Amostra não encontrada.' });
    if (entry.filePurgedAt) {
      return reply
        .code(400)
        .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    }
    if (entry.type !== 'FILE' || !executable(entry.staticInfo)) {
      return reply.code(400).send({ error: 'Só executáveis do Windows (PE) e do Linux (ELF).' });
    }
    if ((entry.fileSize ?? 0) > env.UNPACK_MAX_MB * 1024 * 1024) {
      return reply.code(400).send({ error: `Executáveis de até ${env.UNPACK_MAX_MB} MB.` });
    }
    const job = await prisma.unpackJob.findUnique({
      where: { entryId: id },
      select: { status: true, files: true },
    });
    if (job && (job.status === 'PENDING' || job.status === 'RUNNING')) {
      return reply.code(409).send({ error: 'O desempacotamento já está na fila.' });
    }
    // De novo duplicaria as amostras filhas que ja sairam. A contagem cobre o trabalho que falhou
    // no meio sem chegar a gravar a lista (so um desempacotamento da filhas a um executavel).
    if (
      ((job?.files ?? []) as { entryId?: string }[]).some((f) => f.entryId) ||
      (await prisma.entry.count({ where: { parentEntryId: id } }))
    ) {
      return reply.code(409).send({ error: 'Os arquivos desta amostra já foram extraídos.' });
    }
    await requestUnpack(id);
    return reply.code(202).send({ ok: true });
  });
}
