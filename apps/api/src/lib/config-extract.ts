import { z } from 'zod';

import { env } from '../env';
import { extractIocs } from './iocs';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Configuracao de familias conhecidas (plans/novas-analises, item 2): o servico extract
 * (apps/extract) roda as regras YARA do CAPEv2, e o extrator do CAPE da familia reconhecida tira a
 * configuracao (C2, chaves, campanha, mutex). Todo executavel do Windows vai sozinho para a fila,
 * inclusive as amostras filhas do desempacotador e as tiradas da memoria do sandbox (item 3).
 */

const text = (max: number) => z.string().max(max);

/** A configuracao e livre (cada familia tem a sua): JSON com tetos de tamanho e profundidade. */
const configValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    text(2000),
    z.array(configValue).max(200),
    z.record(text(200), configValue),
  ]),
);

export const configSchema = z.object({
  sha256: text(64).optional(),
  parsers: z.number().int().nonnegative().optional(),
  matches: z.array(z.object({ rule: text(200).nullable(), family: text(200).nullable() })).max(200),
  configs: z.array(z.object({ family: text(200), config: configValue })).max(50),
  errors: z.array(z.object({ family: text(200), error: text(300).nullable() })).max(50),
});
export type ConfigResult = z.infer<typeof configSchema>;

/** As familias reconhecidas, sem repetir. */
export const configFamilies = (r: ConfigResult): string[] => [
  ...new Set([
    ...r.configs.map((c) => c.family),
    ...r.matches.map((m) => m.family).filter((f): f is string => Boolean(f)),
  ]),
];

export function configAlerts(r: ConfigResult): ServiceAlert[] {
  const alerts: ServiceAlert[] = [];
  for (const c of r.configs) {
    alerts.push({
      level: 'high',
      text: `Configuração de ${c.family} extraída (família identificada).`,
    });
  }
  const withConfig = new Set(r.configs.map((c) => c.family));
  const others = configFamilies(r).filter((f) => !withConfig.has(f));
  if (others.length) {
    alerts.push({
      level: 'medium',
      text: `Regra do CAPE reconhece ${others.join(', ')}, sem configuração extraída.`,
    });
  }
  for (const e of r.errors) {
    alerts.push({ level: 'info', text: `O extrator de ${e.family} falhou: ${e.error ?? '?'}` });
  }
  return alerts;
}

/** C2, URLs e dominios dos valores da configuracao. */
export function configIocs(r: ConfigResult): string[] {
  return extractIocs(JSON.stringify(r.configs.map((c) => c.config))).map((i) => i.value);
}

export const configService = registerService({
  kind: 'CONFIG',
  name: 'extract',
  url: () => env.EXTRACT_URL,
  token: () => env.EXTRACT_TOKEN,
  timeoutS: () => env.EXTRACT_REQUEST_TIMEOUT_S,
  maxMb: () => env.EXTRACT_MAX_MB,
  path: '/config',
  autoKinds: new Set(['pe']),
  // Os extratores tambem leem .NET, scripts de stage e blobs: o analista pode pedir para qualquer
  // arquivo.
  manualOk: () => true,
  query: () => '',
  schema: configSchema,
  alerts: configAlerts,
  iocs: configIocs,
});
