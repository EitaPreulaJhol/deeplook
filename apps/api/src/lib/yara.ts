import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from './prisma';
import { s3 } from './s3';
import { applyTriageRulesQuietly } from './triage-rules';
import {
  compileRuleSets,
  type RuleSet,
  scanBuffer,
  validateRule,
  type YaraHit,
} from './yara-engine';
import { activeRulesWhere, yaraPackInfo } from './yara-packs';
import type { YaraRequest } from './yara-worker';

export { compileRuleSets, scanBuffer, validateRule };
export type { RuleSet, YaraHit };

/**
 * Regras YARA (item 56) com o YARA-X oficial do VirusTotal (WebAssembly, sem
 * binario nativo). As regras sao validadas antes de salvar e aplicadas a cada
 * arquivo enviado, numa thread separada (item 146); nada e executado.
 */

let worker: Worker | null = null;
const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
let nextId = 0;
/** Conjuntos que a thread tem carregados: chave -> versao. */
const loadedVersions = new Map<string, string>();

function yaraWorker(): Worker {
  if (worker) return worker;
  // Em dist roda o .js; nos testes, o .ts (o tsx passa para a thread pelo execArgv).
  const created = new Worker(join(__dirname, `yara-worker${__filename.slice(-3)}`));
  created.unref();
  created.on('message', (m: { id: number; result?: unknown; error?: string }) => {
    const pending = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error !== undefined) pending?.reject(new Error(m.error));
    else pending?.resolve(m.result as never);
  });
  // Thread caiu: o que estava em andamento falha, e a proxima chamada sobe outra.
  const lost = (err: Error) => {
    if (worker === created) worker = null;
    loadedVersions.clear();
    for (const pending of waiting.values()) pending.reject(err);
    waiting.clear();
  };
  created.on('error', lost);
  created.on('exit', () => lost(new Error('a thread de varredura terminou')));
  worker = created;
  return created;
}

function call<T>(request: YaraRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve: resolve as (v: never) => void, reject });
    yaraWorker().postMessage({ id, request });
  });
}

// Uma de cada vez: cada arquivo so e copiado para a thread quando chega a vez dele.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Varre com o conjunto `key`, carregando-o antes se a versao mudou. */
export function scanInWorker(
  key: string,
  version: string,
  loadSets: () => Promise<RuleSet[]>,
  content: Uint8Array,
): Promise<YaraHit[]> {
  return inTurn(async () => {
    if (loadedVersions.get(key) !== version) {
      loadedVersions.delete(key);
      await call({ type: 'load', key, sets: await loadSets() });
      loadedVersions.set(key, version);
    }
    const { hits } = await call<{ hits: YaraHit[] }>({ type: 'scan', key, content });
    return hits;
  });
}

/** Libera um conjunto que nao sera mais usado (varredura retroativa). */
export function dropFromWorker(key: string): Promise<void> {
  return inTurn(async () => {
    loadedVersions.delete(key);
    if (worker) await call({ type: 'drop', key });
  });
}

/**
 * Varre com as regras ativas, cada uma no proprio namespace (dois analistas podem
 * usar o mesmo identificador). A thread recompila so quando as regras mudam; o
 * texto das regras so sai do banco nesse caso.
 */
export async function scanWithYara(
  buffer: Buffer,
): Promise<{ hits: YaraHit[]; rulesCount: number; version: string | null }> {
  const where = await activeRulesWhere();
  const active = await prisma.yaraRule.findMany({
    where,
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  if (active.length === 0) return { hits: [], rulesCount: 0, version: null };
  const version = createHash('sha256')
    .update(active.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).join('|'))
    .digest('hex')
    .slice(0, 16);
  const hits = await scanInWorker(
    'active',
    version,
    async () =>
      (
        await prisma.yaraRule.findMany({
          where,
          select: { id: true, name: true, source: true, pack: true },
          orderBy: { name: 'asc' },
        })
      ).map((r) => ({ ...r, pack: yaraPackInfo(r.pack) })),
    new Uint8Array(buffer),
  );
  return { hits, rulesCount: active.length, version };
}

/** Varre a amostra e grava o resultado (o mais recente). Nunca lanca. */
export async function yaraScanEntry(entryId: string, buffer?: Buffer): Promise<void> {
  await prisma.yaraScan.upsert({
    where: { entryId },
    create: { entryId, status: 'PENDING' },
    update: { status: 'PENDING', error: null },
  });
  try {
    let content = buffer;
    if (!content) {
      const entry = await prisma.entry.findUnique({
        where: { id: entryId },
        select: { storageKey: true, bucket: true },
      });
      if (!entry?.storageKey) throw new Error('arquivo indisponível');
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
      );
      content = Buffer.from(await obj.Body!.transformToByteArray());
    }
    const { hits, rulesCount } = await scanWithYara(content);
    await prisma.yaraScan.update({
      where: { entryId },
      data: {
        status: hits.length ? 'MATCHED' : 'CLEAN',
        matches: hits as unknown as Prisma.InputJsonValue,
        rulesCount,
        scannedAt: new Date(),
      },
    });
    // Regras de triagem que dependem do YARA (item 86).
    if (hits.length) await applyTriageRulesQuietly(entryId);
  } catch (err) {
    await prisma.yaraScan.update({
      where: { entryId },
      data: {
        status: 'ERROR',
        error: err instanceof Error ? err.message.slice(0, 300) : 'falha na varredura',
        scannedAt: new Date(),
      },
    });
  }
}

/** Dispara a varredura YARA sem segurar o envio (so com regras ativas). */
export function yaraScanInBackground(
  entryId: string,
  buffer: Buffer | undefined,
  log: { error: (o: object, m: string) => void },
) {
  void activeRulesWhere()
    .then((where) => prisma.yaraRule.count({ where }))
    .then((n) => (n ? yaraScanEntry(entryId, buffer) : undefined))
    .catch((err) => log.error({ err }, '[yara] falha'));
}
