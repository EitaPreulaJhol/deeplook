import type { Verdict } from '../generated/prisma/client';
import { capaRisky } from './capa-risk';
import { prisma } from './prisma';
import { SERVICE_NAMES, type ServiceId } from './reputation';
import { type Facts, loadFacts } from './triage-rules';

/**
 * Pontuacao de risco explicavel (item 7.5 do plano; revisao de novembro, 3.1). Junta o que as
 * analises ja disseram (antivirus, YARA, reputacao, PE, capa, FLOSS, documento, script, atalho,
 * dominio parecido) numa nota de 0 a 100, com a lista dos motivos e o peso de cada um.
 *
 * E uma sugestao para quem tria, nao um veredito: a nota so soma evidencias de que a amostra e
 * ruim. Nota baixa quer dizer "nada foi encontrado", nunca "e segura", e por isso a sugestao
 * nunca e CLEAN. Quem decide continua sendo o analista.
 *
 * Os pesos sao fixos e ficam aqui, a vista: cada motivo aparece na ficha com o peso que teve.
 * Cada origem tem um teto, para vinte alertas da mesma analise nao valerem mais do que um
 * antivirus e uma regra YARA juntos.
 */

export type RiskReason = {
  /** De onde veio: o nome da analise, como a ficha a chama. */
  source: string;
  text: string;
  /** Pontos somados (negativo = atenuante). */
  weight: number;
};

export type RiskScore = {
  /** 0 a 100. */
  score: number;
  level: 'high' | 'medium' | 'low';
  /** MALICIOUS, SUSPICIOUS ou null (sem sugestao). Nunca CLEAN. */
  suggestedVerdict: Extract<Verdict, 'MALICIOUS' | 'SUSPICIOUS'> | null;
  reasons: RiskReason[];
  /** Analises ainda em andamento: a nota pode subir quando terminarem. */
  pending: string[];
};

export type RiskInputs = {
  facts: Facts;
  reputation: { service: string; verdict: Verdict; summary: string }[];
  /** Assinatura Authenticode conferida e valida. */
  signedValid: boolean;
  scriptRisk: string | null;
  documentRisk: string | null;
  pending: string[];
};

/** A partir destas notas a sugestao muda. */
export const RISK_MALICIOUS = 70;
export const RISK_SUSPICIOUS = 35;

const list = (items: string[], max = 3) =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} e mais ${items.length - max}`
    : items.join(', ');

/** A nota e os motivos, a partir dos sinais. Pura: os testes a chamam direto. */
export function scoreRisk(input: RiskInputs): RiskScore {
  const { facts } = input;
  const reasons: RiskReason[] = [];
  const add = (source: string, text: string, weight: number) => {
    if (weight !== 0) reasons.push({ source, text, weight });
  };

  if (facts.antivirus !== null) {
    add('Antivírus', `o ClamAV detectou ${facts.antivirus || 'uma ameaça'}`, 60);
  }

  const yara = [...new Set(facts.yara)];
  if (yara.length) {
    add(
      'YARA',
      `${yara.length} conjunto(s) de regras casaram: ${list(yara)}`,
      Math.min(50, 35 + (yara.length - 1) * 5),
    );
  }

  // Reputacao: o pior veredito conta uma vez (os servicos costumam repetir a mesma fonte).
  const named = (r: { service: string }) => SERVICE_NAMES[r.service as ServiceId] ?? r.service;
  const bad = input.reputation.filter((r) => r.verdict === 'MALICIOUS');
  const odd = input.reputation.filter((r) => r.verdict === 'SUSPICIOUS');
  const good = input.reputation.filter((r) => r.verdict === 'CLEAN');
  if (bad.length) add('Reputação externa', `malicioso em ${list(bad.map(named))}`, 60);
  else if (odd.length) add('Reputação externa', `suspeito em ${list(odd.map(named))}`, 25);
  else if (good.length) add('Reputação externa', `limpo em ${list(good.map(named))}`, -10);

  if (facts.disguised) {
    add('Tipo do arquivo', 'executável ou script disfarçado com outra extensão', 30);
  }
  if (input.scriptRisk === 'high') add('Script', 'comportamento de alto risco no script', 35);
  else if (input.scriptRisk === 'medium')
    add('Script', 'comportamento de risco médio no script', 15);
  if (input.documentRisk === 'high') add('Documento', 'documento de alto risco', 35);
  else if (facts.macro) add('Documento', 'contém macros VBA', 15);
  else if (input.documentRisk === 'medium') add('Documento', 'documento de risco médio', 10);
  if (facts.lnk) add('Atalho', 'atalho (.lnk) com alertas', 25);
  // oletools (revisao 3.2): o que o parser em TypeScript nao ve (MacroRaptor, XLM 4.0, stomping).
  const office = facts.officeAlerts.filter((a) => a.level === 'high');
  if (office.length) {
    add(
      'Documento (oletools)',
      list(
        office.map((a) => a.text.replace(/[.:].*$/, '')),
        2,
      ),
      Math.min(30, office.length * 15),
    );
  }

  if (facts.lookalikes.length) {
    add('Domínio parecido', `imita ${list([...new Set(facts.lookalikes)])}`, 35);
  }

  const highAlerts = facts.peAlerts.filter((a) => a.level === 'high');
  const mediumAlerts = facts.peAlerts.filter((a) => a.level === 'medium');
  if (highAlerts.length) {
    add(
      'Executável',
      `${highAlerts.length} alerta(s) alto(s): ${list(
        highAlerts.map((a) => a.text),
        2,
      )}`,
      Math.min(30, highAlerts.length * 12),
    );
  }
  if (mediumAlerts.length) {
    add(
      'Executável',
      `${mediumAlerts.length} alerta(s) médio(s)`,
      Math.min(12, mediumAlerts.length * 4),
    );
  }
  if (facts.signatureInvalid) add('Assinatura', 'assinatura digital que não confere', 20);
  else if (input.signedValid) add('Assinatura', 'assinatura digital válida', -15);

  const packers = facts.die.filter((d) => ['packer', 'protector'].includes(d.type.toLowerCase()));
  if (facts.packer || packers.length) {
    add('Empacotamento', `empacotado ou protegido (${facts.packer ?? packers[0].string})`, 10);
  }

  // Capacidades de risco do capa, por grupo: dez regras de "communication" contam uma vez.
  const groups = [
    ...new Set(
      facts.capaRules.filter((r) => capaRisky(r.namespace)).map((r) => r.namespace.split('/')[0]),
    ),
  ];
  if (groups.length) {
    add(
      'Análise de funções',
      `capacidades de risco: ${list(groups, 4)}`,
      Math.min(30, groups.length * 6),
    );
  }
  if (facts.hiddenIocs.length) {
    add('Análise de funções', `${facts.hiddenIocs.length} indicador(es) em strings ofuscadas`, 10);
  }

  reasons.sort((a, b) => b.weight - a.weight);
  const score = Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, r) => sum + r.weight, 0),
    ),
  );
  return {
    score,
    level: score >= RISK_MALICIOUS ? 'high' : score >= RISK_SUSPICIOUS ? 'medium' : 'low',
    suggestedVerdict:
      score >= RISK_MALICIOUS ? 'MALICIOUS' : score >= RISK_SUSPICIOUS ? 'SUSPICIOUS' : null,
    reasons,
    pending: input.pending,
  };
}

/** A nota de uma amostra, com o que as analises ja gravaram. Null se ela nao existe. */
export async function riskOf(entryId: string): Promise<RiskScore | null> {
  const loaded = await loadFacts(entryId);
  if (!loaded) return null;
  const { facts, entry } = loaded;
  const reputation = await prisma.reputationResult.findMany({
    where: { entryId },
    select: { service: true, verdict: true, summary: true, status: true },
  });
  const st = (entry.staticInfo ?? {}) as {
    script?: { risk?: string } | null;
    document?: { risk?: string } | null;
    pe?: {
      signature?: {
        signatureValid?: boolean;
        digestMatches?: boolean | null;
        error?: string;
      } | null;
    } | null;
  };
  const sig = st.pe?.signature;
  const pending = [
    entry.antivirus?.status === 'PENDING' && 'antivírus',
    entry.yara?.status === 'PENDING' && 'YARA',
    entry.capaAnalysis &&
      ['PENDING', 'RUNNING'].includes(entry.capaAnalysis.status) &&
      'análise de funções',
    entry.officeAnalysis &&
      ['PENDING', 'RUNNING'].includes(entry.officeAnalysis.status) &&
      'análise do documento',
    reputation.some((r) => r.status === 'PENDING') && 'reputação externa',
  ].filter((name): name is string => Boolean(name));
  return scoreRisk({
    facts,
    reputation: reputation.filter((r) => r.status === 'FOUND'),
    signedValid: Boolean(sig && !sig.error && sig.signatureValid && sig.digestMatches !== false),
    scriptRisk: st.script?.risk ?? null,
    documentRisk: st.document?.risk ?? null,
    pending,
  });
}
