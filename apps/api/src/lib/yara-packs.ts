import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';

/**
 * Pacotes de regras YARA (itens 143 e 144): arquivos de fontes confiaveis guardados
 * no repositorio (apps/api/rules, ver scripts/vendor-yara-packs.mjs), um conjunto por
 * arquivo. Cada pacote instala uma vez so: o que o analista desligar ou excluir nao
 * volta. Desligar um pacote nao apaga nada, as regras so saem da varredura.
 */

export interface YaraPack {
  id: string;
  name: string;
  author: string;
  license: string;
  url: string;
  description: string;
  defaultEnabled: boolean;
  commit: string;
  commitDate: string;
  files: string[];
  excluded: { file: string; why: string }[];
  /** Regras ignoradas no resultado, por prefixo (item 147); o arquivo nao muda. */
  ignoreRules?: string[];
}

/** src/lib ou dist/lib -> apps/api/rules. */
const RULES_DIR = join(__dirname, '..', '..', 'rules');

let manifest: YaraPack[] | null = null;
export function yaraPacks(): YaraPack[] {
  manifest ??= JSON.parse(readFileSync(join(RULES_DIR, 'packs.json'), 'utf8')) as YaraPack[];
  return manifest;
}

interface PackState {
  /** Ligado ou desligado pela administracao; sem valor, vale o padrao do pacote. */
  enabled: Record<string, boolean>;
  installed: string[];
}

const STATE_KEY = 'yaraPacks';

async function packState(): Promise<PackState> {
  const stored = (await readSetting(STATE_KEY)) as Partial<PackState> | null;
  return { enabled: stored?.enabled ?? {}, installed: stored?.installed ?? [] };
}

const isOn = (pack: YaraPack, state: PackState) => state.enabled[pack.id] ?? pack.defaultEnabled;

/** Ids dos pacotes ligados (entram na varredura). */
export async function enabledYaraPacks(): Promise<string[]> {
  const state = await packState();
  return yaraPacks()
    .filter((p) => isOn(p, state))
    .map((p) => p.id);
}

/** Regras que entram na varredura: as da equipe e as dos pacotes ligados. */
export async function activeRulesWhere() {
  return {
    enabled: true,
    OR: [{ pack: null }, { pack: { in: await enabledYaraPacks() } }],
  };
}

async function install(pack: YaraPack, state: PackState) {
  const dir = join(RULES_DIR, pack.id);
  await prisma.yaraRule.createMany({
    data: pack.files.map((file) => ({
      name: `${pack.id}/${file.replace(/\.[^.]+$/, '')}`,
      source: readFileSync(join(dir, file), 'utf8'),
      pack: pack.id,
    })),
    // Nome ja usado por uma regra da equipe: a dela fica.
    skipDuplicates: true,
  });
  state.installed.push(pack.id);
}

/** Na subida: instala os pacotes ligados que ainda nao foram instalados. */
export async function installYaraPacks(): Promise<string[]> {
  const state = await packState();
  const missing = yaraPacks().filter((p) => isOn(p, state) && !state.installed.includes(p.id));
  for (const pack of missing) await install(pack, state);
  if (missing.length) await writeSetting(STATE_KEY, state);
  return missing.map((p) => p.id);
}

/** Liga ou desliga um pacote; ligar pela primeira vez instala as regras. */
export async function setYaraPackEnabled(id: string, enabled: boolean): Promise<boolean> {
  const pack = yaraPacks().find((p) => p.id === id);
  if (!pack) return false;
  const state = await packState();
  if (enabled && !state.installed.includes(id)) await install(pack, state);
  state.enabled[id] = enabled;
  await writeSetting(STATE_KEY, state);
  return true;
}

/** O que as telas mostram de cada pacote, com as regras instaladas e ativas. */
export async function yaraPackList() {
  const state = await packState();
  const counts = await prisma.yaraRule.groupBy({
    by: ['pack', 'enabled'],
    where: { pack: { not: null } },
    _count: { _all: true },
  });
  const count = (id: string, enabled?: boolean) =>
    counts
      .filter((c) => c.pack === id && (enabled === undefined || c.enabled === enabled))
      .reduce((n, c) => n + c._count._all, 0);
  return yaraPacks().map(({ files, excluded, ...pack }) => ({
    ...pack,
    enabled: isOn({ ...pack, files, excluded }, state),
    installed: state.installed.includes(pack.id),
    fileCount: files.length,
    excludedCount: excluded.length,
    rulesTotal: count(pack.id),
    rulesActive: count(pack.id, true),
  }));
}

/** Nome e autor por pacote, para a origem no resultado da varredura. */
export function yaraPackInfo(
  id: string | null,
): { name: string; author: string; ignoreRules?: string[] } | null {
  const pack = id ? yaraPacks().find((p) => p.id === id) : null;
  return pack ? { name: pack.name, author: pack.author, ignoreRules: pack.ignoreRules } : null;
}
