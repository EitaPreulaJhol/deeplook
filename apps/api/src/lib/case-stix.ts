import type { Verdict } from '../generated/prisma/client';
import { findTechnique } from './attack';
import { type CaseIoc, caseIocsStix, type ExportCase, uuidV5 } from './ioc-export';
import { IMPORT_MAX_BYTES, ImportError, parseImport } from './ioc-import';
import { normalizeUrl } from './ioc-normalize';

/**
 * Pacote STIX 2.1 do caso (revisao de novembro, item 3.5): para levar um caso inteiro a outro
 * DeepLook, a um TIP ou a um parceiro, e para trazer o de outro para dentro de um caso.
 *
 * Exportar: o que a exportacao de IOCs do caso ja tinha (identidade, um indicator por IOC e o
 * grouping do caso, com os mesmos ids) mais as amostras como observaveis (file pelo SHA-256, url
 * pelo endereco), as tecnicas ATT&CK dos relatorios publicados (attack-pattern), os relatorios
 * publicados como note presa a amostra, e um report do caso apontando para tudo. Rascunho e
 * relatorio em revisao nao saem.
 *
 * Importar: dos links e dos SHA-256 do pacote (observaveis e indicators), o que da para analisar
 * aqui. Link vira amostra nova (ou entra a que ja existe com o mesmo link); arquivo so entra se o
 * mesmo SHA-256 ja foi enviado ao DeepLook, porque o pacote nao traz o arquivo. Os demais
 * indicadores (dominio, IP, e-mail) so sao contados: para segui-los, use Importar indicadores.
 */

/** Links criados por importacao, no maximo (o resto e listado, nao criado). */
export const CASE_IMPORT_MAX_URLS = 50;

export type CaseSample = {
  id: string;
  type: 'FILE' | 'URL';
  title: string;
  sha256: string | null;
  url: string | null;
  originalFilename: string | null;
  verdict: Verdict;
};

export type CaseReport = {
  id: string;
  entryId: string;
  verdict: Verdict;
  summary: string;
  findings: string | null;
  attackTechniques: string[];
  updatedAt: Date;
  analyst: string | null;
};

type StixObject = { type: string; id: string; [key: string]: unknown };

const sampleRef = (s: CaseSample) =>
  s.type === 'FILE' && s.sha256
    ? `file--${uuidV5(`file:${s.sha256}`)}`
    : s.url
      ? `url--${uuidV5(`url:${s.url}`)}`
      : null;

/** O pacote do caso inteiro (ver o comentario do arquivo). */
export function casePackage(
  c: ExportCase & { description: string | null },
  iocs: CaseIoc[],
  samples: CaseSample[],
  reports: CaseReport[],
  now = new Date(),
): { type: 'bundle'; id: string; objects: StixObject[] } {
  const base = caseIocsStix(c, iocs, now) as { type: 'bundle'; id: string; objects: StixObject[] };
  const ts = now.toISOString();
  const identity = base.objects[0];
  const common = { spec_version: '2.1', created: ts, modified: ts, created_by_ref: identity.id };

  const observables: StixObject[] = [];
  for (const s of samples) {
    const id = sampleRef(s);
    if (!id || observables.some((o) => o.id === id)) continue;
    observables.push(
      s.type === 'FILE'
        ? {
            type: 'file',
            spec_version: '2.1',
            id,
            hashes: { 'SHA-256': s.sha256 },
            ...(s.originalFilename ? { name: s.originalFilename } : {}),
          }
        : { type: 'url', spec_version: '2.1', id, value: s.url },
    );
  }

  const techniques = [...new Set(reports.flatMap((r) => r.attackTechniques))].sort();
  const patterns: StixObject[] = techniques.map((tid) => ({
    type: 'attack-pattern',
    ...common,
    id: `attack-pattern--${uuidV5(`attack:${tid}`)}`,
    name: findTechnique(tid)?.name ?? tid,
    external_references: [
      {
        source_name: 'mitre-attack',
        external_id: tid,
        url: `https://attack.mitre.org/techniques/${tid.replace('.', '/')}/`,
      },
    ],
  }));

  const bySample = new Map(samples.map((s) => [s.id, s]));
  const notes: StixObject[] = reports.flatMap((r) => {
    const sample = bySample.get(r.entryId);
    const ref = sample && sampleRef(sample);
    if (!ref) return [];
    return [
      {
        type: 'note',
        ...common,
        id: `note--${uuidV5(`report:${r.id}`)}`,
        abstract: `${sample.title}: ${r.verdict}${r.analyst ? ` (${r.analyst})` : ''}`,
        content: [r.summary, r.findings].filter(Boolean).join('\n\n'),
        authors: r.analyst ? [r.analyst] : undefined,
        object_refs: [ref],
      },
    ];
  });

  const content = [...observables, ...patterns, ...notes];
  const refs = [...base.objects.slice(1), ...content].map((o) => o.id);
  const report: StixObject = {
    type: 'report',
    ...common,
    id: `report--${uuidV5(`case-report:${c.id}`)}`,
    name: `${c.code} ${c.title}`,
    ...(c.description ? { description: c.description } : {}),
    report_types: ['threat-report'],
    published: ts,
    // Um report precisa de ao menos uma referencia: caso sem nada aponta para a identidade.
    object_refs: refs.length ? refs : [identity.id],
  };
  return { ...base, objects: [...base.objects, ...content, report] };
}

export type ParsedCaseBundle = {
  /** Nome do report (ou do grouping) do pacote, se houver. */
  name: string | null;
  urls: string[];
  sha256s: string[];
  /** Indicadores de outros tipos (dominio, IP, e-mail, MD5, SHA-1): so contados. */
  others: number;
  invalid: number;
};

/** Le o pacote: os links e os SHA-256 que da para trazer para um caso. */
export function parseCaseBundle(text: string): ParsedCaseBundle {
  if (Buffer.byteLength(text) > IMPORT_MAX_BYTES) {
    throw new ImportError('Arquivo grande demais (máximo 2 MB).');
  }
  let json: { type?: unknown; objects?: unknown };
  try {
    json = JSON.parse(text.trim()) as typeof json;
  } catch {
    throw new ImportError('JSON inválido: envie um pacote STIX 2.1.');
  }
  if (json?.type !== 'bundle' || !Array.isArray(json.objects)) {
    throw new ImportError('Não é um pacote STIX 2.1 (falta "type": "bundle" com "objects").');
  }
  const objects = json.objects.filter(
    (o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object',
  );
  // Indicators: a mesma leitura da importacao de indicadores (padroes STIX, refang).
  const indicators = parseImport(text, 'watch');
  const urls = new Set<string>();
  const sha256s = new Set<string>();
  let others = 0;
  for (const item of indicators.items) {
    if (item.kind === 'URL') urls.add(item.value);
    else if (item.kind === 'SHA256') sha256s.add(item.value);
    else others++;
  }
  // Observaveis: url e file soltos no pacote.
  for (const o of objects) {
    if (o.type === 'url' && typeof o.value === 'string') {
      const normalized = normalizeUrl(o.value);
      if (normalized) urls.add(normalized);
    }
    if (o.type === 'file' && o.hashes && typeof o.hashes === 'object') {
      const hashes = o.hashes as Record<string, unknown>;
      const sha = hashes['SHA-256'] ?? hashes['sha256'] ?? hashes['SHA256'];
      if (typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha)) sha256s.add(sha.toLowerCase());
    }
  }
  const named =
    objects.find((o) => o.type === 'report' && typeof o.name === 'string') ??
    objects.find((o) => o.type === 'grouping' && typeof o.name === 'string');
  return {
    name: named ? String(named.name).slice(0, 150) : null,
    urls: [...urls],
    sha256s: [...sha256s],
    others,
    invalid: indicators.invalid.length,
  };
}
