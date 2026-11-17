import { gunzipSync, gzipSync } from 'node:zlib';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger } from 'fastify';

import { env } from '../env';
import { log } from './log';
import { prisma } from './prisma';
import { s3 } from './s3';

/**
 * O que os servicos de descompilacao (.NET e Java) guardam: o fonte inteiro fica no armazenamento
 * (um JSON comprimido por amostra), fora do banco, e os arquivos embutidos que sao executaveis ou
 * pacotes viram amostras filhas. O que muda de um servico para o outro (a chave do objeto e o texto
 * da descricao das filhas) vem de quem chama.
 */

/** O log da criacao das filhas (createFileEntry pede o formato do Fastify). */
const childLog = {
  info: (m: string) => log.info(m),
  warn: (o: unknown, m?: string) => log.warn(m ?? String(o)),
  error: (o: unknown, m?: string) => log.error(m ?? String(o)),
  debug: () => undefined,
  child: () => childLog,
} as unknown as FastifyBaseLogger;

export async function putSources(key: string, sources: Record<string, string>): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: gzipSync(JSON.stringify(sources)),
      ContentType: 'application/gzip',
    }),
  );
}

/** Todos os fontes guardados, ou null se nao ha (ou o objeto sumiu). */
export async function getSources(key: string): Promise<Record<string, string> | null> {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const gz = Buffer.from(await obj.Body!.transformToByteArray());
    return JSON.parse(gunzipSync(gz, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
  } catch {
    return null;
  }
}

/** O objeto do fonte de uma analise de servico (a lixeira apaga junto com a amostra). */
export async function sourceKeysOf(entryId: string, kind: 'DOTNET' | 'JAR'): Promise<string[]> {
  const row = await prisma.serviceAnalysis.findUnique({
    where: { entryId_kind: { entryId, kind } },
    select: { result: true },
  });
  const key = (row?.result as { sourceKey?: string } | null)?.sourceKey;
  return key ? [key] : [];
}

/**
 * Transforma os arquivos embutidos que vieram em Base64 (data) em amostras filhas, do mesmo dono e
 * sem cota, como as de um desempacotamento. Devolve a lista sem os bytes e com o id de cada filha.
 */
export async function createResourceChildren<
  R extends { name: string; data?: string | undefined; entryId?: string | undefined },
>(
  entryId: string,
  resources: R[],
  describe: (parentTitle: string, resource: R) => string,
  tag: string,
): Promise<Omit<R, 'data'>[]> {
  const parent = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { ownerId: true, title: true, tags: { select: { id: true } } },
  });
  const { createFileEntry } = await import('./entry-create');
  const out: Omit<R, 'data'>[] = [];
  for (const resource of resources) {
    const { data, ...rest } = resource;
    if (!data || !parent) {
      out.push(rest);
      continue;
    }
    try {
      const name = resource.name.split('/').pop() || 'recurso.bin';
      const { entry } = await createFileEntry(
        { log: childLog },
        parent.ownerId,
        {
          buffer: Buffer.from(data, 'base64'),
          filename: name,
          mimetype: 'application/octet-stream',
          title: name,
          description: describe(parent.title, resource),
          tags: parent.tags,
          parentEntryId: entryId,
        },
        { remaining: null },
        1,
      );
      out.push({ ...rest, entryId: entry.id });
    } catch (err) {
      log.warn(`[${tag}] falha ao criar a filha ${resource.name}: ${String(err)}`);
      out.push(rest);
    }
  }
  return out;
}
