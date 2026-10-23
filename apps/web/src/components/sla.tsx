import type { Entry, SlaConfig } from '../api/types';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const HOUR = 3600 * 1000;

/** Idade legivel: "45 min", "5 h", "3 d 4 h". */
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

export type SlaLevel = 'ok' | 'warn' | 'late';

/** Limites da amostra: os da prioridade dela (padrao P3). */
export function limitsFor(
  entry: Pick<Entry, 'priority'>,
  sla: SlaConfig,
): { warnHours: number; lateHours: number } {
  return sla.byPriority?.[entry.priority ?? 'P3'] ?? sla;
}

/** Situacao do prazo da amostra (null = concluida, nao conta prazo). */
export function slaLevel(
  entry: Pick<Entry, 'status' | 'statusChangedAt' | 'priority'>,
  sla: SlaConfig | undefined,
  now = Date.now(),
): SlaLevel | null {
  if (entry.status === 'COMPLETED' || !entry.statusChangedAt) return null;
  if (!sla) return 'ok';
  const limits = limitsFor(entry, sla);
  const hours = (now - Date.parse(entry.statusChangedAt)) / HOUR;
  if (hours >= limits.lateHours) return 'late';
  if (hours >= limits.warnHours) return 'warn';
  return 'ok';
}

const TONES: Record<SlaLevel, StatusTone> = { ok: 'none', warn: 'orange', late: 'red' };
const LEVEL_TEXT: Record<SlaLevel, string> = {
  ok: 'no prazo',
  warn: 'em alerta',
  late: 'atrasada',
};

/**
 * Idade no status atual com o marcador do prazo (como os relogios de SLA do
 * HPSM): sem marcador no prazo, laranja em alerta, vermelho atrasada. Amostras
 * concluidas mostram "—".
 */
export function AgeText({
  entry,
  sla,
}: {
  entry: Pick<Entry, 'status' | 'statusChangedAt' | 'priority'>;
  sla?: SlaConfig;
}) {
  const level = slaLevel(entry, sla);
  if (!level || !entry.statusChangedAt) return <span>—</span>;
  const age = formatAge(Date.now() - Date.parse(entry.statusChangedAt));
  const lim = sla ? limitsFor(entry, sla) : null;
  const limits = lim
    ? ` (${entry.priority ?? 'P3'}: alerta acima de ${lim.warnHours} h, atraso acima de ${lim.lateHours} h)`
    : '';
  return (
    <span className="dl-age" title={`No status atual há ${age}: ${LEVEL_TEXT[level]}${limits}`}>
      <StatusText tone={TONES[level]}>{age}</StatusText>
      {level !== 'ok' && <span className="cds--visually-hidden"> ({LEVEL_TEXT[level]})</span>}
    </span>
  );
}
