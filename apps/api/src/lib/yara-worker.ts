import { parentPort } from 'node:worker_threads';

import { type CompiledRules, compileRuleSets, type RuleSet, scanBuffer } from './yara-engine';

/**
 * Thread da varredura YARA (item 146): compilar leva segundos e varrer um arquivo
 * grande tambem, e na thread principal isso trava a API para todo mundo.
 */
export type YaraRequest =
  | { type: 'load'; key: string; sets: RuleSet[] }
  | { type: 'scan'; key: string; content: Uint8Array }
  | { type: 'drop'; key: string };

const loaded = new Map<string, CompiledRules>();

function handle(request: YaraRequest): unknown {
  if (request.type === 'load') {
    loaded.get(request.key)?.rules.free();
    loaded.delete(request.key);
    if (!request.sets.length) return { count: 0 };
    const compiled = compileRuleSets(request.sets);
    loaded.set(request.key, compiled);
    return { count: compiled.count };
  }
  if (request.type === 'drop') {
    loaded.get(request.key)?.rules.free();
    loaded.delete(request.key);
    return {};
  }
  const compiled = loaded.get(request.key);
  if (!compiled) throw new Error('regras não carregadas');
  return { hits: scanBuffer(compiled, request.content) };
}

parentPort!.on('message', ({ id, request }: { id: number; request: YaraRequest }) => {
  try {
    parentPort!.postMessage({ id, result: handle(request) });
  } catch (err) {
    parentPort!.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
