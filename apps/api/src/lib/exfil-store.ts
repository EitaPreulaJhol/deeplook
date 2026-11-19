import type { ConfigResult } from './config-extract';
import { type Channel, findChannels, maskChannel, mergeChannels } from './exfil';
import { prisma } from './prisma';

/**
 * Os canais de exfiltracao de uma amostra (plans/analise-estatica-ampliada, item 3), de todas as
 * origens: os da analise estatica (strings e camadas de script) e os do .NET e do Java (calculados
 * sobre o codigo inteiro, quando o servico termina) ja vem prontos; os do FLOSS, da emulacao e da
 * configuracao do CAPE sao procurados aqui, no que ja esta guardado.
 */
export async function channelsOf(entryId: string): Promise<Channel[] | null> {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    select: {
      staticInfo: true,
      capaAnalysis: { select: { status: true, floss: true } },
      serviceAnalyses: {
        where: { status: 'DONE', kind: { in: ['DOTNET', 'JAR', 'EMULATION', 'CONFIG'] } },
        select: { kind: true, result: true },
      },
    },
  });
  if (!entry) return null;
  const lists: Channel[][] = [];
  lists.push(((entry.staticInfo as { channels?: Channel[] } | null)?.channels ?? []) as Channel[]);
  const floss = entry.capaAnalysis?.floss as {
    stack?: { string: string }[];
    tight?: { string: string }[];
    decoded?: { string: string }[];
  } | null;
  if (floss) {
    const text = [...(floss.stack ?? []), ...(floss.tight ?? []), ...(floss.decoded ?? [])]
      .map((s) => s.string)
      .join('\n');
    lists.push(findChannels(text, 'floss'));
  }
  for (const a of entry.serviceAnalyses) {
    const result = a.result as Record<string, unknown> | null;
    if (!result) continue;
    if (a.kind === 'DOTNET' || a.kind === 'JAR') {
      lists.push((result.channels as Channel[] | undefined) ?? []);
    } else if (a.kind === 'EMULATION') {
      const strings = (result.strings as (string | null)[] | undefined) ?? [];
      const network = JSON.stringify(result.network ?? {});
      lists.push(findChannels([...strings.filter(Boolean), network].join('\n'), 'emulation'));
    } else if (a.kind === 'CONFIG') {
      const configs = (result as unknown as ConfigResult).configs ?? [];
      lists.push(findChannels(JSON.stringify(configs.map((c) => c.config)), 'config'));
    }
  }
  return mergeChannels(lists);
}

/** Os canais para quem pede: a credencial escondida de quem nao e analista. */
export const channelsForViewer = (channels: Channel[], analyst: boolean) =>
  analyst ? channels : channels.map(maskChannel);

/**
 * Os trechos secretos de cada canal com credencial: o valor inteiro e, quando ele carrega usuario e
 * senha, a senha sozinha (e ela que aparece solta nas strings).
 */
function secretsIn(channels: Channel[]): string[] {
  const out = new Set<string>();
  for (const c of channels) {
    if (!c.credential) continue;
    out.add(c.value);
    if (c.kind === 'smtp-credential') out.add(c.value.slice(c.value.indexOf(':') + 1));
    const ftp = /\/\/[^:@/]+:([^@/]+)@/.exec(c.value);
    if (ftp) out.add(ftp[1]);
    // O token do Discord e do Slack e o fim da URL.
    const hook = /\/([\w-]{24,})$/.exec(c.value);
    if (hook) out.add(hook[1]);
  }
  // Segredo curto demais cortaria texto comum.
  return [...out].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length);
}

const cut = (secret: string) => `${secret.slice(0, 6)}…`;

function scrub<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') {
    let text: string = value;
    for (const s of secrets) if (text.includes(s)) text = text.split(s).join(cut(s));
    return text as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v, secrets)]),
    ) as T;
  }
  return value;
}

/**
 * Para quem nao e analista: tira a credencial dos canais de qualquer texto da resposta (a camada
 * normalizada do script, as URLs, os IOCs sugeridos, as strings do FLOSS). Para analista, nada muda.
 */
export async function scrubForViewer<T>(entryId: string, analyst: boolean, data: T): Promise<T> {
  if (analyst) return data;
  const secrets = secretsIn((await channelsOf(entryId)) ?? []);
  return secrets.length ? scrub(data, secrets) : data;
}
