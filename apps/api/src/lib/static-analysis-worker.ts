import { parentPort } from 'node:worker_threads';

import { analyzeDiskImage } from './disk-image';
import { analyzeBuffer } from './static-analysis';

/**
 * Thread da analise estatica: arquivo hostil pode custar caro em qualquer parser, e na
 * thread principal isso trava a API para todo mundo (ou derruba, se acabar a memoria).
 */
parentPort!.on(
  'message',
  ({
    id,
    op,
    content,
    filename,
  }: {
    id: number;
    op: 'analyze' | 'disk';
    content: Uint8Array;
    filename?: string | null;
  }) => {
    try {
      const buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
      const result = op === 'disk' ? analyzeDiskImage(buf) : analyzeBuffer(buf, filename);
      parentPort!.postMessage({ id, result });
    } catch (err) {
      parentPort!.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  },
);
