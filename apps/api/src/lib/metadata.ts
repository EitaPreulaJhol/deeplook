import { z } from 'zod';

import { env } from '../env';
import { type Pivot, replacePivots } from './pivots';
import { prisma } from './prisma';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Metadados com o ExifTool (plans/analise-estatica-ampliada, item 19), pela rota /metadata do servico
 * oletools: EXIF, XMP, PDF, as propriedades do Office (FlashPix no OLE, XML no OOXML), LNK. O autor,
 * a ferramenta e os IDs do XMP viram pivos: ligam documentos feitos do mesmo modelo, ainda que o
 * conteudo mude. Datas de criacao e de modificacao incoerentes viram aviso.
 */

const text = (max: number) => z.string().max(max);
const list = (max: number) => z.array(text(300)).max(max);

export const metadataSchema = z.object({
  groups: z.record(text(80), z.record(text(120), text(300))),
  keys: z.number().int().nonnegative(),
  fields: z.object({
    authors: list(20),
    tools: list(20),
    xmpIds: list(20),
    created: list(20),
    modified: list(20),
  }),
});
export type MetadataResult = z.infer<typeof metadataSchema>;

/** "2026:05:10 10:00:00Z" (ExifTool) para Date; null se nao for uma data completa. */
export function exifDate(value: string): Date | null {
  const m =
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?/.exec(
      value.trim(),
    );
  if (!m || m[1] === '0000') return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? 'Z'}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function metadataAlerts(r: MetadataResult, now = new Date()): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const created = r.fields.created.map(exifDate).filter((d): d is Date => d !== null);
  const modified = r.fields.modified.map(exifDate).filter((d): d is Date => d !== null);
  if (created.length && modified.length) {
    const first = new Date(Math.min(...created.map((d) => d.getTime())));
    const last = new Date(Math.max(...modified.map((d) => d.getTime())));
    // Um dia de folga: fuso e relogio de quem salvou.
    if (last.getTime() < first.getTime() - 86_400_000) {
      alerts.push({
        level: 'info',
        text: `Modificado (${day(last)}) antes de criado (${day(first)}): datas editadas ou copiadas de um modelo`,
      });
    }
  }
  const future = [...created, ...modified].find((d) => d.getTime() > now.getTime() + 86_400_000);
  if (future) {
    alerts.push({ level: 'info', text: `Data no futuro nos metadados: ${day(future)}` });
  }
  return alerts;
}

/** Nomes genericos demais para ligar amostras (a instalacao padrao do Windows e do Office). */
const GENERIC =
  /^(?:admin(?:istrator|istrador)?|user|usu[aá]rio|owner|windows user|microsoft|unknown|desconhecido|-|\?+)$/i;

export function metadataPivots(r: MetadataResult): Pivot[] {
  const pivots: Pivot[] = [];
  const add = (kind: Pivot['kind'], value: string) => {
    const v = value.trim().slice(0, 300);
    if (v.length >= 3 && !GENERIC.test(v)) pivots.push({ kind, value: v });
  };
  r.fields.authors.forEach((v) => add('DOC_AUTHOR', v));
  r.fields.tools.forEach((v) => add('DOC_TOOL', v));
  r.fields.xmpIds.forEach((v) => add('XMP_ID', v.toLowerCase()));
  return pivots;
}

async function persistMetadata(entryId: string, r: MetadataResult): Promise<MetadataResult> {
  await replacePivots(prisma, entryId, 'metadata', metadataPivots(r));
  return r;
}

export const metadataService = registerService({
  kind: 'METADATA',
  name: 'oletools',
  url: () => env.OLETOOLS_URL,
  token: () => env.OLETOOLS_TOKEN,
  timeoutS: () => env.OLETOOLS_REQUEST_TIMEOUT_S,
  maxMb: () => env.OLETOOLS_MAX_MB,
  path: '/metadata',
  // Documentos, imagens e atalhos; o PE ja tem a versao e as datas na analise estatica.
  autoKinds: new Set([
    'ole',
    'docx',
    'xlsx',
    'pptx',
    'rtf',
    'pdf',
    'onenote',
    'png',
    'jpeg',
    'gif',
    'lnk',
    'iso',
  ]),
  manualOk: (typeId) => Boolean(typeId),
  query: () => '',
  schema: metadataSchema,
  alerts: (r) => metadataAlerts(r),
  iocs: () => [],
  persist: persistMetadata,
});
