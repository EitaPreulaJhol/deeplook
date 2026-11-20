import type { Readable } from 'node:stream';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { isAnalyst, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { s3 } from '../lib/s3';
import { sendValidationError } from '../lib/validation';

/** Visualizador hexadecimal (item 57): blocos de ate 4 KB, em qualquer posicao do arquivo. */
const HEX_BLOCK = 4 * 1024;
/** Busca (plans/ajustes-usabilidade, item 7): posicoes devolvidas e tamanho do padrao. */
export const HEX_SEARCH_MAX_HITS = 200;
const HEX_SEARCH_MAX_PATTERN = 256;

const HexQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  length: z.coerce.number().int().min(1).max(HEX_BLOCK).default(HEX_BLOCK),
});

const HexSearchQuery = z.object({
  q: z.string().trim().min(1).max(1024),
  /** text: sem diferenciar maiusculas, em ASCII/UTF-8 e em UTF-16LE; bytes: "4D 5A 90 00". */
  kind: z.enum(['text', 'bytes']).default('text'),
});

export type HexEncoding = 'utf8' | 'utf16' | 'bytes';
interface Pattern {
  bytes: Buffer;
  encoding: HexEncoding;
}

/** "4D 5A", "4d5a", "0x4d 0x5a", "\x4d\x5a" -> bytes; null se nao for hex de bytes inteiros. */
export function parseHexBytes(text: string): Buffer | null {
  const clean = text.replace(/0x|\\x|[\s,:-]/gi, '');
  if (!clean || clean.length % 2 || !/^[0-9a-f]+$/i.test(clean)) return null;
  return Buffer.from(clean, 'hex');
}

/** Letras ASCII em minuscula (a busca por texto nao diferencia maiusculas). */
function lowerAscii(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b >= 0x41 && b <= 0x5a) out[i] = b + 0x20;
  }
  return out;
}

/** Os padroes da busca: texto em UTF-8 e em UTF-16LE (strings de Windows), ou os bytes. */
export function searchPatterns(q: string, kind: 'text' | 'bytes'): Pattern[] | null {
  if (kind === 'bytes') {
    const bytes = parseHexBytes(q);
    return bytes && bytes.length <= HEX_SEARCH_MAX_PATTERN ? [{ bytes, encoding: 'bytes' }] : null;
  }
  const utf8 = lowerAscii(Buffer.from(q, 'utf8'));
  const utf16 = lowerAscii(Buffer.from(q, 'utf16le'));
  if (utf16.length > HEX_SEARCH_MAX_PATTERN) return null;
  return [
    { bytes: utf8, encoding: 'utf8' },
    { bytes: utf16, encoding: 'utf16' },
  ];
}

const ORDER: Record<HexEncoding, number> = { bytes: 0, utf8: 1, utf16: 2 };

export interface HexHit {
  offset: number;
  length: number;
  encoding: HexEncoding;
}

/**
 * Procura os padroes num fluxo de bytes, bloco a bloco (o arquivo nao fica inteiro na memoria). As
 * ultimas (maior padrao - 1) posicoes de cada bloco vao junto com o seguinte, para achar o que
 * cruza a divisa; so conta o que termina no bloco novo (sem achar duas vezes). Para ao passar de
 * `maxHits`.
 */
export async function searchStream(
  stream: AsyncIterable<Uint8Array>,
  patterns: Pattern[],
  { caseless, maxHits = HEX_SEARCH_MAX_HITS }: { caseless: boolean; maxHits?: number },
): Promise<{ hits: HexHit[]; truncated: boolean; scanned: number }> {
  const keep = Math.max(...patterns.map((p) => p.bytes.length)) - 1;
  let tail: Buffer = Buffer.alloc(0);
  let scanned = 0;
  const hits: HexHit[] = [];
  for await (const raw of stream) {
    const chunk = caseless ? lowerAscii(Buffer.from(raw)) : Buffer.from(raw);
    const data = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    const base = scanned - tail.length;
    for (const { bytes, encoding } of patterns) {
      for (let at = data.indexOf(bytes); at !== -1; at = data.indexOf(bytes, at + 1)) {
        if (at + bytes.length > tail.length) {
          hits.push({ offset: base + at, length: bytes.length, encoding });
        }
      }
    }
    scanned += chunk.length;
    if (hits.length > maxHits) break;
    tail = keep > 0 ? data.subarray(Math.max(0, data.length - keep)) : Buffer.alloc(0);
  }
  // Um caractere so: o UTF-16 ("a\0") comeca onde o UTF-8 ("a") ja achou; fica uma posicao.
  hits.sort((a, b) => a.offset - b.offset || ORDER[a.encoding] - ORDER[b.encoding]);
  const unique = hits.filter((h, i) => i === 0 || h.offset !== hits[i - 1].offset);
  return { hits: unique.slice(0, maxHits), truncated: unique.length > maxHits, scanned };
}

/** A amostra de arquivo, ou a resposta de erro ja enviada (analistas; nada de link ou expurgada). */
export async function sampleFile(req: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (!isAnalyst(user)) {
    await reply.code(403).send({ error: 'Somente analistas veem o conteúdo do arquivo.' });
    return null;
  }
  const { id } = req.params as { id: string };
  const entry = await prisma.entry.findUnique({
    where: { id },
    select: { type: true, storageKey: true, bucket: true, fileSize: true, filePurgedAt: true },
  });
  if (!entry) {
    await reply.code(404).send({ error: 'Amostra não encontrada.' });
    return null;
  }
  if (entry.type !== 'FILE') {
    await reply.code(400).send({ error: 'Links não têm conteúdo.' });
    return null;
  }
  if (entry.filePurgedAt || !entry.storageKey) {
    await reply
      .code(410)
      .send({ error: 'O arquivo desta amostra foi expurgado pela política de retenção.' });
    return null;
  }
  return { ...entry, storageKey: entry.storageKey, size: entry.fileSize ?? 0 };
}

/**
 * Bytes do arquivo para o visualizador hexadecimal da aba Detalhes (so analistas). Le do MinIO so
 * a faixa pedida (Range): nada e baixado inteiro nem executado. A busca le o arquivo em fluxo.
 */
export async function hexRoutes(app: FastifyInstance) {
  app.get('/api/entries/:id/hex', async (req, reply) => {
    const parsed = HexQuery.safeParse(req.query);
    const entry = await sampleFile(req, reply);
    if (!entry) return;
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { size } = entry;
    const { offset } = parsed.data;
    // O visualizador anda pelo arquivo inteiro (a busca salta para qualquer posicao).
    const limit = size;
    if (offset >= limit) {
      return reply.send({ offset, size, limit, data: '' });
    }
    const end = Math.min(offset + parsed.data.length, limit) - 1;
    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: entry.bucket || env.S3_BUCKET,
          Key: entry.storageKey,
          Range: `bytes=${offset}-${end}`,
        }),
      );
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      return reply.send({ offset, size, limit, data: bytes.toString('base64') });
    } catch (err) {
      req.log.error({ err }, 'Falha ao ler a amostra no MinIO');
      return reply.code(502).send({ error: 'Nao foi possivel ler o arquivo no armazenamento.' });
    }
  });

  // ---- Busca no arquivo (plans/ajustes-usabilidade, item 7) ----
  app.get('/api/entries/:id/hex/search', async (req, reply) => {
    const entry = await sampleFile(req, reply);
    if (!entry) return;
    const parsed = HexSearchQuery.safeParse(req.query);
    if (!parsed.success) return sendValidationError(reply, parsed.error, 'Parâmetros inválidos.');
    const { q, kind } = parsed.data;
    const patterns = searchPatterns(q, kind);
    if (!patterns) {
      return reply.code(400).send({
        error:
          kind === 'bytes'
            ? 'Use bytes em hexadecimal, como 4D 5A 90 00 (até 256 bytes).'
            : 'Texto longo demais para a busca.',
      });
    }
    let body: Readable | undefined;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
      );
      body = obj.Body as Readable;
      const result = await searchStream(body, patterns, { caseless: kind === 'text' });
      return reply.send({ q, kind, size: entry.size, ...result });
    } catch (err) {
      req.log.error({ err }, 'Falha ao ler a amostra no MinIO');
      return reply.code(502).send({ error: 'Nao foi possivel ler o arquivo no armazenamento.' });
    } finally {
      // Parou antes do fim (teto de posicoes): solta a conexao com o MinIO.
      body?.destroy();
    }
  });
}
