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
 *
 * Colecoes: a principal (core+), a de ameacas emergentes e a de caca. A de caca entra desligada
 * (a SigmaHQ diz que nao e para alertar): a regra dela que o analista ligar vai para "sigmaEnabled".
 */

/** Prefixo do id das regras da equipe nas deteccoes. */
export const TEAM_PREFIX = 'team:';
const DISABLED_SETTING = 'sigmaDisabled';
/** Regras de colecao desligada por padrao (caca) que o analista ligou. */
const ENABLED_SETTING = 'sigmaEnabled';

/** src/lib ou dist/lib -> apps/api/sigma. */
const SIGMA_DIR = join(__dirname, '..', '..', 'sigma');

export interface SigmaCollection {
  id: string;
  name: string;
  /** Pasta das regras no repositorio de origem (o caminho de cada regra comeca por ela). */
  folder: string;
  /** Pasta em apps/api/sigma. */
  dir: string;
  defaultEnabled: boolean;
  rules: number;
  files: string[];
  excluded: { file: string; why: string }[];
}

export interface SigmaManifest {
  id: string;
  name: string;
  author: string;
  license: string;
  url: string;
  release: string;
  rules: number;
  collections: SigmaCollection[];
}

interface Loaded {
  manifest: SigmaManifest | null;
  /** id da regra -> colecao. */
  collectionOf: Map<string, SigmaCollection>;
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
  enabled: Set<string>;
}
let config: Config = {
  team: build(null, []),
  teamById: new Map(),
  disabled: new Set(),
  enabled: new Set(),
};

/** Para os testes: outro conjunto de regras (YAML, caminho). */
export function setSigmaRulesForTests(sources: [yaml: string, path: string][] | null): void {
  loaded = sources ? build(null, sources) : null;
}

function build(
  manifest: SigmaManifest | null,
  sources: [yaml: string, path: string, collection?: SigmaCollection][],
): Loaded {
  const rules: SigmaRule[] = [];
  const collectionOf = new Map<string, SigmaCollection>();
  const failed: { file: string; why: string }[] = [];
  for (const [yaml, path, collection] of sources) {
    try {
      const rule = compileSigma(yaml, path);
      rules.push(rule);
      if (collection) collectionOf.set(rule.id, collection);
    } catch (err) {
      if (!(err instanceof SigmaUnsupported)) throw err;
      failed.push({ file: path, why: err.message });
    }
  }
  return { ...buildCompiled(rules), manifest, collectionOf, failed };
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
    collectionOf: new Map(),
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
  loaded = build(
    manifest,
    manifest.collections.flatMap((c) =>
      c.files.map(
        (f) =>
          [readFileSync(join(SIGMA_DIR, c.dir, f), 'utf8'), `${c.folder}/${f}`, c] as [
            string,
            string,
            SigmaCollection,
          ],
      ),
    ),
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

/** As colecoes, sem a lista de arquivos (telas). */
export function sigmaCollections(): Omit<SigmaCollection, 'files' | 'excluded' | 'dir'>[] {
  return (load().manifest?.collections ?? []).map(
    ({ files: _f, excluded: _e, dir: _d, ...collection }) => collection,
  );
}

/** A colecao de uma regra vendorizada (pelo id do YAML). */
export const sigmaCollectionOf = (ruleId: string): string | null =>
  load().collectionOf.get(ruleId)?.id ?? null;

/**
 * A regra vendorizada vale agora: nao foi desligada e, na colecao desligada por padrao (caca), foi
 * ligada. As da equipe desligadas nem carregam, entao valem sempre aqui.
 */
export function isSigmaRuleOn(ruleId: string): boolean {
  if (isTeamRule(ruleId)) return true;
  if (config.disabled.has(ruleId)) return false;
  return load().collectionOf.get(ruleId)?.defaultEnabled !== false || config.enabled.has(ruleId);
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
  const { team } = config;
  const candidates = [
    ...(byEvent.get(event.eventId) ?? []),
    ...anyEvent,
    ...(team.byEvent.get(event.eventId) ?? []),
    ...team.anyEvent,
  ];
  return candidates.filter((rule) => isSigmaRuleOn(rule.id) && safeMatch(rule, event));
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
  const [rows, stored, turnedOn] = await Promise.all([
    prisma.sigmaRule.findMany({ where: { enabled: true }, select: { id: true, source: true } }),
    readSetting(DISABLED_SETTING) as Promise<{ ids?: string[] } | null>,
    readSetting(ENABLED_SETTING) as Promise<{ ids?: string[] } | null>,
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
    enabled: new Set(turnedOn?.ids ?? []),
  };
}

const readIds = async (key: string) =>
  new Set(((await readSetting(key)) as { ids?: string[] } | null)?.ids ?? []);

/**
 * Liga ou desliga uma regra vendorizada (pelo id do YAML). Desligar vai para "sigmaDisabled"; ligar
 * uma da colecao desligada por padrao (caca) vai para "sigmaEnabled".
 */
export async function setVendoredEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const [off, on] = await Promise.all([readIds(DISABLED_SETTING), readIds(ENABLED_SETTING)]);
  const optIn = load().collectionOf.get(ruleId)?.defaultEnabled === false;
  if (enabled) {
    off.delete(ruleId);
    if (optIn) on.add(ruleId);
  } else {
    off.add(ruleId);
    on.delete(ruleId);
  }
  await writeSetting(DISABLED_SETTING, { ids: [...off].sort() });
  await writeSetting(ENABLED_SETTING, { ids: [...on].sort() });
  await reloadSigmaConfig();
}

/** Quantas regras valem agora: as vendorizadas ligadas e as da equipe ligadas. */
export function activeSigmaCount(): { vendored: number; team: number } {
  const { rules } = load();
  return {
    vendored: rules.filter((r) => isSigmaRuleOn(r.id)).length,
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
