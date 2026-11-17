import { z } from 'zod';

import { env } from '../env';
import { createResourceChildren, getSources, putSources, sourceKeysOf } from './decompiled-store';
import { extractIocs } from './iocs';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Descompilacao de Java com o CFR: o servico jar (apps/jarcfr) devolve o fonte (um arquivo por
 * classe), os achados por regra, o manifesto, os ofuscadores e os arquivos embutidos no JAR. O fonte
 * fica no armazenamento (jar/<amostra>.json.gz), fora do banco; os executaveis, pacotes e scripts
 * embutidos viram amostras filhas. Todo JAR e .class vai sozinho para a fila.
 */

const text = (max: number) => z.string().max(max);

export const jarSchema = z.object({
  module: z.object({
    name: text(200).nullable(),
    mainClass: text(300).nullable(),
    agentClass: text(300).nullable(),
    javaVersion: text(40).nullable(),
    createdBy: text(200).nullable(),
    classes: z.number().int(),
  }),
  types: z
    .array(z.object({ path: text(500), size: z.number().int(), lines: z.number().int() }))
    .max(20_000),
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
  resources: z
    .array(
      z.object({
        name: text(500),
        size: z.number().int(),
        sha256: text(64),
        kind: text(40).nullable(),
        entropy: z.number(),
        data: z.string().optional(),
        entryId: z.string().optional(),
      }),
    )
    .max(500),
  urls: z.array(text(400)).max(200),
  sources: z.record(z.string(), z.string()),
  /** Classes que o CFR nao conseguiu descompilar por completo. */
  failed: z.number().int(),
  truncated: z.boolean(),
});
export type JarResult = z.infer<typeof jarSchema>;

/** O que fica no banco: sem o fonte e sem os bytes dos arquivos embutidos. */
export type JarStored = Omit<JarResult, 'sources' | 'resources'> & {
  resources: Omit<JarResult['resources'][number], 'data'>[];
  sourceKey: string | null;
};

export const jarSourceKey = (entryId: string) => `jar/${entryId}.json.gz`;

/** O porque de cada regra do servico (o texto fica aqui, com a traducao em data-en.ts). */
const WHY: Record<string, string> = {
  exec: 'inicia outro programa ou comando do sistema',
  classloader: 'carrega classes a partir de bytes ou de uma URL (carga em memória)',
  reflection: 'chama métodos por reflexão',
  network: 'acessa a rede (download de carga ou envio de dados)',
  crypto: 'cifra ou decifra conteúdo (carga ou configuração cifrada)',
  base64: 'decodifica conteúdo em Base64',
  native: 'carrega código nativo ou mexe na memória (Unsafe)',
  'script-engine': 'executa script (JavaScript) em tempo de execução',
  jndi: 'consulta JNDI (vetor de execução remota, como o Log4Shell)',
  deserialization: 'desserializa objetos (execução por gadget)',
  persistence: 'grava em local de inicialização (persistência)',
  'screen-keys': 'tira print da tela ou captura teclas',
  'browser-data': 'lê dados de navegador ou carteira (credenciais)',
  'discord-telegram': 'envia dados por Telegram ou Discord',
  'minecraft-session': 'lê o token da sessão do Minecraft (roubo de conta)',
  agent: 'agente Java ou anexa a outra JVM',
  'anti-vm': 'procura máquina virtual ou sandbox (anti-análise)',
};
export const jarWhy = (rule: string, fallback: string) => WHY[rule] ?? fallback;

/** O rotulo do arquivo embutido nos alertas. */
const EMBEDDED: Record<string, string> = {
  pe: 'executável',
  elf: 'executável',
  macho: 'executável',
  zip: 'ZIP',
  script: 'script',
};

export function jarAlerts(r: JarResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const byRule = new Map<string, JarResult['findings']>();
  for (const f of r.findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const list of byRule.values()) {
    const f = list[0];
    alerts.push({
      level: f.level,
      text: `${jarWhy(f.rule, f.why)}: ${f.path}, linha ${f.line}`,
    });
  }
  if (r.module.agentClass) {
    alerts.push({
      level: 'medium',
      text: `Agente Java (${r.module.agentClass}): o JAR se anexa a outra JVM`,
    });
  }
  for (const name of r.obfuscators) {
    alerts.push({
      level: 'medium',
      text:
        name === 'unknown'
          ? 'Nomes ilegíveis: ofuscado por uma ferramenta não identificada'
          : `Ofuscado com ${name}: a descompilação pode estar ilegível`,
    });
  }
  if (r.failed > 0) {
    alerts.push({
      level: 'info',
      text: `${r.failed} classe(s) não foram descompiladas por completo (ofuscação ou bytecode incomum)`,
    });
  }
  for (const res of r.resources) {
    const label = res.kind ? EMBEDDED[res.kind] : undefined;
    if (label) {
      // Executavel escondido num JAR e o sinal forte; pacote ou script embutido pesa menos.
      alerts.push({
        level: res.kind === 'zip' || res.kind === 'script' ? 'medium' : 'high',
        text: `Recurso embutido ${label}: ${res.name}`,
      });
    } else if (res.size >= 64 * 1024 && res.entropy > 7.2 && !res.kind) {
      alerts.push({
        level: 'medium',
        text: `Recurso grande e cifrado (entropia ${res.entropy}): ${res.name}`,
      });
    }
  }
  return alerts;
}

export function jarIocs(r: JarResult): string[] {
  return extractIocs(r.urls.join('\n')).map((i) => i.value);
}

/**
 * Guarda o fonte no armazenamento e transforma os executaveis, pacotes e scripts embutidos em
 * amostras filhas. No banco fica o resto, com o id de cada filha.
 */
async function persistJar(entryId: string, r: JarResult): Promise<JarStored> {
  const key = jarSourceKey(entryId);
  await putSources(key, r.sources);
  const resources = await createResourceChildren(
    entryId,
    r.resources,
    (title, res) => `Arquivo embutido no JAR "${title}" (${res.name}).`,
    'jar',
  );
  const { sources: _sources, ...rest } = r;
  return { ...rest, resources, sourceKey: key };
}

/** O fonte de uma classe (o caminho do .java), ou null. */
export async function jarSource(entryId: string, path: string): Promise<string | null> {
  const all = await jarSources(entryId);
  return all?.[path] ?? null;
}

/** Todos os fontes guardados, ou null se nao ha (ou o objeto sumiu). */
export const jarSources = (entryId: string) => getSources(jarSourceKey(entryId));

/** O objeto do fonte (a lixeira apaga junto com a amostra). */
export const jarKeysOf = (entryId: string) => sourceKeysOf(entryId, 'JAR');

export const jarService = registerService({
  kind: 'JAR',
  name: 'jar',
  url: () => env.JAR_URL,
  token: () => env.JAR_TOKEN,
  timeoutS: () => env.JAR_REQUEST_TIMEOUT_S,
  maxMb: () => env.JAR_MAX_MB,
  path: '/decompile',
  autoKinds: new Set(['jar', 'java-class']),
  manualOk: (typeId) => typeId === 'jar' || typeId === 'java-class' || typeId === 'zip',
  query: () => '',
  schema: jarSchema,
  alerts: jarAlerts,
  iocs: jarIocs,
  persist: persistJar,
});
