// Dados do AVclass (MIT, malicialab/avclass), gerados por scripts/vendor-avclass.mjs.
import DATA from './avclass.json';

/**
 * Familia por consenso dos antivirus (plans/analise-estatica-ampliada, item 6): o AVclass, portado
 * do common.py original. Cada rotulo e quebrado em trechos, sem os genericos ("trojan", "generic",
 * "agent"), sem o prefixo do hash da amostra e com os apelidos trocados pelo nome da taxonomia
 * ("autoruner" -> "autorun" e "vobfus"); cada trecho conta uma vez por antivirus, e so entra o que
 * dois ou mais antivirus dizem. A familia e a tag de categoria FAM mais votada; sem ela, o trecho
 * desconhecido da taxonomia (UNK) mais votado, como o AVclass faz.
 */

const TABLE = DATA as unknown as {
  taxonomy: Record<string, [string, string[]]>;
  tagging: Record<string, string[]>;
  expansion: Record<string, string[]>;
};

/** Antivirus cujo rotulo tem sufixo de variante depois do ultimo ponto (lista do AVclass). */
const SUFFIX_AVS = new Set([
  'Norman',
  'Avast',
  'Avira',
  'Kaspersky',
  'ESET-NOD32',
  'Fortinet',
  'Jiangmin',
  'Comodo',
  'GData',
  'Sophos',
  'TrendMicro-HouseCall',
  'TrendMicro',
  'NANO-Antivirus',
  'Microsoft',
]);

const category = (t: string) => TABLE.taxonomy[t]?.[0] ?? 'UNK';
const generic = (t: string) => category(t) === 'GEN';

function removeSuffixes(av: string, label: string): string {
  let out = label;
  if (SUFFIX_AVS.has(av))
    out = out.slice(0, out.lastIndexOf('.') >= 0 ? out.lastIndexOf('.') : undefined);
  if (av === 'AVG') {
    const at = out.lastIndexOf('.');
    if (at >= 0 && /^[A-Z0-9]+$/.test(out.slice(at + 1))) out = out.slice(0, at);
  }
  if (av === 'Agnitum') {
    const at = out.lastIndexOf('!');
    if (at >= 0) out = out.slice(0, at);
  }
  return out;
}

function labelTags(label: string, hashes: string[]): Set<string> {
  const tags = new Set<string>();
  for (const raw of label.split(/[^0-9a-zA-Z]/)) {
    const token = raw.toLowerCase().replace(/\d*$/, '');
    // Prefixo de hash da amostra (o vazio tambem casa, como no original).
    if (hashes.some((h) => h.slice(0, token.length) === token)) continue;
    if (generic(token)) continue;
    const dst = TABLE.tagging[token];
    if (dst) {
      for (const t of dst) if (!generic(t)) tags.add(t);
    } else if (token.length > 3) {
      tags.add(token);
    }
  }
  return tags;
}

function expand(tags: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tags) {
    out.add(t);
    for (const e of TABLE.expansion[t] ?? []) out.add(e);
    for (const p of TABLE.taxonomy[t]?.[1] ?? []) if (TABLE.taxonomy[p]) out.add(p);
  }
  return out;
}

export interface AvclassResult {
  /** Familia mais votada, ou null. */
  family: string | null;
  /** A familia nao esta na taxonomia (trecho desconhecido mais votado). */
  familyUnknown: boolean;
  /** Tags com dois ou mais votos, das mais votadas, com a categoria (FAM, CLASS, BEH, FILE...). */
  tags: { tag: string; category: string; votes: number }[];
  /** Antivirus com rotulo. */
  detections: number;
}

/** Os rotulos [antivirus, rotulo] de uma amostra; `hashes` sao o MD5, o SHA-1 e o SHA-256. */
export function avclass(labels: [string, string][], hashes: string[] = []): AvclassResult {
  const seen = new Set<string>();
  const votes = new Map<string, Set<string>>();
  const lowHashes = hashes.map((h) => h.toLowerCase());
  for (const [av, original] of labels) {
    if (!original) continue;
    let label = original;
    if (label.endsWith(' (B)')) label = label.slice(0, -4);
    if (label.startsWith('Malware.')) label = label.slice(8);
    if (seen.has(label)) continue;
    seen.add(label);
    for (const t of expand(labelTags(removeSuffixes(av, label), lowHashes))) {
      const set = votes.get(t) ?? new Set<string>();
      set.add(av);
      votes.set(t, set);
    }
  }
  const tags = [...votes.entries()]
    .map(([tag, avs]) => ({ tag, category: category(tag), votes: avs.size }))
    .filter((t) => t.votes > 1)
    // Mais votada primeiro; no empate, ordem alfabetica inversa, como o sorted(reverse) do original.
    .sort((a, b) => b.votes - a.votes || (a.tag < b.tag ? 1 : -1));
  const fam = tags.find((t) => t.category === 'FAM') ?? tags.find((t) => t.category === 'UNK');
  return {
    family: fam?.tag ?? null,
    familyUnknown: fam?.category === 'UNK',
    tags: tags.slice(0, 20),
    detections: labels.filter(([, l]) => l).length,
  };
}
