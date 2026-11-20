import { z } from 'zod';

import { env } from '../env';
import { createResourceChildren } from './decompiled-store';
import { extractIocs } from './iocs';
import { prisma } from './prisma';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Emulacao de PE e shellcode com o Speakeasy (plans/novas-analises, item 4): o servico emulate
 * (apps/emulate) emula o executavel sem rodar nada no processador de verdade, com rede, disco e
 * registro simulados, e devolve o que o programa tentou fazer. Todo PE enviado vai sozinho para a
 * fila; shellcode (qualquer arquivo) e pedido por um analista, com a arquitetura.
 */

const text = (max: number) => z.string().max(max);
const opt = (max: number) => text(max).nullable().optional();
const int = z.number().int().nullable().optional();

export const emulationSchema = z.object({
  sha256: text(64).optional(),
  kind: z.enum(['pe', 'shellcode']),
  arch: opt(20),
  filetype: opt(40),
  runtimeS: z.number().nonnegative().optional(),
  apiTotal: z.number().int().nonnegative(),
  apis: z
    .array(
      z.object({
        name: text(200),
        count: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
        args: z.array(text(200).nullable()).max(6),
        ret: opt(60),
      }),
    )
    .max(400),
  entryPoints: z
    .array(
      z.object({
        type: opt(120),
        start: opt(40),
        apis: z.number().int().nonnegative(),
        error: opt(120),
      }),
    )
    .max(50),
  files: z.array(z.object({ event: opt(40), path: text(500) })).max(200),
  registry: z.array(z.object({ event: opt(40), path: text(500), value: opt(200) })).max(200),
  network: z.object({
    dns: z.array(z.object({ query: text(300), response: opt(300) })).max(200),
    traffic: z
      .array(
        z.object({
          server: opt(300),
          port: int,
          proto: opt(40),
          method: opt(20),
          url: opt(500),
        }),
      )
      .max(200),
  }),
  processes: z
    .array(
      z.object({
        event: opt(40),
        pid: int,
        path: opt(500),
        cmdline: opt(500),
        protect: opt(60),
        size: int,
      }),
    )
    .max(200),
  dropped: z
    .array(
      z.object({ path: text(500), size: z.number().int().nullable().optional(), sha256: opt(64) }),
    )
    .max(200),
  dynamicCode: z.number().int().nonnegative(),
  strings: z.array(text(500).nullable()).max(300),
  errors: z
    .array(
      z.object({
        entry: opt(120),
        type: opt(120),
        api: opt(200),
        pc: opt(40),
        instr: opt(200),
      }),
    )
    .max(50),
  // A memoria que o programa alocou e escreveu, ao fim (plans/analise-estatica-ampliada, item 16).
  memory: z
    .object({
      regions: z
        .array(
          z.object({
            tag: text(120),
            base: text(20),
            size: z.number().int().nonnegative(),
            freed: z.boolean(),
            kind: z.enum(['pe', 'data']),
            entropy: z.number(),
            head: text(64),
            sha256: text(64),
            carved: text(64).optional(),
          }),
        )
        .max(30),
      carved: z
        .array(
          z.object({
            base: text(20),
            tag: text(120),
            sha256: text(64),
            size: z.number().int().nonnegative(),
            data: z.string().optional(),
            entryId: z.string().optional(),
          }),
        )
        .max(10),
    })
    .optional(),
});
export type EmulationResult = z.infer<typeof emulationSchema>;

/**
 * Os PEs achados na memoria da emulacao viram amostras filhas (item 16), como os do dump do sandbox.
 * A filha que ja saiu de uma emulacao nao gera netas: um carregador que se copia na memoria criaria
 * copias sem fim.
 */
async function persistEmulation(entryId: string, r: EmulationResult): Promise<EmulationResult> {
  if (!r.memory?.carved.length) return r;
  const self = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { sha256: true, parentEntryId: true },
  });
  // A fila da emulacao roda um trabalho por vez: o resultado da mae ja esta gravado aqui.
  const parentRun = self?.parentEntryId
    ? await prisma.serviceAnalysis.findUnique({
        where: { entryId_kind: { entryId: self.parentEntryId, kind: 'EMULATION' } },
        select: { result: true },
      })
    : null;
  const fromEmulation = ((parentRun?.result as EmulationResult | null)?.memory?.carved ?? []).some(
    (c) => c.entryId === entryId,
  );
  const carved = await createResourceChildren(
    entryId,
    r.memory.carved
      .filter((c) => c.sha256 !== self?.sha256)
      .map((c) => ({
        ...c,
        name: `memoria-${c.base}.exe`,
        data: fromEmulation ? undefined : c.data,
      })),
    (title, c) => `PE achado na memória da emulação de "${title}", região ${c.base} (${c.tag}).`,
    'emulate',
  );
  return {
    ...r,
    memory: { ...r.memory, carved: carved.map(({ name: _name, ...c }) => c) },
  };
}

const ANTI_DEBUG =
  /\.(IsDebuggerPresent|CheckRemoteDebuggerPresent|NtQueryInformationProcess|OutputDebugString[AW]?)$/i;
const RUN_KEYS =
  /\\(CurrentVersion\\(Run|RunOnce|Policies\\Explorer\\Run)|Winlogon|Image File Execution Options)\b/i;
const short = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Alertas legiveis a partir do resultado (a ficha e a pontuacao de risco leem estes). */
export function emulationAlerts(r: EmulationResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const injected = r.processes.find((p) => p.event === 'thread_inject' || p.event === 'mem_write');
  if (injected) {
    alerts.push({
      level: 'high',
      text: `Injeta código em outro processo (${short(injected.path ?? '?')}).`,
    });
  }
  const created = r.processes.filter((p) => p.event === 'create');
  const contacted = [
    ...r.network.traffic.map((t) => t.server).filter((s): s is string => Boolean(s)),
    ...r.network.dns.map((d) => d.query),
  ];
  if (contacted.length && created.length) {
    alerts.push({
      level: 'high',
      text: `Contata a rede e abre outro programa: ${short(contacted[0])} → ${short(created[0].cmdline ?? created[0].path ?? '?')}`,
    });
  } else if (contacted.length) {
    alerts.push({
      level: 'medium',
      text: `Contata a rede: ${short(contacted.slice(0, 3).join(', '))}`,
    });
  } else if (created.length) {
    alerts.push({
      level: 'medium',
      text: `Abre outro programa: ${short(created[0].cmdline ?? created[0].path ?? '?')}`,
    });
  }
  const persistence = r.registry.find((k) => RUN_KEYS.test(k.path));
  if (persistence) {
    alerts.push({
      level: 'high',
      text: `Mexe numa chave de inicialização: ${short(persistence.path)}`,
    });
  }
  if (r.dropped.length) {
    alerts.push({
      level: 'medium',
      text: `Grava ${r.dropped.length} arquivo(s): ${short(r.dropped[0].path)}`,
    });
  }
  if (r.apis.some((a) => ANTI_DEBUG.test(a.name))) {
    alerts.push({ level: 'medium', text: 'Checa se está sendo depurado.' });
  }
  if (r.dynamicCode > 0 && !injected) {
    alerts.push({
      level: 'medium',
      text: `Gera código em memória (${r.dynamicCode} região(ões)): costuma ser desempacotamento.`,
    });
  }
  if (r.apiTotal === 0) {
    alerts.push({
      level: 'info',
      text: 'Nenhuma chamada de API emulada: o código pode depender de algo que o emulador não tem.',
    });
  }
  const stopped = r.errors.find((e) => e.type);
  if (stopped) {
    alerts.push({
      level: 'info',
      text: `A emulação parou antes do fim: ${short(`${stopped.type}${stopped.api ? ` (${stopped.api})` : ''}`)}`,
    });
  }
  // Item 16: o PE que so existe na memoria (decifrado ou desempacotado pelo proprio programa).
  for (const c of (r.memory?.carved ?? []).slice(0, 3)) {
    alerts.push({
      level: 'high',
      text: `PE escrito na memória pelo próprio programa (${c.tag}, ${c.base}): desempacotado ou decifrado`,
    });
  }
  return alerts;
}

/** Destinos de rede, URLs das strings em memoria e os hashes dos arquivos gravados. */
export function emulationIocs(r: EmulationResult): string[] {
  const parts = [
    ...r.network.traffic.flatMap((t) => [t.server ?? '', t.url ?? '']),
    ...r.network.dns.map((d) => d.query),
    ...r.strings.filter((s): s is string => Boolean(s && /https?:\/\//i.test(s))),
    ...r.dropped.map((d) => d.sha256 ?? ''),
  ];
  return extractIocs(parts.join('\n')).map((i) => i.value);
}

export const emulationService = registerService({
  kind: 'EMULATION',
  name: 'emulate',
  url: () => env.EMULATE_URL,
  token: () => env.EMULATE_TOKEN,
  timeoutS: () => env.EMULATE_REQUEST_TIMEOUT_S,
  maxMb: () => env.EMULATE_MAX_MB,
  path: '/analyze',
  autoKinds: new Set(['pe']),
  // Shellcode: qualquer arquivo; PE: so o que e PE.
  manualOk: (typeId, options) => options.kind === 'shellcode' || typeId === 'pe',
  query: (options) =>
    options.kind === 'shellcode'
      ? `?kind=shellcode&arch=${options.arch === 'amd64' ? 'amd64' : 'x86'}`
      : '?kind=pe',
  schema: emulationSchema,
  alerts: emulationAlerts,
  iocs: emulationIocs,
  persist: persistEmulation,
});
