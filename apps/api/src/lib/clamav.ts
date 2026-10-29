import net from 'node:net';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import type { AvStatus } from '../generated/prisma/client';
import { prisma } from './prisma';
import { s3 } from './s3';
import { applyTriageRulesQuietly } from './triage-rules';

/**
 * Antivirus ClamAV (contenor proprio, item 49): a API fala com o clamd pela
 * rede interna (TCP, protocolo INSTREAM). O arquivo vai so pela conexao, nunca
 * para o disco da API; o veredito continua com o analista.
 */

const CHUNK = 64 * 1024;
/** Tempo para comandos curtos (PING/VERSION) e para a varredura. */
const SHORT_MS = 5_000;
const SCAN_MS = 120_000;

export function clamavEnabled(): boolean {
  return Boolean(env.CLAMAV_HOST);
}

export function clamavAddress(): string {
  return `${env.CLAMAV_HOST}:${env.CLAMAV_PORT}`;
}

/** Envia um comando (formato "z...\0") e devolve a resposta sem o \0 final. */
function command(cmd: string, payload: Buffer | null, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value ?? '');
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('o ClamAV não respondeu a tempo')));
    socket.on('error', (err) => finish(err));
    socket.on('data', (d) => chunks.push(d));
    socket.on('end', () =>
      finish(null, Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '').trim()),
    );
    socket.on('connect', () => {
      socket.write(`z${cmd}\0`);
      if (!payload) return;
      // INSTREAM: blocos com o tamanho (4 bytes, big-endian) e um bloco vazio no fim.
      for (let i = 0; i < payload.length; i += CHUNK) {
        const part = payload.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

export async function clamPing(): Promise<boolean> {
  return (await command('PING', null, SHORT_MS)) === 'PONG';
}

export interface ClamVersion {
  engine: string;
  dbVersion: number | null;
  dbDate: Date | null;
}

/** "ClamAV 1.4.1/27428/Mon Oct 21 07:30:00 2026" -> motor, numero e data da base. */
export function parseVersion(text: string): ClamVersion {
  const [engine, db, date] = text.split('/');
  const parsed = date ? new Date(date) : null;
  return {
    engine: engine?.trim() || text,
    dbVersion: db && /^\d+$/.test(db) ? Number(db) : null,
    dbDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
  };
}

export async function clamVersion(): Promise<ClamVersion> {
  return parseVersion(await command('VERSION', null, SHORT_MS));
}

export interface ScanOutcome {
  status: Exclude<AvStatus, 'PENDING'>;
  signature: string | null;
  error: string | null;
}

/** Varre o conteudo. "stream: OK" = limpo; "stream: <nome> FOUND" = infectado. */
export async function scanBuffer(buffer: Buffer): Promise<ScanOutcome> {
  let reply: string;
  try {
    reply = await command('INSTREAM', buffer, SCAN_MS);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const reason =
      code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? 'ClamAV fora do ar'
        : err instanceof Error
          ? err.message
          : 'falha na varredura';
    return { status: 'ERROR', signature: null, error: reason };
  }
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found) return { status: 'INFECTED', signature: found[1], error: null };
  if (reply === 'stream: OK') return { status: 'CLEAN', signature: null, error: null };
  if (/size limit exceeded/i.test(reply)) {
    return {
      status: 'ERROR',
      signature: null,
      error: 'arquivo maior que o limite do ClamAV (StreamMaxLength)',
    };
  }
  return { status: 'ERROR', signature: null, error: reply || 'resposta vazia do ClamAV' };
}

/**
 * Varre a amostra e grava o resultado (um por amostra, o mais recente). Usa o
 * conteudo ja em memoria no envio ou le do MinIO (Escanear de novo). Nunca lanca.
 */
export async function scanEntry(entryId: string, buffer?: Buffer): Promise<void> {
  await prisma.antivirusScan.upsert({
    where: { entryId },
    create: { entryId, status: 'PENDING' },
    update: { status: 'PENDING', signature: null, error: null },
  });
  let content = buffer;
  if (!content) {
    const entry = await prisma.entry.findUnique({
      where: { id: entryId },
      select: { storageKey: true, bucket: true },
    });
    try {
      if (!entry?.storageKey) throw new Error('arquivo indisponível');
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
      );
      content = Buffer.from(await obj.Body!.transformToByteArray());
    } catch (err) {
      await prisma.antivirusScan.update({
        where: { entryId },
        data: {
          status: 'ERROR',
          error: `não foi possível ler o arquivo (${err instanceof Error ? err.message : err})`,
          scannedAt: new Date(),
        },
      });
      return;
    }
  }
  const outcome = await scanBuffer(content);
  let version: ClamVersion | null = null;
  if (outcome.status !== 'ERROR') version = await clamVersion().catch(() => null);
  await prisma.antivirusScan.update({
    where: { entryId },
    data: {
      ...outcome,
      engine: version?.engine ?? null,
      dbVersion: version?.dbVersion ?? null,
      dbDate: version?.dbDate ?? null,
      scannedAt: new Date(),
    },
  });
  // Regras de triagem que dependem do antivirus (item 86).
  if (outcome.status === 'INFECTED') await applyTriageRulesQuietly(entryId);
}

/** Dispara a varredura sem segurar a resposta do envio. */
export function scanInBackground(
  entryId: string,
  buffer: Buffer | undefined,
  log: { error: (o: object, m: string) => void },
) {
  if (!clamavEnabled()) return;
  void scanEntry(entryId, buffer).catch((err) => log.error({ err }, '[clamav] falha'));
}
