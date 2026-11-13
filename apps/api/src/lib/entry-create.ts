import { randomUUID } from 'node:crypto';

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { autoAssign } from './auto-assign';
import { enqueueCapaIfEligible } from './capa';
import { scanInBackground } from './clamav';
import { sha256Hex } from './crypto';
import { isEmailFile, parseEmail } from './eml';
import { recordEvent } from './events';
import { normalizeUrl, urlKey } from './ioc-normalize';
import { notifyWatchers, sampleIndicators } from './ioc-watch';
import { rememberUrls } from './iocs';
import { scanLookalikesQuietly } from './lookalike';
import { enqueueOletoolsIfEligible } from './oletools';
import { relationHashes } from './pe-analysis';
import { prisma } from './prisma';
import { createWithinQuota, QuotaExceeded } from './quota';
import { checkReputationInBackground } from './reputation';
import { s3 } from './s3';
import type { StaticInfo } from './static-analysis';
import { analyzeInThread } from './static-analysis-thread';
import { tlsh, TLSH_MAX_BYTES } from './tlsh';
import { applyTriageRules } from './triage-rules';
import { enqueueIdentify, type Identified, recordIdentified, type UnpackedChild } from './unpack';
import { yaraScanInBackground } from './yara';

/**
 * Criacao de uma amostra de arquivo: o caminho unico de um envio, de um anexo de e-mail, de um
 * arquivo extraido de imagem de disco e de uma filha do desempacotador (item 7.8). Morava em
 * routes/entries.ts; saiu de la porque a fila do desempacotador a usa em segundo plano, sem rota
 * nem requisicao, e o index.ts importava de uma rota para subir uma fila.
 */

/**
 * Regras de triagem (item 86) e depois a atribuicao automatica (item 72), que ja
 * usa as tags e a prioridade das regras. Falha nao impede o envio.
 */
/**
 * O que a criacao de uma amostra usa da requisicao: so o log. A fila do desempacotador (item 7.8)
 * cria amostras filhas em segundo plano, sem requisicao, com o log da API.
 */
export type EntryContext = Pick<FastifyRequest, 'log'>;

export async function assignOnArrival(entryId: string, req: EntryContext) {
  // Dominios parecidos com os da empresa (item 92).
  await scanLookalikesQuietly(entryId);
  try {
    await applyTriageRules(entryId);
  } catch (err) {
    req.log.error({ err }, 'Falha nas regras de triagem');
  }
  try {
    await autoAssign(entryId);
  } catch (err) {
    req.log.error({ err }, 'Falha na atribuição automática');
  }
}

export async function createFileEntry(
  req: EntryContext,
  ownerId: string,
  input: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
    title: string;
    description: string | null;
    tags: { id: string }[];
    /** Anexo de um e-mail (item 54): amostra pai. */
    parentEntryId?: string;
    /** Filha de um desempacotamento ja identificada pelo servico (item 7.9). */
    identified?: Identified;
  },
  /** Cota restante (usuario comum): cada anexo de e-mail tambem conta. */
  quota: { remaining: number | null } = { remaining: null },
  depth = 0,
) {
  const { buffer, filename, mimetype } = input;
  const sha256 = sha256Hex(buffer);
  // TLSH (item 71): ate 32 MB (~0,5 s); vazio = nao calculavel.
  const fuzzy = buffer.length <= TLSH_MAX_BYTES ? (tlsh(buffer) ?? '') : '';
  const storageKey = `samples/${randomUUID()}`;
  // Analise estatica (so leitura, com limites); falha nao impede o envio.
  let staticInfo: StaticInfo | undefined;
  try {
    staticInfo = await analyzeInThread(buffer, filename);
    // URLs sugeridas abrem a ficha pela chave (item 166).
    await rememberUrls(prisma, staticInfo.iocCandidates);
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

  const entry = await createWithinQuota(ownerId, quota.remaining !== null, (db) =>
    db.entry.create({
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
        tlsh: fuzzy,
        ...relationHashes(staticInfo?.pe),
        staticInfo: staticInfo ? (staticInfo as unknown as Prisma.InputJsonValue) : undefined,
        parentEntryId: input.parentEntryId ?? null,
        tags: { connect: input.tags },
      },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        tags: true,
      },
    }),
  ).catch(async (err: unknown) => {
    // Sem amostra, o arquivo recem-gravado nao teria dono.
    if (err instanceof QuotaExceeded) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }))
        .catch((e: unknown) => req.log.warn({ err: e }, 'Falha ao apagar envio além da cota'));
    }
    throw err;
  });

  await recordEvent(prisma, { entryId: entry.id, actorId: ownerId, type: 'CREATED' });
  await assignOnArrival(entry.id, req);
  checkReputationInBackground(entry.id, req.log);
  scanInBackground(entry.id, buffer, req.log);
  yaraScanInBackground(entry.id, buffer, req.log);
  // Analise de funcoes (item 7.2): executavel do Windows ou do Linux vai para a fila do capa.
  await enqueueCapaIfEligible(entry.id, staticInfo?.detectedType?.id, buffer.length, req.log);
  // Documento do Office ou RTF (item 7.14): oletools, em segundo plano.
  await enqueueOletoolsIfEligible(entry.id, staticInfo?.detectedType?.id, buffer.length, req.log);
  // Identificar (Detect It Easy, 7.9) e desempacotar (7.8): todo executavel vai para a fila, menos a
  // filha que o servico ja identificou e que nenhum desempacotador reconhece.
  if (input.identified && !input.identified.candidate) {
    await recordIdentified(entry.id, input.identified, staticInfo).catch((err: unknown) =>
      req.log.error({ err }, '[unpack] falha ao gravar a identificação'),
    );
  } else {
    await enqueueIdentify(entry.id, buffer.length, staticInfo, req.log);
  }
  await notifyWatchers(prisma, sampleIndicators(entry), entry.id, ownerId, 'sample');
  if (quota.remaining !== null) quota.remaining -= 1;
  // E-mail (.eml): le e transforma cada anexo numa amostra filha (ate 3 niveis
  // de e-mail encaminhado como anexo).
  if (isEmailFile(filename, mimetype) && depth < 3) {
    await readEmail(req, ownerId, entry, buffer, input, quota, depth);
  }
  return { entry };
}

/**
 * Amostra filha de um desempacotamento (item 7.8): a mesma criacao de um envio (analise estatica,
 * antivirus, YARA, capa, e o desempacotador de novo, com limite de geracoes), do mesmo dono e com
 * as tags da amostra mae, sem cota (como os arquivos de uma imagem de disco).
 */
export const unpackChildCreator =
  (log: FastifyBaseLogger) =>
  async (child: UnpackedChild): Promise<{ id: string }> => {
    const { entry } = await createFileEntry(
      { log },
      child.ownerId,
      {
        buffer: child.buffer,
        filename: child.filename,
        mimetype: 'application/octet-stream',
        title: child.title,
        description: child.description,
        tags: child.tags,
        parentEntryId: child.parentId,
        identified: child.identified,
      },
      { remaining: null },
      1,
    );
    return { id: entry.id };
  };

/** Le o .eml enviado, cria os anexos como amostras filhas e grava `emailInfo`. */
async function readEmail(
  req: EntryContext,
  ownerId: string,
  entry: { id: string; title: string; originalFilename: string | null },
  buffer: Buffer,
  input: { title: string; tags: { id: string }[] },
  quota: { remaining: number | null },
  depth: number,
) {
  let parsed;
  try {
    parsed = await parseEmail(buffer, env.MAX_UPLOAD_MB * 1024 * 1024);
  } catch (err) {
    req.log.warn({ err }, 'Falha ao ler o e-mail');
    return;
  }
  const { info, files } = parsed;
  // Sem titulo proprio (veio o nome do arquivo): o assunto identifica melhor.
  const title =
    input.title === entry.originalFilename && info.subject ? `E-mail: ${info.subject}` : undefined;
  for (const file of files) {
    const item = info.attachments.find(
      (a) => a.filename === file.filename && !a.entryId && !a.skipped,
    );
    if (quota.remaining !== null && quota.remaining <= 0) {
      if (item) item.skipped = 'cota de envio atingida';
      continue;
    }
    try {
      const { entry: child } = await createFileEntry(
        req,
        ownerId,
        {
          buffer: file.content,
          filename: file.filename,
          mimetype: file.mimeType,
          title: file.filename,
          description: `Anexo do e-mail "${info.subject ?? entry.title}".`,
          tags: input.tags,
          parentEntryId: entry.id,
        },
        quota,
        depth + 1,
      );
      if (item) item.entryId = child.id;
    } catch (err) {
      if (!(err instanceof QuotaExceeded)) throw err;
      quota.remaining = 0;
      if (item) item.skipped = 'cota de envio atingida';
    }
  }
  await prisma.entry.update({
    where: { id: entry.id },
    data: {
      emailInfo: info as unknown as Prisma.InputJsonValue,
      ...(title && { title: title.slice(0, 200) }),
    },
  });
}

/** Host do link, ou null se nao for uma URL. */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Criacao de uma amostra de link: o caminho unico do envio pela tela ou pela API e da importacao
 * de um pacote STIX num caso (revisao de novembro, 3.5). Lanca QuotaExceeded se a pessoa (usuario
 * comum) passou do limite do dia; analistas nao tem limite.
 */
export async function createUrlEntry(
  req: EntryContext,
  user: { id: string; analyst: boolean },
  input: { url: string; title: string; description?: string | null; tags?: { id: string }[] },
) {
  // Indicador de URL (item 165): o link normalizado, achado depois pela chave.
  const normalized = normalizeUrl(input.url);
  if (normalized) await rememberUrls(prisma, [{ kind: 'URL', value: normalized }]);
  const entry = await createWithinQuota(user.id, !user.analyst, (db) =>
    db.entry.create({
      data: {
        ownerId: user.id,
        type: 'URL',
        title: input.title,
        description: input.description || null,
        url: input.url,
        urlDomain: domainOf(input.url),
        urlKey: normalized ? urlKey(normalized) : null,
        tags: { connect: input.tags ?? [] },
      },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        tags: true,
      },
    }),
  );
  await recordEvent(prisma, { entryId: entry.id, actorId: user.id, type: 'CREATED' });
  await assignOnArrival(entry.id, req);
  checkReputationInBackground(entry.id, req.log);
  await notifyWatchers(prisma, sampleIndicators(entry), entry.id, user.id, 'sample');
  return entry;
}
