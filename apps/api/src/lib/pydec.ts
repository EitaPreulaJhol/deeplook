import { z } from 'zod';

import { env } from '../env';
import { Prisma } from '../generated/prisma/client';
import { getSources, putSources, sourceKeysOf } from './decompiled-store';
import { type Channel, findChannels } from './exfil';
import { extractIocs } from './iocs';
import { prisma } from './prisma';
import { analyzeScript, scriptForDb, type ScriptInfo } from './script-analysis';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Descompilacao de bytecode Python (plans/analise-estatica-ampliada, item 15): o servico pydec
 * (apps/pydec, pycdc e pycdas) devolve o fonte de cada modulo de um .pyc ou de um PYZ do PyInstaller,
 * no formato dos servicos .NET e Java. O fonte fica no armazenamento (pydec/<amostra>.json.gz), e
 * passa pelo sabor Python da analise de scripts (item 11), que vira a analise de scripts da amostra.
 */

const text = (max: number) => z.string().max(max);

export const pydecSchema = z.object({
  module: z.object({
    kind: z.enum(['pyc', 'pyz']),
    pythonVersion: text(10).nullable(),
    modules: z.number().int().nonnegative(),
    encrypted: z.number().int().nonnegative(),
  }),
  types: z
    .array(z.object({ path: text(500), size: z.number().int(), lines: z.number().int() }))
    .max(2000),
  findings: z
    .array(
      z.object({
        rule: text(40),
        level: z.enum(['high', 'medium']),
        why: text(200),
        path: text(500),
        line: z.number().int(),
        text: text(400),
      }),
    )
    .max(300),
  obfuscators: z.array(text(120)).max(20),
  resources: z.array(z.never()).max(0),
  urls: z.array(text(400)).max(200),
  sources: z.record(z.string(), z.string()),
  /** Modulos que o pycdc nao descompilou por completo (o disassembly vai junto). */
  failed: z.number().int(),
  truncated: z.boolean(),
});
export type PydecResult = z.infer<typeof pydecSchema>;

export type PydecStored = Omit<PydecResult, 'sources'> & {
  sourceKey: string | null;
  channels?: Channel[];
};

export const pydecSourceKey = (entryId: string) => `pydec/${entryId}.json.gz`;

/** O fonte descompilado (sem os .pycdas.txt) pela analise de scripts no sabor Python. */
function pythonScript(r: PydecResult): ScriptInfo | null {
  const code = Object.entries(r.sources)
    .filter(([path]) => !path.endsWith('.pycdas.txt'))
    .map(([, source]) => source)
    .join('\n\n');
  return code.trim() ? analyzeScript(Buffer.from(code, 'utf8'), 'pycdc.py') : null;
}

export function pydecAlerts(r: PydecResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  for (const name of r.obfuscators) {
    alerts.push(
      name === 'PyArmor'
        ? {
            level: 'high',
            text: 'Protegido pelo PyArmor: o bytecode real vai cifrado e não descompila (só o carregador aparece)',
          }
        : name === 'PyInstaller (PYZ cifrado)'
          ? {
              level: 'medium',
              text: `PYZ cifrado pelo PyInstaller: ${r.module.encrypted} módulo(s) não abriram`,
            }
          : { level: 'medium', text: `Ofuscado com ${name}: a descompilação pode estar ilegível` },
    );
  }
  if (r.failed > 0) {
    alerts.push({
      level: 'info',
      text: `${r.failed} módulo(s) não foram descompilados por completo: o disassembly vai junto`,
    });
  }
  for (const f of pythonScript(r)?.findings ?? []) {
    if (f.kind === 'download' || f.kind === 'execute' || f.kind === 'persistence') {
      alerts.push({ level: 'high', text: `No código Python: ${f.why} (${f.name})` });
    }
  }
  return alerts.slice(0, 40);
}

export const pydecIocs = (r: PydecResult) => extractIocs(r.urls.join('\n')).map((i) => i.value);

async function persistPydec(entryId: string, r: PydecResult): Promise<PydecStored> {
  const key = pydecSourceKey(entryId);
  await putSources(key, r.sources);
  // A analise de scripts no sabor Python (item 11) vira a da amostra: o risco, a triagem e os IOCs
  // passam a ver o codigo (o .pyc nao e texto, e a analise estatica nao tinha o que ler).
  const script = pythonScript(r);
  if (script) {
    const entry = await prisma.entry.findUnique({
      where: { id: entryId },
      select: { staticInfo: true },
    });
    const st = (entry?.staticInfo ?? {}) as { script?: ScriptInfo | null };
    if (!st.script || (st as { scriptBy?: string }).scriptBy === 'pycdc') {
      await prisma.entry.update({
        where: { id: entryId },
        data: {
          staticInfo: {
            ...(entry?.staticInfo as object),
            script: scriptForDb(script),
            scriptBy: 'pycdc',
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
  const { sources: _sources, ...rest } = r;
  const channels = findChannels(Object.values(r.sources).join('\n'), 'python');
  return { ...rest, sourceKey: key, channels };
}

export async function pydecSource(entryId: string, path: string): Promise<string | null> {
  const all = await pydecSources(entryId);
  return all?.[path] ?? null;
}

export const pydecSources = (entryId: string) => getSources(pydecSourceKey(entryId));

export const pydecKeysOf = (entryId: string) => sourceKeysOf(entryId, 'PYDEC');

export const pydecService = registerService({
  kind: 'PYDEC',
  name: 'pydec',
  url: () => env.PYDEC_URL,
  token: () => env.PYDEC_TOKEN,
  timeoutS: () => env.PYDEC_REQUEST_TIMEOUT_S,
  maxMb: () => env.PYDEC_MAX_MB,
  path: '/decompile',
  autoKinds: new Set(['pyc', 'pyz']),
  manualOk: (typeId) => typeId === 'pyc' || typeId === 'pyz',
  query: () => '',
  schema: pydecSchema,
  alerts: pydecAlerts,
  iocs: pydecIocs,
  persist: persistPydec,
});
