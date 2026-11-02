import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { DiskImageInfo } from './disk-image';
import type { StaticInfo } from './static-analysis';

/** Passou disso, a thread e trocada e a amostra fica sem analise (o envio segue). */
const TIMEOUT_MS = 60_000;
/** Heap da thread: ao estourar, cai so ela. Cabe um arquivo de 200 MB lido como texto. */
const MAX_HEAP_MB = 1536;

let worker: Worker | null = null;
let nextId = 0;
let workerRestarts = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Para os testes: quantas vezes a thread caiu ou foi trocada. */
export const analysisWorkerRestarts = () => workerRestarts;

function analysisWorker(): Worker {
  if (worker) return worker;
  // Em dist roda o .js; nos testes, o .ts (o tsx passa para a thread pelo execArgv).
  const created = new Worker(join(__dirname, `static-analysis-worker${__filename.slice(-3)}`), {
    resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB },
  });
  created.unref();
  created.on('message', (m: { id: number; result?: unknown; error?: string }) => {
    const pending = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error !== undefined) pending?.reject(new Error(m.error));
    else pending?.resolve(m.result!);
  });
  // Thread caiu: o que estava em andamento falha, e a proxima chamada sobe outra.
  const lost = (err: Error) => {
    if (worker !== created) return;
    worker = null;
    workerRestarts += 1;
    for (const pending of waiting.values()) pending.reject(err);
    waiting.clear();
  };
  created.on('error', lost);
  created.on('exit', () => lost(new Error('a thread de análise terminou')));
  worker = created;
  return created;
}

// Uma de cada vez: cada arquivo so e copiado para a thread quando chega a vez dele.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Trabalho mandado para a thread: a analise de um envio ou a listagem de uma imagem. */
type Op = 'analyze' | 'disk';

function inThread<T>(op: Op, buf: Buffer, filename: string | null | undefined, timeoutMs: number) {
  return inTurn(
    () =>
      new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        const current = analysisWorker();
        const timer = setTimeout(() => {
          // Ja fora de `worker`: a proxima da fila nao pode cair na thread que esta saindo.
          worker = null;
          workerRestarts += 1;
          waiting.delete(id);
          void current.terminate();
          reject(new Error('tempo-limite da análise'));
        }, timeoutMs);
        const settle =
          <V>(fn: (v: V) => void) =>
          (v: V) => {
            clearTimeout(timer);
            fn(v);
          };
        waiting.set(id, {
          resolve: settle(resolve as (v: unknown) => void),
          reject: settle(reject),
        });
        // A copia vai transferida: o envio ainda usa o buffer original.
        const content = new Uint8Array(buf);
        current.postMessage({ id, op, content, filename }, [content.buffer]);
      }),
  );
}

/** Analise estatica fora da thread principal. Rejeita se a thread cair ou passar do tempo. */
export function analyzeInThread(
  buf: Buffer,
  filename?: string | null,
  timeoutMs = TIMEOUT_MS,
): Promise<StaticInfo> {
  return inThread<StaticInfo>('analyze', buf, filename, timeoutMs);
}

/** Listagem da imagem de disco (item 163), que a extracao fazia na thread principal. */
export function diskImageInThread(
  buf: Buffer,
  timeoutMs = TIMEOUT_MS,
): Promise<DiskImageInfo | null> {
  return inThread<DiskImageInfo | null>('disk', buf, null, timeoutMs);
}
