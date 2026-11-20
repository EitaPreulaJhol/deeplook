import { createHash } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { requestAnalysis, requestFailure } from '../lib/analysis-service';
import { dotnetSources } from '../lib/dotnet';
import { jarSources } from '../lib/jar';
import { prisma } from '../lib/prisma';
import { pydecSources } from '../lib/pydec';
import { s3 } from '../lib/s3';
import {
  dedupe,
  literalsOf,
  stringsWithOffsets,
  type TabString,
  tabString,
} from '../lib/strings-tab';
import { sampleFile } from './hex';

/** Do arquivo, so o comeco (como a analise estatica): o resto entra pela busca do hex. */
const MAX_READ = 32 * 1024 * 1024;
const MAX_ITEMS = 5000;
const rankSchema = z.object({ ok: z.literal(true), scores: z.array(z.number()) });
const rankCache = new Map<string, number[]>();

/** As notas do StringSifter (servico ml), ou o motivo de nao ter. */
async function rank(texts: string[]): Promise<{ scores: number[] } | { reason: string }> {
  if (!env.ML_URL || !env.ML_TOKEN) return { reason: 'o serviço ml está desligado (ML_URL vazio)' };
  const key = createHash('sha256').update(texts.join('\u0000')).digest('hex');
  const cached = rankCache.get(key);
  if (cached) return { scores: cached };
  const service = {
    name: 'ml',
    url: env.ML_URL,
    token: env.ML_TOKEN,
    timeoutS: env.ML_REQUEST_TIMEOUT_S,
  };
  try {
    const res = await requestAnalysis(service, Buffer.from(JSON.stringify(texts)), {
      path: '/rank',
      waitMs: 60_000,
      retryEveryMs: 1000,
    });
    const parsed = rankSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || parsed.data.scores.length !== texts.length) {
      return { reason: 'resposta do serviço em formato inesperado' };
    }
    rankCache.set(key, parsed.data.scores);
    if (rankCache.size > 30) rankCache.delete(rankCache.keys().next().value!);
    return { scores: parsed.data.scores };
  } catch (err) {
    return { reason: requestFailure(service, err) };
  }
}

/**
 * Aba de strings unificada (plans/analise-estatica-ampliada, item 26): do arquivo, do FLOSS e do
 * codigo descompilado, ordenadas pelo StringSifter. So analistas (e o conteudo do arquivo).
 */
export async function stringsRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/strings', async (req, reply) => {
    const entry = await sampleFile(req, reply);
    if (!entry) return;
    const { id } = req.params as { id: string };
    let buf: Buffer;
    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: entry.bucket || env.S3_BUCKET,
          Key: entry.storageKey,
          Range: `bytes=0-${Math.min(entry.size, MAX_READ) - 1}`,
        }),
      );
      buf = Buffer.from(await obj.Body!.transformToByteArray());
    } catch (err) {
      req.log.error({ err }, 'Falha ao ler a amostra no MinIO');
      return reply.code(502).send({ error: 'Nao foi possivel ler o arquivo no armazenamento.' });
    }
    const list: TabString[] = stringsWithOffsets(buf);
    const capa = await prisma.capaAnalysis.findUnique({
      where: { entryId: id },
      select: { floss: true },
    });
    const floss = (capa?.floss ?? null) as Record<string, { string?: string }[] | undefined> | null;
    for (const [field, source] of [
      ['decoded', 'floss-decoded'],
      ['stack', 'floss-stack'],
      ['tight', 'floss-tight'],
    ] as const) {
      for (const s of floss?.[field] ?? []) {
        if (s.string && s.string.length >= 4)
          list.push(tabString(s.string.slice(0, 400), source, null));
      }
    }
    const [net, java, python] = await Promise.all([
      dotnetSources(id).catch(() => null),
      jarSources(id).catch(() => null),
      pydecSources(id).catch(() => null),
    ]);
    for (const [sources, kind] of [
      [net, 'dotnet'],
      [java, 'jar'],
      [python, 'python'],
    ] as const) {
      if (!sources) continue;
      for (const [path, text] of Object.entries(sources)) {
        if (!path.endsWith('.pycdas.txt')) list.push(...literalsOf(text, kind));
      }
    }
    const all = dedupe(list);
    const ranked = await rank(all.map((s) => s.text));
    if ('scores' in ranked) all.forEach((s, i) => (s.score = ranked.scores[i]));
    all.sort((a, b) => b.score - a.score);
    return reply.send({
      total: all.length,
      rankedBy: 'scores' in ranked ? 'stringsifter' : 'heuristic',
      rankReason: 'reason' in ranked ? ranked.reason : null,
      truncated: all.length > MAX_ITEMS || entry.size > MAX_READ,
      items: all.slice(0, MAX_ITEMS),
    });
  });
}
