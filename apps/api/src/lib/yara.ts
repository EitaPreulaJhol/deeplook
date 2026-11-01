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
  type ScanContext,
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

/**
 * O motor (`@virustotal/yara-x` 1.21 e 1.22.0) quebra de vez em cerca de 16.270 chamadas
 * entre `scan` e `setGlobal`, e so volta numa thread nova (item 148). Com folga: a
 * compilacao tambem conta.
 */
const MAX_ENGINE_CALLS = 9_000;
/** Uma varredura e as cinco variaveis (ScanContext). */
const CALLS_PER_SCAN = 6;
const CALLS_PER_SET = 2;
/** O WebAssembly nunca devolve memoria: depois de um arquivo assim, thread nova (item 149). */
const RECYCLE_AFTER_BYTES = 100 * 1024 * 1024;

let worker: Worker | null = null;
const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
let nextId = 0;
let engineCalls = 0;
let workerRestarts = 0;
/** Conjuntos que a thread tem carregados: chave -> versao. */
const loadedVersions = new Map<string, string>();

/** Para os testes: quantas vezes a thread foi trocada. */
export const yaraWorkerRestarts = () => workerRestarts;

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
    if (worker !== created) return;
    worker = null;
    loadedVersions.clear();
    engineCalls = 0;
    for (const pending of waiting.values()) pending.reject(err);
    waiting.clear();
  };
  created.on('error', lost);
  created.on('exit', () => lost(new Error('a thread de varredura terminou')));
  worker = created;
  return created;
}

/** Troca a thread (a proxima chamada sobe outra e recompila, sem travar a API). */
async function recycleWorker() {
  const old = worker;
  worker = null;
  loadedVersions.clear();
  engineCalls = 0;
  workerRestarts += 1;
  if (old) await old.terminate();
}

function call<T>(request: YaraRequest, transfer: ArrayBuffer[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve: resolve as (v: never) => void, reject });
    yaraWorker().postMessage({ id, request }, transfer);
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
  context?: ScanContext,
): Promise<YaraHit[]> {
  const attempt = async () => {
    if (engineCalls >= MAX_ENGINE_CALLS) await recycleWorker();
    if (loadedVersions.get(key) !== version) {
      loadedVersions.delete(key);
      const sets = await loadSets();
      await call({ type: 'load', key, sets });
      loadedVersions.set(key, version);
      engineCalls += sets.length * CALLS_PER_SET;
    }
    // Copia para a thread sem clonar de novo; o original pode estar em uso no antivirus.
    const copy = new Uint8Array(content);
    const { hits } = await call<{ hits: YaraHit[] }>(
      { type: 'scan', key, content: copy, context },
      [copy.buffer],
    );
    engineCalls += CALLS_PER_SCAN;
    if (content.length >= RECYCLE_AFTER_BYTES) await recycleWorker();
    return hits;
  };
  return inTurn(async () => {
    try {
      return await attempt();
    } catch (err) {
      // Motor quebrado ou thread perdida: uma nova tentativa, numa thread nova.
      if (!/unreachable|thread de varredura|memory/i.test((err as Error).message)) throw err;
      await recycleWorker();
      return attempt();
    }
  });
}

/** Libera um conjunto que nao sera mais usado (varredura retroativa). */
export function dropFromWorker(key: string): Promise<void> {
  return inTurn(async () => {
    loadedVersions.delete(key);
    if (worker) await call({ type: 'drop', key });
  });
}

const FILE_TYPES: Record<string, string> = { pe: 'EXE', elf: 'ELF', macho: 'MACH-O', rtf: 'RTF' };
const SCRIPT_TYPES: Record<string, string> = {
  powershell: 'PowerShell',
  vbscript: 'VBS',
  batch: 'BATCH',
};

/** Variaveis da amostra para as regras (item 147): so o que o DeepLook sabe de verdade. */
export function scanContextOf(entry: {
  originalFilename: string | null;
  staticInfo?: unknown;
}): ScanContext {
  const filename = (entry.originalFilename ?? '').split(/[\\/]/).pop() ?? '';
  const dot = filename.lastIndexOf('.');
  const info = (entry.staticInfo ?? {}) as {
    detectedType?: { id?: string } | null;
    script?: { language?: string } | null;
  };
  return {
    filename,
    filepath: '',
    extension: dot > 0 ? filename.slice(dot).toLowerCase() : '',
    filetype:
      SCRIPT_TYPES[info.script?.language ?? ''] ?? FILE_TYPES[info.detectedType?.id ?? ''] ?? '',
    owner: '',
  };
}

/**
 * Varre com as regras ativas, cada uma no proprio namespace (dois analistas podem
 * usar o mesmo identificador). A thread recompila so quando as regras mudam; o
 * texto das regras so sai do banco nesse caso.
 */
export async function scanWithYara(
  buffer: Uint8Array,
  context?: ScanContext,
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
    buffer,
    context,
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
    const entry = await prisma.entry.findUnique({
      where: { id: entryId },
      select: { storageKey: true, bucket: true, originalFilename: true, staticInfo: true },
    });
    if (!entry) throw new Error('amostra não encontrada');
    let content = buffer;
    if (!content) {
      if (!entry.storageKey) throw new Error('arquivo indisponível');
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: entry.bucket || env.S3_BUCKET, Key: entry.storageKey }),
      );
      content = Buffer.from(await obj.Body!.transformToByteArray());
    }
    const { hits, rulesCount } = await scanWithYara(content, scanContextOf(entry));
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
