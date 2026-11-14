import { Checkbox, Select, SelectItem, TextInput } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/admin';
import { t as ts } from '../i18n/shell';
import {
  describeDraft,
  monthGrid,
  runsOn,
  type ScheduleDraft,
  upcomingLocal,
  validTime,
  WEEKDAY_LABELS,
} from './backupSchedule';
import { HpsmField, HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconSettings } from './icons';
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
  /** Falhou, atrasado, pasta com problema ou sem a senha (o mesmo erro do status). */
  problem?: string | null;
}

const MONTHS = localized(() =>
  Array.from({ length: 12 }, (_, m) =>
    new Date(2026, m, 1).toLocaleDateString(intlLocale(), { month: 'long' }),
  ),
);

const EMPTY: ScheduleDraft = {
  enabled: false,
  mode: 'weekly',
  days: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  time: '02:00',
};

const fmt = (d: Date) =>
  d.toLocaleString(intlLocale(), {
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
    <table className="dl-backup-cal" aria-label={t('calAria', { month: MONTHS[month], year })}>
      <caption>
        {t('calCaption', { month: MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1), year })}
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
                  title={on ? t('backupAt', { time: draft.time }) : undefined}
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
    ? t('timeFormat')
    : draft.enabled && draft.mode === 'weekly' && draft.days.length === 0
      ? t('pickWeekday')
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
        text: draft.enabled ? t('scheduleSaved', { desc: describeDraft(draft) }) : t('scheduleOff'),
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Carregando: o aviso fica dentro da secao (solto, ficava entre as secoes da aba).
  if (query.isLoading) {
    return (
      <HpsmSection title={t('scheduledBackup')}>
        <HpsmLoading text={t('loadingSchedule')} />
      </HpsmSection>
    );
  }
  const data = query.data;

  return (
    <HpsmSection title={t('scheduledBackup')}>
      <HpsmToolbar label={t('scheduleActions')}>
        <HpsmToolbarButton
          label={t('saveSchedule')}
          icon={IconSettings}
          disabled={busy}
          onClick={() => void save()}
        />
      </HpsmToolbar>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {data?.problem && data.passwordConfigured && (
        <HpsmMessage kind="error">{t('scheduleProblem', { problem: data.problem })}</HpsmMessage>
      )}
      {data && !data.passwordConfigured && (
        <HpsmMessage kind="info">{t('schedulePwdHint')}</HpsmMessage>
      )}
      {saved?.enabled && saved.timezone !== timezone && (
        <HpsmMessage kind="warning">
          {t('tzMismatch', { saved: saved.timezone, current: timezone })}
        </HpsmMessage>
      )}
      <p className="dl-backup__intro">
        {t('schedIntro', {
          dest: data?.destination === 'dir' ? t('destDir') : t('destMinio'),
        })}
      </p>
      <div className="dl-backup-schedule">
        <div className="dl-backup-schedule__form">
          <HpsmForm>
            <HpsmField label={t('schedule')}>
              <Checkbox
                id="schedule-enabled"
                labelText={t('autoBackup')}
                checked={draft.enabled}
                disabled={busy || (!data?.passwordConfigured && !draft.enabled)}
                onChange={(_, { checked }) => setDraft((d) => ({ ...d, enabled: checked }))}
              />
            </HpsmField>
            <HpsmField label={t('repeat')} htmlFor="schedule-mode">
              <Select
                id="schedule-mode"
                labelText={t('repeat')}
                hideLabel
                size="sm"
                value={draft.mode}
                disabled={busy}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, mode: e.target.value as ScheduleDraft['mode'] }))
                }
              >
                <SelectItem value="weekly" text={t('onWeekdays')} />
                <SelectItem value="monthly" text={t('monthly')} />
              </Select>
            </HpsmField>
            {draft.mode === 'weekly' ? (
              <HpsmField label={t('weekdays')} top>
                <fieldset className="dl-backup-schedule__days">
                  <legend className="cds--visually-hidden">{t('weekdays')}</legend>
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
                      {t('everyDay')}
                    </button>
                  </div>
                </fieldset>
              </HpsmField>
            ) : (
              <HpsmField
                label={t('dayOfMonth')}
                htmlFor="schedule-day-of-month"
                help={t('dayOfMonthHelp')}
              >
                <Select
                  id="schedule-day-of-month"
                  labelText={t('dayOfMonth')}
                  hideLabel
                  size="sm"
                  value={String(draft.dayOfMonth)}
                  disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))}
                >
                  {Array.from({ length: 28 }, (_, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)} text={t('dayN', { n: i + 1 })} />
                  ))}
                </Select>
              </HpsmField>
            )}
            <HpsmField
              label={t('time')}
              htmlFor="schedule-time"
              invalid={!validTime(draft.time)}
              help={validTime(draft.time) ? t('browserTime', { tz: timezone }) : t('timeInvalid')}
            >
              <TextInput
                id="schedule-time"
                // Texto HH:MM, e nao type="time": o nativo segue o idioma do navegador ("02:00 AM"
                // com a interface em portugues; pendencias da varredura visual, item 1).
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
                placeholder={ts('timePlaceholder')}
                labelText={t('time')}
                hideLabel
                size="sm"
                value={draft.time}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
              />
            </HpsmField>
          </HpsmForm>
          {saved?.enabled && saved.nextRunAt && (
            <p className="dl-backup__counts">
              {t('savedNext', {
                // Descrito aqui, no idioma da tela: o resumo da API vem sempre em portugues.
                summary: `${describeDraft(saved)} (${saved.timezone})`,
                next: fmt(new Date(saved.nextRunAt)),
              })}
            </p>
          )}
          {saved?.lastRunAt && (
            <p className="dl-backup__counts">
              {t('lastScheduled', { date: fmt(new Date(saved.lastRunAt)) })}
            </p>
          )}
        </div>
        <div className="dl-backup-schedule__calendar">
          <div className="dl-backup-schedule__months">
            {months.map((m) => (
              <MonthCalendar key={`${m.year}-${m.month}`} {...m} draft={draft} />
            ))}
          </div>
          <h4 className="dl-backup-schedule__next-title">{t('upcoming')}</h4>
          {upcoming.length ? (
            <ol className="dl-backup-schedule__next">
              {upcoming.map((d) => (
                <li key={d.getTime()}>{fmt(d)}</li>
              ))}
            </ol>
          ) : (
            <p className="dl-static-empty">{draft.enabled ? t('noRuns') : t('scheduleOff')}</p>
          )}
        </div>
      </div>
    </HpsmSection>
  );
}
