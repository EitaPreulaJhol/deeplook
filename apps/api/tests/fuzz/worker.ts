// Thread que executa um alvo: se um parser entrar em laco, quem cai e ela, e o fuzzer anota.
import { parentPort } from 'node:worker_threads';

import { TARGETS } from './targets';

/** Resultado serializado acima disto e um achado (o banco guardaria isso por amostra). */
const MAX_RESULT = 8 * 1024 * 1024;
/** Tempo por caso acima do qual o parser e considerado lento demais para o tamanho da entrada. */
const SLOW_MS = Number(process.env.FUZZ_SLOW_MS || 1500);

parentPort!.on(
  'message',
  async ({ id, target, content }: { id: number; target: string; content: Uint8Array }) => {
    const spec = TARGETS[target];
    const buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    const started = performance.now();
    try {
      const result = await spec.run(buf);
      const size = JSON.stringify(result ?? null).length;
      const ms = Math.round(performance.now() - started);
      if (size > MAX_RESULT) parentPort!.postMessage({ id, finding: `resultado de ${size} bytes` });
      // Lento sem travar: o caso passa no teto do fuzzer, mas cada envio assim ocupa a thread de
      // analise da API por esse tempo.
      else if (ms > SLOW_MS)
        parentPort!.postMessage({ id, finding: `levou ${ms} ms (${buf.length} bytes)` });
      else parentPort!.postMessage({ id });
    } catch (err) {
      if (spec.expected(err)) parentPort!.postMessage({ id });
      else {
        const e = err as Error;
        parentPort!.postMessage({
          id,
          finding: `${e?.name ?? 'erro'}: ${e?.message ?? String(err)}`,
          stack: e?.stack,
        });
      }
    }
  },
);
