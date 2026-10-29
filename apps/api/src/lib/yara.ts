import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Compiler, initSync, type Rules } from '@virustotal/yara-x';

import { env } from '../env';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from './prisma';
import { s3 } from './s3';
import { applyTriageRulesQuietly } from './triage-rules';

/**
 * Regras YARA (item 56) com o YARA-X oficial do VirusTotal (WebAssembly, sem
 * binario nativo). As regras sao validadas antes de salvar e aplicadas a cada
 * arquivo enviado; nada e executado, so os bytes sao lidos.
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

/** Valida uma regra sozinha; devolve as mensagens de erro do compilador (vazio = ok). */
export function validateRule(source: string): { errors: string[]; warnings: string[] } {
  init();
  const compiler = new Compiler();
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

interface CompiledSet {
  version: string;
  rules: Rules;
  /** namespace (id da regra) -> nome exibido */
  names: Map<string, string>;
  count: number;
}

let cache: CompiledSet | null = null;

/**
 * Regras ativas compiladas juntas, cada uma no proprio namespace (dois
 * analistas podem usar o mesmo identificador). Recompila so quando mudam.
 */
async function compiledRules(): Promise<CompiledSet | null> {
  const active = await prisma.yaraRule.findMany({
    where: { enabled: true },
    select: { id: true, name: true, source: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });
  const version = createHash('sha256')
    .update(active.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).join('|'))
    .digest('hex')
    .slice(0, 16);
  if (cache?.version === version) return cache;
  cache?.rules.free();
  cache = null;
  if (active.length === 0) return null;
  cache = { version, ...compileRuleSets(active) };
  return cache;
}

/**
 * Compila conjuntos de regras juntos, cada um no proprio namespace (`r_<id>`).
 * Conjunto que deixou de compilar (ex.: mudanca do motor) nao derruba os outros.
 * Quem chama libera `rules` com `.free()` quando nao precisar mais.
 */
export function compileRuleSets(sets: { id: string; name: string; source: string }[]): {
  rules: Rules;
  names: Map<string, string>;
  count: number;
} {
  init();
  const compiler = new Compiler();
  const names = new Map<string, string>();
  for (const rule of sets) {
    try {
      compiler.newNamespace(`r_${rule.id}`);
      compiler.addSource(rule.source);
      names.set(`r_${rule.id}`, rule.name);
    } catch {
      /* ignorada; a tela mostra o erro ao editar */
    }
  }
  const rules = compiler.build();
  compiler.free();
  return { rules, names, count: names.size };
}

export interface YaraHit {
  rule: string;
  identifier: string;
  tags: string[];
  description: string | null;
  matches: number;
}

/** Varre o conteudo com as regras ativas. */
export async function scanWithYara(
  buffer: Buffer,
): Promise<{ hits: YaraHit[]; rulesCount: number; version: string | null }> {
  const set = await compiledRules();
  if (!set) return { hits: [], rulesCount: 0, version: null };
  return { hits: scanBuffer(set, buffer), rulesCount: set.count, version: set.version };
}

/** Varre o conteudo com regras ja compiladas (limites de tempo e de ocorrencias). */
export function scanBuffer(
  set: { rules: Rules; names: Map<string, string> },
  buffer: Buffer,
): YaraHit[] {
  const scanner = set.rules.scanner();
  scanner.setTimeoutMs(SCAN_TIMEOUT_MS);
  scanner.setMaxMatchesPerPattern(MAX_MATCHES_PER_PATTERN);
  try {
    const result = scanner.scan(new Uint8Array(buffer)) as {
      matches: {
        identifier: string;
        namespace: string;
        tags: string[];
        metadata: { identifier: string; value: unknown }[];
        patterns: { matches: unknown[] }[];
      }[];
    };
    return result.matches.map((m) => ({
      rule: set.names.get(m.namespace) ?? m.identifier,
      identifier: m.identifier,
      tags: m.tags,
      description:
        (m.metadata.find((x) => x.identifier === 'description')?.value as string | undefined) ??
        null,
      matches: m.patterns.reduce((n, p) => n + p.matches.length, 0),
    }));
  } finally {
    scanner.free();
  }
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
  void prisma.yaraRule
    .count({ where: { enabled: true } })
    .then((n) => (n ? yaraScanEntry(entryId, buffer) : undefined))
    .catch((err) => log.error({ err }, '[yara] falha'));
}
