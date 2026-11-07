import { Checkbox, Select, SelectItem, TextInput } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import {
  describeDraft,
  monthGrid,
  runsOn,
  type ScheduleDraft,
  upcomingLocal,
  validTime,
  WEEKDAY_LABELS,
} from './backupSchedule';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';

interface ScheduleView {
  schedule:
    | (ScheduleDraft & {
        timezone: string;
        nextRunAt: string | null;
        lastRunAt: string | null;
      })
    | null;
  summary: string | null;
  passwordConfigured: boolean;
  destination: 'dir' | 'bucket';
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const EMPTY: ScheduleDraft = {
  enabled: false,
  mode: 'weekly',
  days: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  time: '02:00',
};

const fmt = (d: Date) =>
  d.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Um mes do calendario, com os dias do backup marcados. */
function MonthCalendar({
  year,
  month,
  draft,
}: {
  year: number;
  month: number;
  draft: ScheduleDraft;
}) {
  const today = new Date();
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const past = (d: Date) => d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return (
    <table className="dl-backup-cal" aria-label={`Backups em ${MONTHS[month]} de ${year}`}>
      <caption>
        {MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1)} de {year}
      </caption>
      <thead>
        <tr>
          {WEEKDAY_LABELS.map((w) => (
            <th key={w} scope="col">
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthGrid(year, month).map((week, i) => (
          <tr key={i}>
            {week.map((d, j) => {
              if (!d) return <td key={j} />;
              const on = !past(d) && runsOn(draft, d);
              return (
                <td
                  key={j}
                  className={[
                    on ? 'is-backup' : '',
                    isToday(d) ? 'is-today' : '',
                    past(d) ? 'is-past' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={on ? `Backup às ${draft.time}` : undefined}
                >
                  {d.getDate()}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Backup agendado (item 6.13): dias da semana ou do mes e horario, no fuso deste navegador, com o
 * calendario dos proximos dois meses. O ZIP agendado leva as amostras e sai com a senha
 * BACKUP_SCHEDULE_PASSWORD do .env; sem ela, o agendamento nao liga.
 */
export function AdminBackupSchedule() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'backups', 'schedule'],
    queryFn: () => api.get<ScheduleView>('/admin/backups/schedule'),
  });
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = query.data?.schedule ?? null;

  useEffect(() => {
    if (saved) {
      setDraft({
        enabled: saved.enabled,
        mode: saved.mode,
        days: saved.days,
        dayOfMonth: saved.dayOfMonth,
        time: saved.time,
      });
    }
  }, [saved]);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const upcoming = useMemo(() => upcomingLocal(draft, new Date(), 5), [draft]);
  const months = [0, 1].map((i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const toggleDay = (day: number, on: boolean) =>
    setDraft((d) => ({
      ...d,
      days: on ? [...new Set([...d.days, day])].sort() : d.days.filter((x) => x !== day),
    }));

  const problem = !validTime(draft.time)
    ? 'Informe o horário no formato HH:MM.'
    : draft.enabled && draft.mode === 'weekly' && draft.days.length === 0
      ? 'Escolha ao menos um dia da semana.'
      : null;

  const save = async () => {
    if (problem) {
      setNotice({ ok: false, text: problem });
      return;
    }
    setNotice(null);
    setBusy(true);
    try {
      await api.put('/admin/backups/schedule', { ...draft, timezone });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'backups', 'schedule'] });
      setNotice({
        ok: true,
        text: draft.enabled
          ? `Agendamento salvo: ${describeDraft(draft)}.`
          : 'Agendamento desligado.',
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (query.isLoading) return <HpsmLoading text="Carregando o agendamento..." />;
  const data = query.data;

  return (
    <HpsmSection title="Backup agendado" className="dl-mt-lg">
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {data && !data.passwordConfigured && (
        <HpsmMessage kind="info">
          Para ligar o agendamento, defina BACKUP_SCHEDULE_PASSWORD no .env (12 caracteres ou mais)
          e reinicie a API: o backup agendado leva as amostras e sai sempre com senha.
        </HpsmMessage>
      )}
      {saved?.enabled && saved.timezone !== timezone && (
        <HpsmMessage kind="warning">
          O agendamento foi salvo no fuso {saved.timezone}; este navegador está em {timezone}. O
          calendário abaixo usa o fuso daqui, e salvar daqui passa a valer o fuso daqui.
        </HpsmMessage>
      )}
      <p className="dl-backup__intro">
        O backup agendado leva os arquivos das amostras (malware) e sai com a senha
        BACKUP_SCHEDULE_PASSWORD do .env. Vai para{' '}
        {data?.destination === 'dir'
          ? 'a pasta de backup (BACKUP_DIR).'
          : 'o MinIO, no mesmo disco dos dados: configure BACKUP_DIR para levá-lo para fora.'}{' '}
        Se a API estiver fora do ar na hora marcada, ele sai quando ela voltar.
      </p>
      <div className="dl-backup-schedule">
        <div className="dl-backup-schedule__form">
          <Checkbox
            id="schedule-enabled"
            labelText="Gerar backup automaticamente"
            checked={draft.enabled}
            disabled={busy || (!data?.passwordConfigured && !draft.enabled)}
            onChange={(_, { checked }) => setDraft((d) => ({ ...d, enabled: checked }))}
          />
          <Select
            id="schedule-mode"
            labelText="Repetir"
            value={draft.mode}
            disabled={busy}
            onChange={(e) =>
              setDraft((d) => ({ ...d, mode: e.target.value as ScheduleDraft['mode'] }))
            }
          >
            <SelectItem value="weekly" text="Nos dias da semana escolhidos" />
            <SelectItem value="monthly" text="Uma vez por mês" />
          </Select>
          {draft.mode === 'weekly' ? (
            <fieldset className="dl-backup-schedule__days">
              <legend className="cds--label">Dias da semana</legend>
              <div className="dl-backup-schedule__day-grid">
                {WEEKDAY_LABELS.map((label, day) => (
                  <Checkbox
                    key={label}
                    id={`schedule-day-${day}`}
                    labelText={label}
                    checked={draft.days.includes(day)}
                    disabled={busy}
                    onChange={(_, { checked }) => toggleDay(day, checked)}
                  />
                ))}
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={busy}
                  onClick={() => setDraft((d) => ({ ...d, days: [0, 1, 2, 3, 4, 5, 6] }))}
                >
                  Todos os dias
                </button>
              </div>
            </fieldset>
          ) : (
            <Select
              id="schedule-day-of-month"
              labelText="Dia do mês"
              helperText="Até o dia 28, para valer em todos os meses."
              value={String(draft.dayOfMonth)}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))}
            >
              {Array.from({ length: 28 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)} text={`Dia ${i + 1}`} />
              ))}
            </Select>
          )}
          <TextInput
            id="schedule-time"
            type="time"
            labelText="Horário"
            helperText={`Horário deste navegador (${timezone}).`}
            value={draft.time}
            disabled={busy}
            invalid={!validTime(draft.time)}
            invalidText="Use o formato HH:MM."
            onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
          />
          <button
            type="button"
            className="dl-btn dl-btn--primary"
            disabled={busy}
            onClick={() => void save()}
          >
            Salvar agendamento
          </button>
          {saved?.enabled && saved.nextRunAt && (
            <p className="dl-backup__counts">
              Salvo: {data?.summary}. Próximo: {fmt(new Date(saved.nextRunAt))}.
            </p>
          )}
          {saved?.lastRunAt && (
            <p className="dl-backup__counts">Último agendado: {fmt(new Date(saved.lastRunAt))}.</p>
          )}
        </div>
        <div className="dl-backup-schedule__calendar">
          <div className="dl-backup-schedule__months">
            {months.map((m) => (
              <MonthCalendar key={`${m.year}-${m.month}`} {...m} draft={draft} />
            ))}
          </div>
          <h4 className="dl-backup-schedule__next-title">Próximas execuções</h4>
          {upcoming.length ? (
            <ol className="dl-backup-schedule__next">
              {upcoming.map((d) => (
                <li key={d.getTime()}>{fmt(d)}</li>
              ))}
            </ol>
          ) : (
            <p className="dl-static-empty">
              {draft.enabled ? 'Nenhuma execução com esta escolha.' : 'Agendamento desligado.'}
            </p>
          )}
        </div>
      </div>
    </HpsmSection>
  );
}
