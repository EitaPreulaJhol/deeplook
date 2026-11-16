import { gunzipSync, gzipSync } from 'node:zlib';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';

import { env } from '../env';
import { extractIocs } from './iocs';
import { log } from './log';
import { prisma } from './prisma';
import { s3 } from './s3';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Descompilacao de .NET com o ILSpy (plans/caca-e-formatos, item 3): o servico dotnet (apps/dotnet)
 * devolve o projeto C# (um arquivo por tipo), os achados por regra, os ofuscadores e os recursos
 * embutidos. O fonte fica no armazenamento (dotnet/<amostra>.json.gz), fora do banco; os recursos
 * PE e ZIP viram amostras filhas. Todo PE .NET vai sozinho para a fila.
 */

const text = (max: number) => z.string().max(max);

export const dotnetSchema = z.object({
  module: z.object({
    name: text(200).nullable(),
    framework: text(200).nullable(),
    outputType: text(200).nullable(),
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
  truncated: z.boolean(),
});
export type DotnetResult = z.infer<typeof dotnetSchema>;

/** O que fica no banco: sem o fonte e sem os bytes dos recursos. */
export type DotnetStored = Omit<DotnetResult, 'sources' | 'resources'> & {
  resources: Omit<DotnetResult['resources'][number], 'data'>[];
  sourceKey: string | null;
};

export const dotnetSourceKey = (entryId: string) => `dotnet/${entryId}.json.gz`;

/** O log da criacao das filhas (createFileEntry pede o formato do Fastify). */
const childLog = {
  info: (m: string) => log.info(m),
  warn: (o: unknown, m?: string) => log.warn(m ?? String(o)),
  error: (o: unknown, m?: string) => log.error(m ?? String(o)),
  debug: () => undefined,
  child: () => childLog,
} as unknown as FastifyBaseLogger;

/** O porque de cada regra do servico (o texto fica aqui, com a traducao em data-en.ts). */
const WHY: Record<string, string> = {
  'assembly-load': 'carrega um assembly a partir de bytes ou de um arquivo (carga em memória)',
  invoke: 'chama por reflexão um método carregado em tempo de execução',
  download: 'baixa conteúdo da internet',
  'process-start': 'inicia outro programa',
  'run-key': 'grava na chave Run do registro (persistência)',
  crypto: 'decifra conteúdo (carga ou configuração cifrada)',
  base64: 'decodifica conteúdo em Base64',
  'native-memory': 'mexe na memória de processos (injeção ou shellcode)',
  'anti-debug': 'procura depurador (anti-análise)',
  'anti-vm': 'procura máquina virtual ou sandbox (anti-análise)',
  'browser-data': 'lê dados de navegador ou carteira (credenciais)',
  keylogger: 'captura teclas',
  screenshot: 'tira print da tela',
  'discord-telegram': 'envia dados por Telegram ou Discord',
  defender: 'mexe no Defender',
};
export const dotnetWhy = (rule: string, fallback: string) => WHY[rule] ?? fallback;

export function dotnetAlerts(r: DotnetResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  const byRule = new Map<string, DotnetResult['findings']>();
  for (const f of r.findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  for (const list of byRule.values()) {
    const f = list[0];
    alerts.push({
      level: f.level,
      text: `${dotnetWhy(f.rule, f.why)}: ${f.path}, linha ${f.line}`,
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
  for (const res of r.resources) {
    if (res.kind === 'pe' || res.kind === 'zip') {
      alerts.push({
        level: 'high',
        text: `Recurso embutido ${res.kind === 'pe' ? 'executável' : 'ZIP'}: ${res.name}`,
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

export function dotnetIocs(r: DotnetResult): string[] {
  return extractIocs(r.urls.join('\n')).map((i) => i.value);
}

/**
 * Guarda o fonte no armazenamento e transforma os recursos PE e ZIP em amostras filhas (do mesmo
 * dono, sem cota, como as de um desempacotamento). No banco fica o resto, com o id de cada filha.
 */
async function persistDotnet(entryId: string, r: DotnetResult): Promise<DotnetStored> {
  const key = dotnetSourceKey(entryId);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: gzipSync(JSON.stringify(r.sources)),
      ContentType: 'application/gzip',
    }),
  );
  const parent = await prisma.entry.findUnique({
    where: { id: entryId },
    select: { ownerId: true, title: true, tags: { select: { id: true } } },
  });
  const { createFileEntry } = await import('./entry-create');
  const resources: DotnetStored['resources'] = [];
  for (const { data, ...res } of r.resources) {
    if (!data || !parent) {
      resources.push(res);
      continue;
    }
    try {
      const name = res.name.split('/').pop() || 'recurso.bin';
      const { entry } = await createFileEntry(
        { log: childLog },
        parent.ownerId,
        {
          buffer: Buffer.from(data, 'base64'),
          filename: name,
          mimetype: 'application/octet-stream',
          title: name,
          description: `Recurso embutido no assembly .NET "${parent.title}" (${res.name}).`,
          tags: parent.tags,
          parentEntryId: entryId,
        },
        { remaining: null },
        1,
      );
      resources.push({ ...res, entryId: entry.id });
    } catch (err) {
      log.warn(`[dotnet] falha ao criar a filha ${res.name}: ${String(err)}`);
      resources.push(res);
    }
  }
  const { sources: _sources, ...rest } = r;
  return { ...rest, resources, sourceKey: key };
}

/** O fonte de um tipo (o caminho do .cs no projeto), ou null. */
export async function dotnetSource(entryId: string, path: string): Promise<string | null> {
  const all = await dotnetSources(entryId);
  return all?.[path] ?? null;
}

/** Todos os fontes guardados, ou null se nao ha (ou o objeto sumiu). */
export async function dotnetSources(entryId: string): Promise<Record<string, string> | null> {
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: dotnetSourceKey(entryId) }),
    );
    const gz = Buffer.from(await obj.Body!.transformToByteArray());
    return JSON.parse(gunzipSync(gz, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
  } catch {
    return null;
  }
}

/** O objeto do fonte (a lixeira apaga junto com a amostra). */
export async function dotnetKeysOf(entryId: string): Promise<string[]> {
  const row = await prisma.serviceAnalysis.findUnique({
    where: { entryId_kind: { entryId, kind: 'DOTNET' } },
    select: { result: true },
  });
  const key = (row?.result as { sourceKey?: string } | null)?.sourceKey;
  return key ? [key] : [];
}

/** PE com metadados do CLR (a analise estatica achou o .NET). */
const isDotnet = (staticInfo: unknown) =>
  Boolean((staticInfo as { pe?: { dotnet?: unknown } } | null)?.pe?.dotnet);

export const dotnetService = registerService({
  kind: 'DOTNET',
  name: 'dotnet',
  url: () => env.DOTNET_URL,
  token: () => env.DOTNET_TOKEN,
  timeoutS: () => env.DOTNET_REQUEST_TIMEOUT_S,
  maxMb: () => env.DOTNET_MAX_MB,
  path: '/decompile',
  autoKinds: new Set(['pe']),
  autoOk: isDotnet,
  manualOk: (typeId) => typeId === 'pe',
  query: () => '',
  schema: dotnetSchema,
  alerts: dotnetAlerts,
  iocs: dotnetIocs,
  persist: persistDotnet,
});
