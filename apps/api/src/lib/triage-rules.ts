import type { Priority, TriageCondition } from '../generated/prisma/client';
import { recordEvent } from './events';
import { prisma } from './prisma';
import { PRIORITIES } from './sla';

/**
 * Tags e prioridade automaticas (item 86): regras "quando a analise achar X,
 * incluir as tags Y e subir a prioridade para Z". Todas as regras que casarem
 * valem. Roda na chegada (antes da atribuicao automatica) e de novo quando o
 * YARA e o antivirus terminam. Nunca tira tag nem baixa a prioridade.
 */

export const CONDITION_LABEL: Record<TriageCondition, string> = {
  DETECTED_TYPE: 'tipo real é',
  YARA: 'regra YARA casou',
  ANTIVIRUS: 'antivírus detectou',
  DOMAIN: 'domínio do link',
  SENDER: 'remetente do e-mail',
  MACRO: 'documento com macro',
  DISGUISED: 'executável disfarçado',
  SCRIPT_RISK: 'script com risco alto',
  DOCUMENT_RISK: 'documento com risco alto',
  LNK: 'atalho (.lnk) suspeito',
};

/** Condicoes que usam o campo "valor" (vazio = qualquer, onde fizer sentido). */
export const NEEDS_VALUE: TriageCondition[] = ['DETECTED_TYPE', 'DOMAIN', 'SENDER'];
export const OPTIONAL_VALUE: TriageCondition[] = ['YARA', 'ANTIVIRUS'];

/** "regra YARA casou (Emotet)" / "documento com macro". */
export function triageRuleLabel(rule: {
  condition: TriageCondition;
  value: string | null;
}): string {
  return rule.value
    ? `${CONDITION_LABEL[rule.condition]} ${rule.value}`
    : CONDITION_LABEL[rule.condition];
}

type Facts = {
  detectedType: string | null;
  urlDomain: string | null;
  sender: string | null;
  macro: boolean;
  disguised: boolean;
  scriptHigh: boolean;
  documentHigh: boolean;
  lnk: boolean;
  yara: string[];
  antivirus: string | null;
};

/** Dominio igual ou subdominio; ".top" casa o TLD. */
function domainMatches(domain: string | null, value: string): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  const v = value.toLowerCase().replace(/^\*\./, '.');
  return v.startsWith('.') ? d.endsWith(v) : d === v || d.endsWith(`.${v}`);
}

function matches(rule: { condition: TriageCondition; value: string | null }, f: Facts): boolean {
  const value = (rule.value ?? '').trim().toLowerCase();
  switch (rule.condition) {
    case 'DETECTED_TYPE':
      return Boolean(value) && f.detectedType?.toLowerCase() === value;
    case 'YARA':
      return f.yara.length > 0 && (!value || f.yara.some((r) => r.toLowerCase().includes(value)));
    case 'ANTIVIRUS':
      return f.antivirus !== null && (!value || f.antivirus.toLowerCase().includes(value));
    case 'DOMAIN':
      return Boolean(value) && domainMatches(f.urlDomain, value);
    case 'SENDER':
      if (!value || !f.sender) return false;
      return value.includes('@')
        ? f.sender.toLowerCase() === value
        : domainMatches(f.sender.split('@')[1] ?? null, value);
    case 'MACRO':
      return f.macro;
    case 'DISGUISED':
      return f.disguised;
    case 'SCRIPT_RISK':
      return f.scriptHigh;
    case 'DOCUMENT_RISK':
      return f.documentHigh;
    case 'LNK':
      return f.lnk;
  }
}

/** Aplica as regras ativas a amostra. Devolve os nomes das regras que mudaram algo. */
export async function applyTriageRules(entryId: string): Promise<string[]> {
  const rules = await prisma.triageRule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!rules.length) return [];
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: {
      priority: true,
      urlDomain: true,
      staticInfo: true,
      emailInfo: true,
      tags: { select: { name: true } },
      yara: { select: { status: true, matches: true } },
      antivirus: { select: { status: true, signature: true } },
    },
  });
  if (!entry) return [];
  const st = (entry.staticInfo ?? {}) as {
    detectedType?: { id?: string } | null;
    extensionMismatch?: { dangerous?: boolean } | null;
    document?: { risk?: string; office?: { modules?: unknown[] } | null } | null;
    script?: { risk?: string } | null;
    lnk?: { alerts?: string[] } | null;
  };
  const email = (entry.emailInfo ?? {}) as { from?: { address?: string | null } | null };
  const facts: Facts = {
    detectedType: st.detectedType?.id ?? null,
    urlDomain: entry.urlDomain,
    sender: email.from?.address ?? null,
    macro: (st.document?.office?.modules?.length ?? 0) > 0,
    disguised: Boolean(st.extensionMismatch?.dangerous),
    scriptHigh: st.script?.risk === 'high',
    documentHigh: st.document?.risk === 'high',
    lnk: (st.lnk?.alerts?.length ?? 0) > 0,
    yara:
      entry.yara?.status === 'MATCHED'
        ? ((entry.yara.matches ?? []) as { rule?: string }[])
            .map((m) => m.rule ?? '')
            .filter(Boolean)
        : [],
    antivirus: entry.antivirus?.status === 'INFECTED' ? (entry.antivirus.signature ?? '') : null,
  };

  const have = new Set(entry.tags.map((t) => t.name.toLowerCase()));
  let priority: Priority = entry.priority;
  const applied: { name: string; tags: string[]; priority: Priority | null }[] = [];
  for (const rule of rules) {
    if (!matches(rule, facts)) continue;
    const tags = rule.tags.map((t) => t.toLowerCase()).filter((t) => !have.has(t));
    tags.forEach((t) => have.add(t));
    // So sobe: P1 e o mais urgente.
    const raise =
      rule.priority && PRIORITIES.indexOf(rule.priority) < PRIORITIES.indexOf(priority)
        ? rule.priority
        : null;
    if (raise) priority = raise;
    if (tags.length || raise) applied.push({ name: rule.name, tags, priority: raise });
  }
  if (!applied.length) return [];

  const before = entry.priority;
  await prisma.$transaction(async (tx) => {
    const newTags = applied.flatMap((a) => a.tags);
    await tx.entry.update({
      where: { id: entryId },
      data: {
        ...(newTags.length && {
          tags: { connectOrCreate: newTags.map((name) => ({ where: { name }, create: { name } })) },
        }),
        ...(priority !== before && { priority }),
      },
    });
    for (const a of applied) {
      const parts = [
        a.tags.length ? `tags ${a.tags.join(', ')}` : '',
        a.priority ? `prioridade ${a.priority}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      await recordEvent(tx, {
        entryId,
        actorId: null,
        type: 'TRIAGE_RULE',
        toValue: a.name,
        detail: parts,
      });
    }
    if (priority !== before) {
      await recordEvent(tx, {
        entryId,
        actorId: null,
        type: 'PRIORITY_CHANGED',
        fromValue: before,
        toValue: priority,
        detail: 'regra de triagem',
      });
    }
  });
  return applied.map((a) => a.name);
}

/** Depois de uma varredura em segundo plano (YARA/antivirus): nunca lanca. */
export async function applyTriageRulesQuietly(entryId: string): Promise<void> {
  try {
    await applyTriageRules(entryId);
  } catch {
    /* regras sao um extra: nao derrubam a varredura */
  }
}
