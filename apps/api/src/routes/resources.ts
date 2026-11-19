import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { audit } from '../lib/audit';
import { isAnalyst, requireUser } from '../lib/auth';
import { detectType } from '../lib/file-type';
import { openPe, type PeImage } from '../lib/pe-analysis';
import { analyzeDotnet } from '../lib/pe-dotnet';
import { type ResourceFile, resourceFile } from '../lib/pe-resource-file';
import { resourceLeaves } from '../lib/pe-resources';
import { prisma } from '../lib/prisma';
import { isMissingObject, MISSING_OBJECT_MESSAGE, s3 } from '../lib/s3';
import { SAMPLE_ZIP_PASSWORD, sampleZipBuffer } from '../lib/sample-zip';
import { sendValidationError } from '../lib/validation';

/**
 * Download separado dos recursos de um executavel (plans/analise-estatica-ampliada, item 30): os
 * recursos Win32 (icone e cursor remontados como .ico/.cur, bitmap como .bmp) e os recursos .NET.
 * Mesma regra do download da amostra: so quem enviou e os analistas, com registro na Auditoria.
 * Imagens saem como arquivo; o resto (executavel, binario, script) dentro do ZIP com senha.
 */

/** Soma dos recursos no "baixar todos". */
const MAX_ALL_BYTES = 128 * 1024 * 1024;

const Params = z.object({
  id: z.string().min(1).max(64),
  index: z.coerce.number().int().min(0).max(100_000),
});
const Query = z.object({ source: z.enum(['pe', 'dotnet']).default('pe') });

type Source = z.infer<typeof Query>['source'];

/** O PE da amostra, ou a resposta de erro ja enviada. */
async function loadPe(
  req: FastifyRequest,
  reply: FastifyReply,
  id: string,
): Promise<{
  image: PeImage;
  entry: { id: string; title: string; ownerId: string };
  userId: string;
} | null> {
  const user = await requireUser(req, reply);
  if (!user) return null;
  const entry = await prisma.entry.findUnique({ where: { id } });
  if (entry && entry.ownerId !== user.id && !isAnalyst(user)) {
    reply.code(403).send({ error: 'Somente quem enviou e os analistas baixam os recursos.' });
    return null;
  }
  if (entry && entry.type === 'FILE' && entry.filePurgedAt) {
    reply
      .code(410)
      .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    return null;
  }
  if (!entry || entry.type !== 'FILE' || !entry.storageKey) {
    reply.code(404).send({ error: 'Arquivo não encontrado.' });
    return null;
  }
  const obj = await s3
    .send(new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }))
    .catch((err: unknown) => {
      if (isMissingObject(err)) return null;
      throw err;
    });
  if (!obj) {
    reply.code(404).send({ error: MISSING_OBJECT_MESSAGE });
    return null;
  }
  const buf = Buffer.from(await obj.Body!.transformToByteArray());
  const opened = openPe(buf);
  if (!opened) {
    reply.code(422).send({ error: 'A amostra não é um executável do Windows.' });
    return null;
  }
  return { image: opened.image, entry, userId: user.id };
}

/** O recurso .NET de indice `index`: o nome do assembly e a extensao do conteudo. */
function dotnetFile(image: PeImage, index: number): ResourceFile | null {
  const data = analyzeDotnet(image)?.resourceData[index];
  if (!data) return null;
  const bytes = image.buf.subarray(data.offset, data.offset + data.size);
  const type = detectType(bytes);
  const name = data.name.replace(/[^\w.-]+/g, '_').slice(0, 120) || `recurso-${index}`;
  const ext = type?.extensions.find(Boolean);
  const isImage = type !== null && ['png', 'jpeg', 'gif'].includes(type.id);
  return {
    // O nome do recurso ja com extensao fica como esta; sem ela, ganha a do conteudo.
    name: ext && !/\.[\w-]{1,10}$/.test(name) ? `${name}.${ext}` : name,
    data: bytes,
    image: isImage,
  };
}

/** Todos os arquivos de uma origem, na ordem da ficha. */
function allFiles(image: PeImage, source: Source): ResourceFile[] {
  if (source === 'dotnet') {
    const count = analyzeDotnet(image)?.resourceData.length ?? 0;
    return Array.from({ length: count }, (_, i) => dotnetFile(image, i)).filter(
      (f): f is ResourceFile => f !== null,
    );
  }
  const { leaves } = resourceLeaves(image);
  return leaves
    .map((_, i) => resourceFile(image, leaves, i))
    .filter((f): f is ResourceFile => f !== null);
}

function sendFile(reply: FastifyReply, name: string, data: Buffer, zip: boolean) {
  // Sempre octet-stream e attachment: o recurso vem da amostra, que e maliciosa por definicao.
  reply.header('Content-Type', zip ? 'application/zip' : 'application/octet-stream');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
  reply.header('Content-Disposition', `attachment; filename="${name}"`);
  if (zip) reply.header('X-DeepLook-Zip-Password', SAMPLE_ZIP_PASSWORD);
  return reply.send(data);
}

export async function resourceRoutes(app: FastifyInstance) {
  // Um recurso: o indice e o da lista da ficha (pe.resources ou pe.dotnet.resources).
  app.get('/api/entries/:id/resources/:index', async (req, reply) => {
    // O acesso vem antes do indice: amostra que a pessoa nao ve responde 404, como as outras rotas.
    const { id, index: rawIndex } = req.params as { id: string; index: string };
    const query = Query.safeParse(req.query);
    if (!query.success) return sendValidationError(reply, query.error);
    const loaded = await loadPe(req, reply, id);
    if (!loaded) return;
    const parsed = Params.shape.index.safeParse(rawIndex);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const { image, entry, userId } = loaded;
    const { source } = query.data;
    const index = parsed.data;
    const leaves = source === 'pe' ? resourceLeaves(image).leaves : [];
    const leaf = leaves[index];
    const file =
      source === 'dotnet' ? dotnetFile(image, index) : resourceFile(image, leaves, index);
    if (!file) return reply.code(404).send({ error: 'Recurso não encontrado neste arquivo.' });
    const zip = !file.image;
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: userId,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: [
        source === 'dotnet' || !leaf
          ? `Recurso .NET ${file.name}`
          : `Recurso ${leaf.type}/${leaf.name} (${leaf.lang})`,
        zip ? `ZIP com senha (${SAMPLE_ZIP_PASSWORD})` : 'imagem',
      ].join(' · '),
    });
    return zip
      ? sendFile(reply, `${file.name}.zip`, sampleZipBuffer([file]), true)
      : sendFile(reply, file.name, file.data, false);
  });

  // Todos os recursos de uma origem, num ZIP com senha.
  app.get('/api/entries/:id/resources', async (req, reply) => {
    const params = Params.pick({ id: true }).safeParse(req.params);
    if (!params.success) return sendValidationError(reply, params.error);
    const query = Query.safeParse(req.query);
    if (!query.success) return sendValidationError(reply, query.error);
    const loaded = await loadPe(req, reply, params.data.id);
    if (!loaded) return;
    const { image, entry, userId } = loaded;
    const { source } = query.data;
    const files = allFiles(image, source);
    if (!files.length) return reply.code(404).send({ error: 'Este arquivo não tem recursos.' });
    const total = files.reduce((n, f) => n + f.data.length, 0);
    if (total > MAX_ALL_BYTES) {
      return reply.code(413).send({
        error: `Os recursos somam mais de ${MAX_ALL_BYTES / 1024 / 1024} MB: baixe um de cada vez.`,
      });
    }
    await audit(prisma, req, {
      action: 'ENTRY_DOWNLOADED',
      actorId: userId,
      targetUserId: entry.ownerId,
      targetLabel: entry.title,
      detail: [
        source === 'dotnet'
          ? `Todos os recursos .NET (${files.length})`
          : `Todos os recursos (${files.length})`,
        `ZIP com senha (${SAMPLE_ZIP_PASSWORD})`,
      ].join(' · '),
    });
    const safeName = (entry.title || 'amostra').replace(/[^\w.-]+/g, '_').slice(0, 80);
    return sendFile(
      reply,
      `${safeName}-${source === 'dotnet' ? 'recursos-net' : 'recursos'}.zip`,
      sampleZipBuffer(files),
      true,
    );
  });
}
