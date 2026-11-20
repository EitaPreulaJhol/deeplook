import { z } from 'zod';

import { env } from '../env';
import { registerService, type ServiceAlert } from './service-analysis';

/**
 * Pontuacao do EMBER2024 (plans/analise-estatica-ampliada, item 29): o modelo LightGBM de PE do
 * benchmark do EMBER2024, no servico ml, sobre os 2568 atributos do EMBER v3. Sinal fraco e
 * informativo: fica fora do risco ate ser medido num corpus com falso positivo conhecido (os
 * programas minimos dos testes, por exemplo, saem quase todos acima de 95%).
 */

export const emberSchema = z.object({
  model: z.string().max(60),
  score: z.number().min(0).max(1),
  features: z.number().int().nonnegative(),
});
export type EmberResult = z.infer<typeof emberSchema>;

export const emberAlerts = (r: EmberResult): ServiceAlert[] => [
  {
    level: 'info',
    text: `Modelo de ML (EMBER2024): ${Math.round(r.score * 100)}% de chance de ser malicioso (informativo, fora do risco)`,
  },
];

export const emberService = registerService({
  kind: 'EMBER',
  name: 'ml',
  url: () => env.ML_URL,
  token: () => env.ML_TOKEN,
  timeoutS: () => env.ML_REQUEST_TIMEOUT_S,
  maxMb: () => env.ML_MAX_MB,
  path: '/ember',
  autoKinds: new Set(['pe']),
  manualOk: (typeId) => typeId === 'pe',
  query: () => '',
  schema: emberSchema,
  alerts: emberAlerts,
  iocs: () => [],
});
