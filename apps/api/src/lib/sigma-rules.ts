import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compileSigma, type SigmaEvent, type SigmaRule, SigmaUnsupported } from './sigma';

/**
 * As regras Sigma vendorizadas (apps/api/sigma; plans/novas-analises, item 1), compiladas uma vez,
 * na primeira avaliacao. O manifesto (scripts/vendor-sigma.mjs) diz a release, a licenca e o que
 * ficou de fora; regra que nao compila aqui (nao deveria: o vendor ja confere) vai para o log.
 */

/** src/lib ou dist/lib -> apps/api/sigma. */
const SIGMA_DIR = join(__dirname, '..', '..', 'sigma');

export interface SigmaManifest {
  id: string;
  name: string;
  author: string;
  license: string;
  url: string;
  release: string;
  rules: number;
  files: string[];
  excluded: { file: string; why: string }[];
}

interface Loaded {
  manifest: SigmaManifest | null;
  rules: SigmaRule[];
  byId: Map<string, SigmaRule>;
  /** Regras por EventID; as sem EventID na logsource (service: sysmon) valem para todos. */
  byEvent: Map<number, SigmaRule[]>;
  anyEvent: SigmaRule[];
  failed: { file: string; why: string }[];
}

let loaded: Loaded | null = null;

/** Para os testes: outro conjunto de regras (YAML, caminho). */
export function setSigmaRulesForTests(sources: [yaml: string, path: string][] | null): void {
  loaded = sources ? build(null, sources) : null;
}

function build(manifest: SigmaManifest | null, sources: [string, string][]): Loaded {
  const rules: SigmaRule[] = [];
  const failed: { file: string; why: string }[] = [];
  for (const [yaml, path] of sources) {
    try {
      rules.push(compileSigma(yaml, path));
    } catch (err) {
      if (!(err instanceof SigmaUnsupported)) throw err;
      failed.push({ file: path, why: err.message });
    }
  }
  const byEvent = new Map<number, SigmaRule[]>();
  const anyEvent: SigmaRule[] = [];
  for (const rule of rules) {
    if (!rule.eventIds.length) anyEvent.push(rule);
    for (const id of rule.eventIds) byEvent.set(id, [...(byEvent.get(id) ?? []), rule]);
  }
  return { manifest, rules, byId: new Map(rules.map((r) => [r.id, r])), byEvent, anyEvent, failed };
}

function load(): Loaded {
  if (loaded) return loaded;
  const file = join(SIGMA_DIR, 'manifest.json');
  if (!existsSync(file)) {
    loaded = build(null, []);
    return loaded;
  }
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as SigmaManifest;
  const base = join(SIGMA_DIR, manifest.id);
  loaded = build(
    manifest,
    manifest.files.map((f) => [readFileSync(join(base, f), 'utf8'), `rules/windows/${f}`]),
  );
  return loaded;
}

/** As regras carregadas e o que nao compilou. */
export function sigmaRules(): { rules: SigmaRule[]; failed: { file: string; why: string }[] } {
  const { rules, failed } = load();
  return { rules, failed };
}

export function sigmaManifest(): SigmaManifest | null {
  return load().manifest;
}

/** Identifica o conjunto de regras: mudou, as sessoes sao avaliadas de novo. */
export function sigmaVersion(): string {
  const { manifest, rules } = load();
  return `${manifest?.id ?? 'teste'}@${manifest?.release ?? '-'}:${rules.length}`;
}

export const sigmaRule = (id: string): SigmaRule | undefined => load().byId.get(id);

/** As regras que casam com um evento. */
export function matchSigma(event: SigmaEvent): SigmaRule[] {
  const { byEvent, anyEvent } = load();
  const candidates = [...(byEvent.get(event.eventId) ?? []), ...anyEvent];
  return candidates.filter((rule) => {
    try {
      return rule.match(event);
    } catch {
      return false;
    }
  });
}

/** Link da regra no repositorio de origem, na versao vendorizada. */
export function sigmaRuleUrl(rule: Pick<SigmaRule, 'path'>): string | null {
  const manifest = load().manifest;
  if (!manifest) return null;
  return `${manifest.url}/blob/${encodeURIComponent(manifest.release)}/${rule.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
