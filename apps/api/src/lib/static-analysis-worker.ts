import { parentPort } from 'node:worker_threads';

import { analyzeBuffer } from './static-analysis';

/**
 * Thread da analise estatica: arquivo hostil pode custar caro em qualquer parser, e na
 * thread principal isso trava a API para todo mundo (ou derruba, se acabar a memoria).
 */
parentPort!.on(
  'message',
  ({ id, content, filename }: { id: number; content: Uint8Array; filename?: string | null }) => {
    try {
      const buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
      parentPort!.postMessage({ id, result: analyzeBuffer(buf, filename) });
    } catch (err) {
      parentPort!.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  },
);
