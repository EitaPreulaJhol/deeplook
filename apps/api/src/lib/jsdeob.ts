import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { extractIocs } from './iocs';
import { prisma } from './prisma';
import { analyzeScript, scriptForDb, type ScriptInfo } from './script-analysis';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Desofuscacao de JavaScript com o webcrack (plans/analise-estatica-ampliada, item 20): o servico
 * jsdeob (apps/jsdeob) desfaz o obfuscator.io (string arrays, control-flow flattening), o eval
 * embrulhado, a minificacao e os bundles do webpack e do browserify. O codigo desofuscado vira uma
 * camada da analise de scripts da amostra (staticInfo.script), e os achados e as URLs dele entram
 * junto: o risco e os IOCs passam a ver o que a ofuscacao escondia.
 */

const MAX_STORED = 200_000;
const MAX_LAYER_TEXT = 20_000;
const MAX_LAYERS = 16;

export const jsdeobSchema = z.object({
  code: z.string().max(2 * 1024 * 1024),
  truncated: z.boolean(),
  changed: z.boolean(),
  inputChars: z.number().int().nonnegative(),
  scripts: z.number().int().nonnegative(),
  bundle: z
    .object({
      type: z.string().max(40),
      entryId: z.string().max(100),
      modules: z
        .array(
          z.object({
            id: z.string().max(100),
            path: z.string().max(300),
            size: z.number().int().nonnegative(),
          }),
        )
        .max(300),
      moduleCount: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type JsdeobResult = z.infer<typeof jsdeobSchema>;

/** O que fica no banco: o codigo cortado (a camada da analise de scripts tem o comeco dele). */
export type JsdeobStored = Omit<JsdeobResult, 'code'> & { code: string; codeTruncated: boolean };

const deobScript = (r: JsdeobResult) =>
  r.changed ? analyzeScript(Buffer.from(r.code, 'utf8'), 'webcrack.js') : null;

const RANK = { low: 0, medium: 1, high: 2 } as const;

/** A analise de scripts da amostra com o codigo desofuscado como camada (e os achados dele). */
export function mergeScript(
  original: ScriptInfo | null | undefined,
  r: JsdeobResult,
): ScriptInfo | null {
  const deob = deobScript(r);
  if (!deob) return null;
  const base: ScriptInfo = original ?? { ...deob, findings: [], layers: [], urls: [] };
  const at = base.layers.length + 1;
  const layers = [
    ...base.layers,
    {
      method: 'webcrack (JavaScript desofuscado)',
      from: 0,
      text: r.code.slice(0, MAX_LAYER_TEXT),
      truncated: r.code.length > MAX_LAYER_TEXT,
    },
    // As camadas achadas dentro do desofuscado (Base64, eval...), renumeradas.
    ...deob.layers.map((l) => ({ ...l, from: l.from === 0 ? at : l.from + at })),
  ].slice(0, MAX_LAYERS);
  const findings = [...base.findings];
  const known = new Set(findings.map((f) => f.name));
  for (const f of deob.findings) {
    if (known.has(f.name)) continue;
    known.add(f.name);
    findings.push({ ...f, layer: f.layer === 0 ? at : f.layer + at });
  }
  return {
    ...base,
    risk: RANK[deob.risk] > RANK[base.risk] ? deob.risk : base.risk,
    findings,
    layers,
    urls: [...new Set([...base.urls, ...deob.urls])].slice(0, 200),
  };
}

async function persistJsdeob(entryId: string, r: JsdeobResult): Promise<JsdeobStored> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { staticInfo: true },
  });
  const st = (entry?.staticInfo ?? {}) as {
    script?: ScriptInfo | null;
    scriptBeforeWebcrack?: ScriptInfo | null;
  };
  // Pedido de novo: a juncao parte da analise de antes do webcrack, sem empilhar camadas.
  const before =
    st.scriptBeforeWebcrack !== undefined ? st.scriptBeforeWebcrack : (st.script ?? null);
  const merged = mergeScript(before, r);
  if (merged) {
    await prisma.entry.update({
      where: { id: entryId },
      data: {
        staticInfo: {
          ...(entry?.staticInfo as object),
          script: scriptForDb(merged),
          scriptBeforeWebcrack: before,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return {
    ...r,
    code: r.code.slice(0, MAX_STORED),
    codeTruncated: r.truncated || r.code.length > MAX_STORED,
  };
}

export function jsdeobAlerts(r: JsdeobResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  if (r.bundle) {
    alerts.push({
      level: 'info',
      text: `Bundle do ${r.bundle.type} com ${r.bundle.moduleCount} módulo(s)`,
    });
  }
  const deob = deobScript(r);
  for (const f of deob?.findings ?? []) {
    if (f.kind === 'download' || f.kind === 'execute') {
      alerts.push({ level: 'high', text: `No código desofuscado: ${f.why} (${f.name})` });
    }
  }
  return alerts.slice(0, 30);
}

export const jsdeobIocs = (r: JsdeobResult) =>
  r.changed ? extractIocs(r.code.slice(0, 500_000)).map((i) => i.value) : [];

/** JavaScript (solto, de um HTML ou de um HTA) que a analise estatica reconheceu. */
const hasJs = (staticInfo: unknown) => {
  const lang = (staticInfo as { script?: { language?: string } | null } | null)?.script?.language;
  return lang === 'javascript' || lang === 'hta';
};

export const jsdeobService = registerService({
  kind: 'JSDEOB',
  name: 'jsdeob',
  url: () => env.JSDEOB_URL,
  token: () => env.JSDEOB_TOKEN,
  timeoutS: () => env.JSDEOB_REQUEST_TIMEOUT_S,
  maxMb: () => env.JSDEOB_MAX_MB,
  path: '/deobfuscate',
  // '' = sem tipo pela assinatura (o .js solto).
  autoKinds: new Set(['', 'html']),
  autoOk: hasJs,
  manualOk: (typeId) => !typeId || typeId === 'html',
  query: () => '',
  schema: jsdeobSchema,
  alerts: jsdeobAlerts,
  iocs: jsdeobIocs,
  persist: persistJsdeob,
});
