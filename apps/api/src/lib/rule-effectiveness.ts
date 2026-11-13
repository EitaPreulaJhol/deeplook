import { prisma } from './prisma';

/**
 * Eficacia das regras de triagem e YARA (plano pos-revisao, item 2.3): nos ultimos dias, em quantas
 * amostras cada regra disparou e quantas delas terminaram com o veredito Limpo. Regra que dispara
 * muito em amostra limpa pede ajuste; regra que nunca dispara pode estar quebrada. Calculado a cada
 * pedido, sem tabela propria; amostras na lixeira ficam de fora.
 */
export const EFFECTIVENESS_DAYS = 90;

export interface Effectiveness {
  /** Amostras em que a regra disparou. */
  fired: number;
  /** Dessas, as que terminaram com o veredito Limpo. */
  clean: number;
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * YARA, por nome do conjunto (YaraRule.name): o que a varredura mais recente de cada amostra
 * encontrou (YaraScan.matches), varrida dentro do periodo.
 */
export async function yaraEffectiveness(
  days = EFFECTIVENESS_DAYS,
): Promise<Map<string, Effectiveness>> {
  const rows = await prisma.$queryRaw<{ rule: string; fired: number; clean: number }[]>`
    SELECT m->>'rule' AS rule,
           COUNT(DISTINCT s."entryId")::int AS fired,
           COUNT(DISTINCT s."entryId") FILTER (WHERE e.verdict = 'CLEAN')::int AS clean
      FROM "YaraScan" s
      JOIN "Entry" e ON e.id = s."entryId"
      CROSS JOIN LATERAL jsonb_array_elements(s.matches) AS m
     WHERE s.status = 'MATCHED'
       AND s."scannedAt" >= ${since(days)}
       AND e."deletedAt" IS NULL
     GROUP BY 1`;
  return new Map(rows.map((r) => [r.rule, { fired: r.fired, clean: r.clean }]));
}

/**
 * Triagem, por id da regra: os eventos TRIAGE_RULE do historico (a regra mudou tags ou prioridade
 * da amostra). O id vai no `fromValue` desde o item 2.3; os eventos de antes so tem o nome
 * (`toValue`) e contam para a regra que ainda tem aquele nome.
 */
export async function triageEffectiveness(
  rules: { id: string; name: string }[],
  days = EFFECTIVENESS_DAYS,
): Promise<Map<string, Effectiveness>> {
  const rows = await prisma.$queryRaw<
    { id: string | null; name: string | null; fired: number; clean: number }[]
  >`
    SELECT ev."fromValue" AS id,
           ev."toValue" AS name,
           COUNT(DISTINCT ev."entryId")::int AS fired,
           COUNT(DISTINCT ev."entryId") FILTER (WHERE e.verdict = 'CLEAN')::int AS clean
      FROM "EntryEvent" ev
      JOIN "Entry" e ON e.id = ev."entryId"
     WHERE ev.type = 'TRIAGE_RULE'
       AND ev."createdAt" >= ${since(days)}
       AND e."deletedAt" IS NULL
     GROUP BY 1, 2`;
  const result = new Map<string, Effectiveness>(rules.map((r) => [r.id, { fired: 0, clean: 0 }]));
  for (const row of rows) {
    const rule = row.id
      ? rules.find((r) => r.id === row.id)
      : rules.find((r) => r.name === row.name);
    const stats = rule && result.get(rule.id);
    if (!stats) continue;
    stats.fired += row.fired;
    stats.clean += row.clean;
  }
  return result;
}
