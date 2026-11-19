import type { Verdict } from '../generated/prisma/client';
import { capaRisky } from './capa-risk';
import { configFamilies, type ConfigResult } from './config-extract';
import { localizeAlerts, localizeText } from './data-language';
import type { Lang } from './error-language';
import { channelsOf } from './exfil-store';
import { prisma } from './prisma';
import { SERVICE_NAMES, type ServiceId } from './reputation';
import { sampleFileName } from './sandbox';
import { sampleTree } from './sysmon-store';
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
  /** De onde veio: o nome da analise, como a ficha a chama, no idioma do pedido. */
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
  /** OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4). */
  deliveryRisk?: string | null;
  /** Executavel macOS (macho-analysis.ts): assinatura, injecao, empacotamento. */
  machoRisk?: string | null;
  pending: string[];
  /** Enderecos de QR codes lidos na amostra (plano pos-revisao, item 2.2). */
  qrUrls?: string[];
  /** Alertas do Suricata no trafego do sandbox (plano pos-revisao, item 5.4). */
  idsAlerts?: { signature: string; severity: number | null }[];
  /** Regras Sigma que casaram nos processos da amostra no sandbox (plans/novas-analises, item 1). */
  sigmaHits?: { title: string; level: string }[];
  /** Alertas da emulacao e do APK (plans/novas-analises, itens 4 e 6), no idioma do pedido. */
  emulationAlerts?: { level: string; text: string }[];
  /** Descompilacao de .NET (plans/caca-e-formatos, item 3). */
  dotnetAlerts?: { level: string; text: string }[];
  /** Descompilacao de Java (JAR e .class). */
  jarAlerts?: { level: string; text: string }[];
  androidAlerts?: { level: string; text: string }[];
  /** Familias reconhecidas pela configuracao (item 2): com a configuracao extraida ou so pela regra. */
  configFamilies?: { family: string; extracted: boolean }[];
  /** Canais de exfiltracao (plans/analise-estatica-ampliada, item 3): tipo e se leva credencial. */
  channels?: { kind: string; credential: boolean }[];
  /**
   * Abuso conhecido (item 4): driver do LOLDrivers, ferramenta do LOLRMM e se a amostra chegou
   * dentro de outra (anexo, ZIP, filha), e os binarios do sistema abusados.
   */
  lol?: {
    driver: 'malicious' | 'vulnerable' | null;
    rmm: string[];
    delivered: boolean;
    lolbins: string[];
  };
};

/** A regra de teste do DeepLook (apps/suricata/deeplook.rules): confere a captura, nao e risco. */
export const IDS_TEST_SID = 9900001;

/** A partir destas notas a sugestao muda. */
export const RISK_MALICIOUS = 70;
export const RISK_SUSPICIOUS = 35;

/**
 * Lista curta: "a, b, c e mais 2". O idioma vem de quem pede (plano pos-revisao, item 1.4): a nota
 * e calculada a cada pedido, e os motivos saem no idioma da interface.
 */
const list = (items: string[], lang: Lang, max = 3) =>
  items.length > max
    ? `${items.slice(0, max).join(', ')} ${lang === 'en' ? 'and' : 'e mais'} ${
        lang === 'en' ? `${items.length - max} more` : items.length - max
      }`
    : items.join(', ');

/** A nota e os motivos, a partir dos sinais. Pura: os testes a chamam direto. */
export function scoreRisk(input: RiskInputs, lang: Lang = 'pt-BR'): RiskScore {
  const { facts } = input;
  const reasons: RiskReason[] = [];
  const en = lang === 'en';
  const tr = (pt: string, english: string) => (en ? english : pt);
  const add = (source: string, text: string, weight: number) => {
    if (weight !== 0) reasons.push({ source, text, weight });
  };

  if (facts.antivirus !== null) {
    add(
      tr('Antivírus', 'Antivirus'),
      en
        ? `ClamAV detected ${facts.antivirus || 'a threat'}`
        : `o ClamAV detectou ${facts.antivirus || 'uma ameaça'}`,
      60,
    );
  }

  const yara = [...new Set(facts.yara)];
  if (yara.length) {
    add(
      'YARA',
      en
        ? `${yara.length} rule set(s) matched: ${list(yara, lang)}`
        : `${yara.length} conjunto(s) de regras casaram: ${list(yara, lang)}`,
      Math.min(50, 35 + (yara.length - 1) * 5),
    );
  }

  // Reputacao: o pior veredito conta uma vez (os servicos costumam repetir a mesma fonte).
  const named = (r: { service: string }) => SERVICE_NAMES[r.service as ServiceId] ?? r.service;
  const bad = input.reputation.filter((r) => r.verdict === 'MALICIOUS');
  const odd = input.reputation.filter((r) => r.verdict === 'SUSPICIOUS');
  const good = input.reputation.filter((r) => r.verdict === 'CLEAN');
  const reputation = tr('Reputação externa', 'External reputation');
  if (bad.length) {
    add(reputation, `${tr('malicioso em', 'malicious on')} ${list(bad.map(named), lang)}`, 60);
  } else if (odd.length) {
    add(reputation, `${tr('suspeito em', 'suspicious on')} ${list(odd.map(named), lang)}`, 25);
  } else if (good.length) {
    add(reputation, `${tr('limpo em', 'clean on')} ${list(good.map(named), lang)}`, -10);
  }

  if (facts.disguised) {
    add(
      tr('Tipo do arquivo', 'File type'),
      tr(
        'executável ou script disfarçado com outra extensão',
        'executable or script disguised with another extension',
      ),
      30,
    );
  }
  if (input.scriptRisk === 'high') {
    add(
      'Script',
      tr('comportamento de alto risco no script', 'high-risk behavior in the script'),
      35,
    );
  } else if (input.scriptRisk === 'medium') {
    add(
      'Script',
      tr('comportamento de risco médio no script', 'medium-risk behavior in the script'),
      15,
    );
  }
  // Formatos de entrega (plans/caca-e-formatos, item 4): a carga escondida no OneNote, no HTML ou
  // no MSI. As filhas tem o proprio risco; aqui conta o disfarce.
  const delivery = tr('Formato de entrega', 'Delivery format');
  if (input.deliveryRisk === 'high')
    add(
      delivery,
      tr('carga escondida (OneNote, HTML ou MSI)', 'hidden payload (OneNote, HTML or MSI)'),
      35,
    );
  else if (input.deliveryRisk === 'medium')
    add(delivery, tr('arquivo embutido suspeito', 'suspicious embedded file'), 15);
  if (input.machoRisk === 'high')
    add(
      'Mach-O',
      tr(
        'comportamento de alto risco no executável macOS',
        'high-risk behavior in the macOS executable',
      ),
      30,
    );
  else if (input.machoRisk === 'medium')
    add(
      'Mach-O',
      tr(
        'sinais de risco no executável macOS (assinatura, entitlements)',
        'risk signals in the macOS executable (signature, entitlements)',
      ),
      10,
    );
  const document = tr('Documento', 'Document');
  if (input.documentRisk === 'high')
    add(document, tr('documento de alto risco', 'high-risk document'), 35);
  else if (facts.macro) add(document, tr('contém macros VBA', 'contains VBA macros'), 15);
  else if (input.documentRisk === 'medium') {
    add(document, tr('documento de risco médio', 'medium-risk document'), 10);
  }
  if (facts.lnk)
    add(
      tr('Atalho', 'Shortcut'),
      tr('atalho (.lnk) com alertas', 'shortcut (.lnk) with alerts'),
      25,
    );
  // oletools (revisao 3.2): o que o parser em TypeScript nao ve (MacroRaptor, XLM 4.0, stomping).
  const office = facts.officeAlerts.filter((a) => a.level === 'high');
  if (office.length) {
    add(
      tr('Documento (oletools)', 'Document (oletools)'),
      list(
        office.map((a) => localizeText(a.text, lang).replace(/[.:].*$/, '')),
        lang,
        2,
      ),
      Math.min(30, office.length * 15),
    );
  }

  // QR code com link (plano pos-revisao, item 2.2): o link fica fora do texto, longe dos filtros.
  const qrHosts = [
    ...new Set(
      (input.qrUrls ?? []).map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return u;
        }
      }),
    ),
  ];
  if (qrHosts.length) {
    const n = input.qrUrls!.length;
    add(
      'QR code',
      en
        ? `${n} QR code(s) with a link: ${list(qrHosts, lang)}`
        : `${n} QR code(s) com link: ${list(qrHosts, lang)}`,
      15,
    );
  }

  // Alerta do Suricata no trafego da VM (plano pos-revisao, item 5.4): pela severidade mais alta
  // (1 = alta). E o comportamento da amostra rodando, nao so o arquivo.
  const ids = input.idsAlerts ?? [];
  if (ids.length) {
    const worst = Math.min(...ids.map((a) => a.severity ?? 3));
    const names = [...new Set(ids.map((a) => a.signature))];
    add(
      'Suricata',
      en
        ? `${ids.length} alert(s) in the sandbox traffic: ${list(names, lang, 2)}`
        : `${ids.length} alerta(s) no tráfego do sandbox: ${list(names, lang, 2)}`,
      worst <= 1 ? 40 : worst === 2 ? 25 : 10,
    );
  }

  // Regras Sigma no comportamento da amostra (plans/novas-analises, item 1): so os processos dela
  // (e descendentes) contam; o ruido do Windows na VM, nao. Pelo nivel mais alto, mais 5 por regra
  // a mais, com teto de 50.
  const sigma = input.sigmaHits ?? [];
  const sigmaWeight = { critical: 40, high: 30, medium: 15 } as Record<string, number>;
  const sigmaScored = sigma.filter((h) => sigmaWeight[h.level]);
  if (sigmaScored.length) {
    const titles = [...new Set(sigmaScored.map((h) => h.title))];
    const worst = Math.max(...sigmaScored.map((h) => sigmaWeight[h.level]));
    add(
      'Sigma',
      en
        ? `${titles.length} rule(s) matched the sample's behavior in the sandbox: ${list(titles, lang, 2)}`
        : `${titles.length} regra(s) casaram no comportamento da amostra no sandbox: ${list(titles, lang, 2)}`,
      Math.min(50, worst + (titles.length - 1) * 5),
    );
  }

  // Emulacao (item 4): o que o programa tentou fazer, sem rodar. Alto pesa mais; o resto, pouco.
  const scored = (
    source: string,
    alerts: { level: string; text: string }[] | undefined,
    high: [base: number, step: number, cap: number],
    medium: [base: number, step: number, cap: number],
  ) => {
    const hi = (alerts ?? []).filter((a) => a.level === 'high');
    const me = (alerts ?? []).filter((a) => a.level === 'medium');
    const [b, st, cap] = hi.length ? high : medium;
    const used = hi.length ? hi : me;
    if (!used.length) return;
    add(
      source,
      list(
        used.map((a) => a.text.replace(/\.$/, '')),
        lang,
        2,
      ),
      Math.min(cap, b + (used.length - 1) * st),
    );
  };
  scored(tr('Emulação', 'Emulation'), input.emulationAlerts, [25, 5, 35], [10, 3, 16]);
  // .NET descompilado (plans/caca-e-formatos, item 3): os achados no codigo pesam como na emulacao;
  // o ofuscador e os recursos medios, como os medios dela.
  scored('.NET', input.dotnetAlerts, [25, 5, 35], [10, 3, 16]);
  // Java descompilado: o mesmo peso do .NET (achados no codigo, ofuscador e arquivos embutidos).
  scored('Java', input.jarAlerts, [25, 5, 35], [10, 3, 16]);
  // APK (item 6): as combinacoes de banker, spyware e dropper.
  scored('Android', input.androidAlerts, [30, 5, 40], [10, 3, 20]);
  // Configuracao de familia (item 2): a configuracao extraida e a identificacao mais certa que ha.
  const families = input.configFamilies ?? [];
  const extracted = families.filter((f) => f.extracted).map((f) => f.family);
  const recognized = families.filter((f) => !f.extracted).map((f) => f.family);
  if (extracted.length) {
    add(
      tr('Configuração', 'Configuration'),
      en
        ? `${list(extracted, lang)} configuration extracted`
        : `configuração de ${list(extracted, lang)} extraída`,
      60,
    );
  } else if (recognized.length) {
    add(
      tr('Configuração', 'Configuration'),
      en
        ? `a CAPE rule recognizes ${list(recognized, lang)}`
        : `regra do CAPE reconhece ${list(recognized, lang)}`,
      35,
    );
  }

  // Canais de exfiltracao (item 3): com credencial (token do bot, webhook, senha) e a prova de
  // que o programa manda dados para alguem; sem credencial, so o tunel e o webhook generico contam.
  const channels = input.channels ?? [];
  const withCredential = [...new Set(channels.filter((c) => c.credential).map((c) => c.kind))];
  const exits = [
    ...new Set(
      channels
        .filter((c) => !c.credential && (c.kind === 'tunnel' || c.kind === 'webhook'))
        .map((c) => c.kind),
    ),
  ];
  if (withCredential.length) {
    add(
      tr('Canais de exfiltração', 'Exfiltration channels'),
      en
        ? `channel with a credential in the sample: ${list(withCredential, lang)}`
        : `canal com credencial na amostra: ${list(withCredential, lang)}`,
      Math.min(40, 30 + 5 * (withCredential.length - 1)),
    );
  } else if (exits.length) {
    add(
      tr('Canais de exfiltração', 'Exfiltration channels'),
      en ? `exit through ${list(exits, lang)}` : `saída por ${list(exits, lang)}`,
      10,
    );
  }

  // Abuso conhecido (item 4).
  const lol = input.lol;
  if (lol?.driver === 'malicious') {
    add('LOLDrivers', tr('driver malicioso conhecido', 'known malicious driver'), 60);
  } else if (lol?.driver === 'vulnerable') {
    add(
      'LOLDrivers',
      tr('driver vulnerável conhecido (BYOVD)', 'known vulnerable driver (BYOVD)'),
      40,
    );
  }
  if (lol?.rmm.length && lol.delivered) {
    add(
      'LOLRMM',
      en
        ? `${list(lol.rmm, lang)} delivered inside another file (attachment, archive)`
        : `${list(lol.rmm, lang)} entregue dentro de outro arquivo (anexo, pacote)`,
      25,
    );
  }
  if (lol?.lolbins.length) {
    add(
      tr('Binários do sistema', 'System binaries'),
      en ? `abused: ${list(lol.lolbins, lang)}` : `abusados: ${list(lol.lolbins, lang)}`,
      Math.min(25, 15 + 5 * (lol.lolbins.length - 1)),
    );
  }

  if (facts.lookalikes.length) {
    add(
      tr('Domínio parecido', 'Lookalike domain'),
      `${tr('imita', 'imitates')} ${list([...new Set(facts.lookalikes)], lang)}`,
      35,
    );
  }

  const executable = tr('Executável', 'Executable');
  const highAlerts = facts.peAlerts.filter((a) => a.level === 'high');
  const mediumAlerts = facts.peAlerts.filter((a) => a.level === 'medium');
  if (highAlerts.length) {
    const items = list(
      highAlerts.map((a) => localizeText(a.text, lang)),
      lang,
      2,
    );
    add(
      executable,
      en
        ? `${highAlerts.length} high alert(s): ${items}`
        : `${highAlerts.length} alerta(s) alto(s): ${items}`,
      Math.min(30, highAlerts.length * 12),
    );
  }
  if (mediumAlerts.length) {
    add(
      executable,
      en ? `${mediumAlerts.length} medium alert(s)` : `${mediumAlerts.length} alerta(s) médio(s)`,
      Math.min(12, mediumAlerts.length * 4),
    );
  }
  const signature = tr('Assinatura', 'Signature');
  if (facts.signatureInvalid) {
    add(
      signature,
      tr('assinatura digital que não confere', 'digital signature that does not match'),
      20,
    );
  } else if (input.signedValid) {
    add(signature, tr('assinatura digital válida', 'valid digital signature'), -15);
  }

  const packers = facts.die.filter((d) => ['packer', 'protector'].includes(d.type.toLowerCase()));
  if (facts.packer || packers.length) {
    add(
      tr('Empacotamento', 'Packing'),
      `${tr('empacotado ou protegido', 'packed or protected')} (${facts.packer ?? packers[0].string})`,
      10,
    );
  }

  // Capacidades de risco do capa, por grupo: dez regras de "communication" contam uma vez.
  const functions = tr('Análise de funções', 'Function analysis');
  const groups = [
    ...new Set(
      facts.capaRules.filter((r) => capaRisky(r.namespace)).map((r) => r.namespace.split('/')[0]),
    ),
  ];
  if (groups.length) {
    add(
      functions,
      `${tr('capacidades de risco', 'risky capabilities')}: ${list(groups, lang, 4)}`,
      Math.min(30, groups.length * 6),
    );
  }
  if (facts.hiddenIocs.length) {
    add(
      functions,
      en
        ? `${facts.hiddenIocs.length} indicator(s) in obfuscated strings`
        : `${facts.hiddenIocs.length} indicador(es) em strings ofuscadas`,
      10,
    );
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
export async function riskOf(entryId: string, lang: Lang = 'pt-BR'): Promise<RiskScore | null> {
  const loaded = await loadFacts(entryId);
  if (!loaded) return null;
  const { facts, entry } = loaded;
  const qr = await prisma.qrScan.findUnique({ where: { entryId }, select: { codes: true } });
  const qrUrls = ((qr?.codes ?? []) as { url?: string | null }[])
    .map((c) => c.url)
    .filter((u): u is string => Boolean(u));
  // Alertas do Suricata nas capturas de rede da amostra (plano pos-revisao, item 5.4).
  const captures = await prisma.networkCapture.findMany({
    where: { idsStatus: 'DONE', session: { entryId } },
    select: { idsResult: true },
  });
  const idsAlerts = captures
    .flatMap(
      (c) =>
        (c.idsResult as { alerts?: { sid: number; signature: string; severity: number | null }[] })
          ?.alerts ?? [],
    )
    .filter((a) => a.sid !== IDS_TEST_SID);
  const sigmaHits = await sampleSigmaHits(entryId);
  // Emulacao, APK e configuracao (plans/novas-analises, itens 2, 4 e 6).
  const services = await prisma.serviceAnalysis.findMany({
    where: { entryId },
    select: { kind: true, status: true, alerts: true, result: true },
  });
  const done = (kind: string) => services.find((x) => x.kind === kind && x.status === 'DONE');
  const alertsOf = (kind: string) =>
    localizeAlerts(
      (done(kind)?.alerts as { level: string; text: string }[] | null | undefined) ?? [],
      lang,
    ) ?? [];
  const config = done('CONFIG')?.result as ConfigResult | undefined;
  const configFound = config
    ? configFamilies(config).map((family) => ({
        family,
        extracted: config.configs.some((c) => c.family === family),
      }))
    : [];
  const servicePending = (kind: string) =>
    services.some((x) => x.kind === kind && (x.status === 'PENDING' || x.status === 'RUNNING'));
  const reputation = await prisma.reputationResult.findMany({
    where: { entryId },
    select: { service: true, verdict: true, summary: true, status: true },
  });
  const st = (entry.staticInfo ?? {}) as {
    script?: { risk?: string } | null;
    document?: { risk?: string } | null;
    delivery?: { risk?: string } | null;
    macho?: { risk?: string } | null;
    lol?: {
      driver?: { category: 'malicious' | 'vulnerable' } | null;
      rmm?: { name: string }[];
      lolbins?: { name: string }[];
    } | null;
    pe?: {
      signature?: {
        signatureValid?: boolean;
        digestMatches?: boolean | null;
        error?: string;
      } | null;
    } | null;
  };
  const sig = st.pe?.signature;
  const en = lang === 'en';
  const pending = [
    entry.antivirus?.status === 'PENDING' && (en ? 'antivirus' : 'antivírus'),
    entry.yara?.status === 'PENDING' && 'YARA',
    entry.capaAnalysis &&
      ['PENDING', 'RUNNING'].includes(entry.capaAnalysis.status) &&
      (en ? 'function analysis' : 'análise de funções'),
    entry.officeAnalysis &&
      ['PENDING', 'RUNNING'].includes(entry.officeAnalysis.status) &&
      (en ? 'document analysis' : 'análise do documento'),
    reputation.some((r) => r.status === 'PENDING') &&
      (en ? 'external reputation' : 'reputação externa'),
    servicePending('EMULATION') && (en ? 'emulation' : 'emulação'),
    servicePending('ANDROID') && (en ? 'APK analysis' : 'análise do APK'),
    servicePending('CONFIG') && (en ? 'configuration extraction' : 'extração de configuração'),
    servicePending('DOTNET') && (en ? '.NET decompilation' : 'descompilação do .NET'),
    servicePending('JAR') && (en ? 'Java decompilation' : 'descompilação do Java'),
  ].filter((name): name is string => Boolean(name));
  return scoreRisk(
    {
      facts,
      reputation: reputation.filter((r) => r.status === 'FOUND'),
      signedValid: Boolean(sig && !sig.error && sig.signatureValid && sig.digestMatches !== false),
      scriptRisk: st.script?.risk ?? null,
      documentRisk: st.document?.risk ?? null,
      deliveryRisk: st.delivery?.risk ?? null,
      machoRisk: st.macho?.risk ?? null,
      pending,
      qrUrls,
      idsAlerts,
      sigmaHits,
      emulationAlerts: alertsOf('EMULATION'),
      dotnetAlerts: alertsOf('DOTNET'),
      jarAlerts: alertsOf('JAR'),
      androidAlerts: alertsOf('ANDROID'),
      configFamilies: configFound,
      channels: (await channelsOf(entryId)) ?? [],
      lol: st.lol
        ? {
            driver: st.lol.driver?.category ?? null,
            rmm: [...new Set((st.lol.rmm ?? []).map((r) => r.name))],
            delivered: Boolean(entry.parentEntryId),
            lolbins: [...new Set((st.lol.lolbins ?? []).map((b) => b.name))],
          }
        : undefined,
    },
    lang,
  );
}

/** As deteccoes Sigma dos processos da amostra, em todos os ambientes dela. */
export async function sampleSigmaHits(
  entryId: string,
): Promise<{ title: string; level: string; techniques: string[] }[]> {
  const hits = await prisma.sandboxSigmaHit.findMany({
    where: { session: { entryId } },
    select: {
      sessionId: true,
      processGuid: true,
      title: true,
      level: true,
      techniques: true,
      session: { select: { entry: { select: { originalFilename: true } } } },
    },
  });
  const trees = new Map<string, Set<string>>();
  const out: { title: string; level: string; techniques: string[] }[] = [];
  for (const h of hits) {
    let tree = trees.get(h.sessionId);
    if (!tree) {
      tree = await sampleTree(
        h.sessionId,
        sampleFileName({ originalFilename: h.session.entry.originalFilename }),
      );
      trees.set(h.sessionId, tree);
    }
    if (h.processGuid && tree.has(h.processGuid)) {
      out.push({ title: h.title, level: h.level, techniques: h.techniques });
    }
  }
  return out;
}
