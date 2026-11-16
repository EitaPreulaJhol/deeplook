import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { log, reason } from './log';
import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';
import { compileSigma, type SigmaEvent, type SigmaRule, SigmaUnsupported } from './sigma';

/**
 * As regras Sigma vendorizadas (apps/api/sigma; plans/novas-analises, item 1), compiladas uma vez,
 * na primeira avaliacao. O manifesto (scripts/vendor-sigma.mjs) diz a release, a licenca e o que
 * ficou de fora; regra que nao compila aqui (nao deveria: o vendor ja confere) vai para o log.
 *
 * Regras da equipe e regras vendorizadas desligadas (plans/caca-e-formatos, item 1): as da equipe
 * vem do banco (SigmaRule), com o id "team:<id>" no lugar do id do YAML; as vendorizadas desligadas
 * ficam na configuracao "sigmaDisabled". reloadSigmaConfig() rele as duas depois de cada mudanca.
 */

/** Prefixo do id das regras da equipe nas deteccoes. */
export const TEAM_PREFIX = 'team:';
const DISABLED_SETTING = 'sigmaDisabled';

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

interface Config {
  team: Loaded;
  /** id do banco -> regra compilada (as ligadas). */
  teamById: Map<string, SigmaRule>;
  disabled: Set<string>;
}
let config: Config = {
  team: build(null, []),
  teamById: new Map(),
  disabled: new Set(),
};

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
  return { ...buildCompiled(rules), manifest, failed };
}

function buildCompiled(rules: SigmaRule[]): Loaded {
  const byEvent = new Map<number, SigmaRule[]>();
  const anyEvent: SigmaRule[] = [];
  for (const rule of rules) {
    if (!rule.eventIds.length) anyEvent.push(rule);
    for (const id of rule.eventIds) byEvent.set(id, [...(byEvent.get(id) ?? []), rule]);
  }
  return {
    manifest: null,
    rules,
    byId: new Map(rules.map((r) => [r.id, r])),
    byEvent,
    anyEvent,
    failed: [],
  };
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

/** A regra pelo id das deteccoes (a vendorizada pelo id do YAML; a da equipe por "team:<id>"). */
export const sigmaRule = (id: string): SigmaRule | undefined =>
  isTeamRule(id) ? config.team.byId.get(id) : load().byId.get(id);

/** As regras que casam com um evento: as vendorizadas ligadas e as da equipe ligadas. */
export function matchSigma(event: SigmaEvent): SigmaRule[] {
  const { byEvent, anyEvent } = load();
  const { team, disabled } = config;
  const candidates = [
    ...(byEvent.get(event.eventId) ?? []),
    ...anyEvent,
    ...(team.byEvent.get(event.eventId) ?? []),
    ...team.anyEvent,
  ];
  return candidates.filter((rule) => !disabled.has(rule.id) && safeMatch(rule, event));
}

export function safeMatch(rule: SigmaRule, event: SigmaEvent): boolean {
  try {
    return rule.match(event);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ equipe e desligadas

export const isTeamRule = (ruleId: string) => ruleId.startsWith(TEAM_PREFIX);

/** Compila o YAML de uma regra da equipe com o id das deteccoes. */
export function compileTeamRule(source: string, dbId: string): SigmaRule {
  return { ...compileSigma(source, `${TEAM_PREFIX}${dbId}`), id: `${TEAM_PREFIX}${dbId}` };
}

/** Rele as regras da equipe (ligadas) e as vendorizadas desligadas. */
export async function reloadSigmaConfig(): Promise<void> {
  const [rows, stored] = await Promise.all([
    prisma.sigmaRule.findMany({ where: { enabled: true }, select: { id: true, source: true } }),
    readSetting(DISABLED_SETTING) as Promise<{ ids?: string[] } | null>,
  ]);
  const rules: SigmaRule[] = [];
  for (const row of rows) {
    try {
      rules.push(compileTeamRule(row.source, row.id));
    } catch (err) {
      // Validada ao salvar; so falha se o compilador mudou entre versoes.
      log.warn(`[sigma] regra da equipe ${row.id} não compila: ${reason(err)}`);
    }
  }
  const team = buildCompiled(rules);
  config = {
    team,
    teamById: new Map(rules.map((r) => [r.id.slice(TEAM_PREFIX.length), r])),
    disabled: new Set(stored?.ids ?? []),
  };
}

/** Liga ou desliga uma regra vendorizada (pelo id do YAML). */
export async function setVendoredEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const stored = ((await readSetting(DISABLED_SETTING)) as { ids?: string[] } | null)?.ids ?? [];
  const ids = new Set(stored);
  if (enabled) ids.delete(ruleId);
  else ids.add(ruleId);
  await writeSetting(DISABLED_SETTING, { ids: [...ids].sort() });
  await reloadSigmaConfig();
}

export const sigmaDisabled = (): ReadonlySet<string> => config.disabled;

/** Quantas regras valem agora: as vendorizadas ligadas e as da equipe ligadas. */
export function activeSigmaCount(): { vendored: number; team: number } {
  const { rules } = load();
  return {
    vendored: rules.filter((r) => !config.disabled.has(r.id)).length,
    team: config.team.rules.length,
  };
}

/** A regra da equipe ligada, pelo id do banco. */
export const teamSigmaRule = (dbId: string): SigmaRule | undefined => config.teamById.get(dbId);

/** Link da regra no repositorio de origem, na versao vendorizada. */
export function sigmaRuleUrl(rule: Pick<SigmaRule, 'path'>): string | null {
  const manifest = load().manifest;
  if (!manifest || isTeamRule(rule.path)) return null;
  return `${manifest.url}/blob/${encodeURIComponent(manifest.release)}/${rule.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
