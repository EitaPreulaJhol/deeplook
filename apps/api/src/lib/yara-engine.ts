import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Compiler, initSync, type Rules } from '@virustotal/yara-x';

/**
 * Motor YARA-X (WebAssembly), sem banco nem rede: usado pela thread de varredura
 * e para validar uma regra ao salvar. Nada e executado, so os bytes sao lidos.
 */

/** Tempo maximo de uma varredura (regras pesadas nao travam a API). */
const SCAN_TIMEOUT_MS = 10_000;
const MAX_MATCHES_PER_PATTERN = 100;

let ready = false;
function init() {
  if (ready) return;
  // O pacote e a versao "web" do wasm-bindgen: em Node o .wasm vem do disco.
  const wasm = join(dirname(require.resolve('@virustotal/yara-x')), 'yara_x_js_bg.wasm');
  initSync({ module: readFileSync(wasm) });
  ready = true;
}

/**
 * Variaveis externas que regras de terceiros usam (item 147). Vieram da varredura de
 * um disco: num envio nao ha pasta nem dono, entao `filepath` e `owner` ficam vazios.
 */
export interface ScanContext {
  filename: string;
  filepath: string;
  extension: string;
  filetype: string;
  owner: string;
}

const EMPTY_CONTEXT: ScanContext = {
  filename: '',
  filepath: '',
  extension: '',
  filetype: '',
  owner: '',
};

function defineGlobals(compiler: Compiler) {
  for (const [name, value] of Object.entries(EMPTY_CONTEXT)) compiler.defineGlobal(name, value);
}

/** Valida uma regra sozinha; devolve as mensagens de erro do compilador (vazio = ok). */
export function validateRule(source: string): { errors: string[]; warnings: string[] } {
  init();
  const compiler = new Compiler();
  defineGlobals(compiler);
  try {
    compiler.addSource(source);
  } catch (err) {
    const errors = compiler.errors.length ? compiler.errors : [String(err)];
    compiler.free();
    return { errors, warnings: [] };
  }
  const result = { errors: compiler.errors, warnings: compiler.warnings };
  if (!result.errors.length) {
    try {
      compiler.build().free();
    } catch (err) {
      result.errors = [String(err)];
    }
  }
  compiler.free();
  return result;
}

export interface RuleSet {
  id: string;
  name: string;
  source: string;
  /** Pacote de onde a regra veio (item 145); null nas regras da equipe. */
  pack?: { name: string; author: string; ignoreRules?: string[] } | null;
}

export interface YaraHit {
  rule: string;
  identifier: string;
  tags: string[];
  description: string | null;
  matches: number;
  /** Autor da regra, ou o do pacote se ela nao disser (item 145). */
  author: string | null;
  /** Nome do pacote; null nas regras da equipe. */
  pack: string | null;
}

export interface CompiledRules {
  rules: Rules;
  /** namespace (id da regra) -> conjunto */
  sets: Map<string, RuleSet>;
  count: number;
}

/**
 * Compila conjuntos de regras juntos, cada um no proprio namespace (`r_<id>`).
 * Conjunto que deixou de compilar (ex.: mudanca do motor) nao derruba os outros:
 * como o compilador guarda o erro e recusa o build, compila de novo sem ele.
 * Quem chama libera `rules` com `.free()` quando nao precisar mais.
 */
export function compileRuleSets(sets: RuleSet[]): CompiledRules {
  init();
  const attempt = (list: RuleSet[]) => {
    const compiler = new Compiler();
    defineGlobals(compiler);
    const failed = new Set<string>();
    for (const set of list) {
      compiler.newNamespace(`r_${set.id}`);
      try {
        compiler.addSource(set.source);
      } catch {
        failed.add(set.id);
      }
    }
    return { compiler, failed };
  };
  let { compiler, failed } = attempt(sets);
  let usable = sets;
  if (failed.size) {
    compiler.free();
    usable = sets.filter((s) => !failed.has(s.id));
    ({ compiler, failed } = attempt(usable));
  }
  const rules = compiler.build();
  compiler.free();
  return { rules, sets: new Map(usable.map((s) => [`r_${s.id}`, s])), count: usable.length };
}

/** Varre o conteudo com regras ja compiladas (limites de tempo e de ocorrencias). */
export function scanBuffer(
  compiled: CompiledRules,
  buffer: Uint8Array,
  context: ScanContext = EMPTY_CONTEXT,
): YaraHit[] {
  const scanner = compiled.rules.scanner();
  scanner.setTimeoutMs(SCAN_TIMEOUT_MS);
  scanner.setMaxMatchesPerPattern(MAX_MATCHES_PER_PATTERN);
  try {
    for (const [name, value] of Object.entries(context)) scanner.setGlobal(name, value);
    const result = scanner.scan(buffer) as {
      matches: {
        identifier: string;
        namespace: string;
        isPrivate: boolean;
        tags: string[];
        metadata: { identifier: string; value: unknown }[];
        patterns: { matches: unknown[] }[];
      }[];
    };
    // O YARA-X devolve tambem as privadas: sao pecas de outras regras, nao deteccoes.
    const ignored = (m: { namespace: string; identifier: string }) =>
      compiled.sets
        .get(m.namespace)
        ?.pack?.ignoreRules?.some((prefix) => m.identifier.startsWith(prefix));
    return result.matches
      .filter((m) => !m.isPrivate && !ignored(m))
      .map((m) => {
        const set = compiled.sets.get(m.namespace);
        const meta = (name: string) => m.metadata.find((x) => x.identifier === name)?.value;
        const author = meta('author');
        return {
          rule: set?.name ?? m.identifier,
          identifier: m.identifier,
          tags: m.tags,
          description: (meta('description') as string | undefined) ?? null,
          matches: m.patterns.reduce((n, p) => n + p.matches.length, 0),
          author: typeof author === 'string' && author ? author : (set?.pack?.author ?? null),
          pack: set?.pack?.name ?? null,
        };
      });
  } finally {
    scanner.free();
  }
}
