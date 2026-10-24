import data from './attack-enterprise.json';

/**
 * MITRE ATT&CK Enterprise embutido (item 59): tecnicas e subtecnicas sem as
 * revogadas/obsoletas, extraidas de github.com/mitre-attack/attack-stix-data.
 * Nada e buscado fora em tempo de execucao.
 *
 * ATT&CK® e marca registrada da The MITRE Corporation; conteudo (c) MITRE,
 * usado conforme os termos de uso do ATT&CK.
 */
export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
}

export const ATTACK: {
  version: string;
  tactics: { id: string; name: string }[];
  techniques: AttackTechnique[];
} = data;

const BY_ID = new Map(ATTACK.techniques.map((t) => [t.id, t]));

export const TECHNIQUE_ID = /^T\d{4}(\.\d{3})?$/;

export function findTechnique(id: string): AttackTechnique | undefined {
  return BY_ID.get(id.toUpperCase());
}

/** A tecnica e as subtecnicas dela (filtro "T1566" acha tambem "T1566.001"). */
export function withSubtechniques(id: string): string[] {
  const base = id.toUpperCase();
  if (base.includes('.')) return [base];
  return [base, ...ATTACK.techniques.filter((t) => t.id.startsWith(`${base}.`)).map((t) => t.id)];
}

/** Normaliza (maiusculas, sem repetir, na ordem do ATT&CK). */
export function normalizeTechniques(ids: string[]): string[] {
  const set = new Set(ids.map((id) => id.trim().toUpperCase()));
  return ATTACK.techniques.filter((t) => set.has(t.id)).map((t) => t.id);
}
