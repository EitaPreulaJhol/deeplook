import { z } from 'zod';

import type { DetectedType } from './file-type';
import type { ScriptLanguage } from './script-analysis';

/**
 * Magika (plans/analise-estatica-ampliada, item 22): o tipo do arquivo por aprendizado de maquina,
 * que roda no servico `unpack`. Serve onde a assinatura dos primeiros bytes nao diz nada (texto,
 * script, codigo): o "fatura.pdf" que e PowerShell, o arquivo sem extensao que e JavaScript.
 */

export const magikaSchema = z.object({
  label: z.string().max(40),
  description: z.string().max(120),
  group: z.string().max(40),
  mime: z.string().max(120),
  extensions: z.array(z.string().max(20)).max(10),
  isText: z.boolean(),
  score: z.number().min(0).max(1),
});
export type Magika = z.infer<typeof magikaSchema>;

export interface MagikaInfo extends Magika {
  /** O Magika, com confianca alta, discorda do tipo detectado (ou, sem tipo, da extensao). */
  mismatch: { basis: 'type' | 'extension'; expected: string[] } | null;
}

/** Confianca a partir da qual a divergencia conta. */
export const MAGIKA_CONFIDENT = 0.9;

/** Rotulos que nao dizem nada (texto qualquer, bytes aleatorios). */
const GENERIC = new Set(['txt', 'unknown', 'undefined', 'empty', 'randombytes', 'randomtxt']);

/** Rotulo do Magika que e um script que a analise de scripts le. */
const SCRIPT: Record<string, ScriptLanguage> = {
  powershell: 'powershell',
  javascript: 'javascript',
  jscript: 'javascript',
  vba: 'vbscript',
  vbscript: 'vbscript',
  batch: 'batch',
  hta: 'hta',
  autoit: 'autoit',
  shell: 'shell',
  python: 'python',
};
/** Extensao que faz a analise de scripts escolher a linguagem. */
const SCRIPT_EXT: Record<ScriptLanguage, string> = {
  powershell: 'ps1',
  javascript: 'js',
  vbscript: 'vbs',
  batch: 'bat',
  hta: 'hta',
  autoit: 'au3',
  shell: 'sh',
  python: 'py',
};

export function scriptLanguageOf(magika: Magika | null | undefined): ScriptLanguage | null {
  if (!magika?.isText || magika.score < MAGIKA_CONFIDENT) return null;
  return SCRIPT[magika.label] ?? null;
}

export const scriptFilenameFor = (language: ScriptLanguage) => `magika.${SCRIPT_EXT[language]}`;

export function magikaMismatch(
  magika: Magika,
  detected: Pick<DetectedType, 'extensions'> | null | undefined,
  filename: string | null | undefined,
): MagikaInfo['mismatch'] {
  if (magika.score < MAGIKA_CONFIDENT || GENERIC.has(magika.label)) return null;
  const own = new Set(magika.extensions.map((e) => e.toLowerCase()));
  if (!own.size) return null;
  if (detected) {
    const expected = detected.extensions.filter(Boolean).map((e) => e.toLowerCase());
    if (!expected.length || expected.some((e) => own.has(e))) return null;
    return { basis: 'type', expected };
  }
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
  // Sem extensao, ou de texto generico, nao ha o que contrariar.
  if (!ext || ['txt', 'log', 'dat', 'bin', 'tmp'].includes(ext) || own.has(ext)) return null;
  return { basis: 'extension', expected: [ext] };
}
