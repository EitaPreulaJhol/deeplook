import { Select, SelectItem, TextInput } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { downloadUrl } from '../components/entryExport';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconDownload, IconPrint, IconRefresh } from '../components/icons';
import type { ManagementData } from '../components/ManagementReport';
import { ManagementReport, periodLabel } from '../components/ManagementReport';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { localized } from '../i18n';
import { t } from '../i18n/mgmt';

/** Data local AAAA-MM-DD. */
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Periodos prontos (datas locais). */
export function presetRange(preset: string, now = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysBack = (n: number) => ({
    from: ymd(new Date(y, m, now.getDate() - (n - 1))),
    to: ymd(now),
  });
  switch (preset) {
    case '7':
      return daysBack(7);
    case '30':
      return daysBack(30);
    case '90':
      return daysBack(90);
    case 'month':
      return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
    case 'lastMonth':
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'year':
      return { from: ymd(new Date(y, 0, 1)), to: ymd(now) };
    default:
      return null;
  }
}

const PRESETS = localized(() => [
  { value: '7', text: t('last7') },
  { value: '30', text: t('last30') },
  { value: '90', text: t('last90') },
  { value: 'month', text: t('thisMonth') },
  { value: 'lastMonth', text: t('lastMonth') },
  { value: 'year', text: t('thisYear') },
]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Periodo da URL (?de=&ate=); sem ele, os ultimos 30 dias. */
export function useManagementPeriod() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = presetRange('30')!;
  const from = DATE.test(searchParams.get('de') ?? '') ? searchParams.get('de')! : fallback.from;
  const to = DATE.test(searchParams.get('ate') ?? '') ? searchParams.get('ate')! : fallback.to;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const set = (next: { from: string; to: string }) => {
    const params = new URLSearchParams(searchParams);
    params.set('de', next.from);
    params.set('ate', next.to);
    setSearchParams(params, { replace: true });
  };
  const qs = `from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`;
  return { from, to, tz, set, qs };
}

export function useManagement(qs: string) {
  return useQuery({
    queryKey: ['management', qs],
    queryFn: () => api.get<ManagementData>(`/management?${qs}`),
  });
}

/**
 * Relatorio gerencial (item 77): resumo de um periodo para analistas e admins,
 * com exportacao em CSV e impressao.
 */
export function ManagementPage() {
  const { from, to, set, qs } = useManagementPeriod();
  const query = useManagement(qs);
  const preset = PRESETS.find((p) => {
    const r = presetRange(p.value);
    return r?.from === from && r.to === to;
  })?.value;

  return (
    <>
      <HpsmToolbar label={t('mgmtActions')}>
        <HpsmToolbarButton
          label={query.isFetching ? t('refreshing') : t('refresh')}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
        <HpsmToolbarButton
          label={t('exportCsv')}
          icon={IconDownload}
          disabled={!query.data}
          onClick={() => downloadUrl(`/api/management?${qs}&format=csv`)}
        />
        <HpsmToolbarButton
          label={t('print')}
          icon={IconPrint}
          disabled={!query.data}
          onClick={() => window.open(`/gerencial/imprimir?de=${from}&ate=${to}&auto=1`, '_blank')}
        />
      </HpsmToolbar>
      <PageHeader
        title={t('mgmtTitle')}
        subtitle={t('mgmtSubtitle', { period: periodLabel(from, to) })}
      />
      <HpsmFilterBar onClear={() => set(presetRange('30')!)}>
        <HpsmFilterItem label={t('periodLabel')} htmlFor="mgmt-preset">
          <Select
            id="mgmt-preset"
            labelText={t('periodLabel')}
            hideLabel
            size="sm"
            value={preset ?? ''}
            onChange={(e) => {
              const r = presetRange(e.target.value);
              if (r) set(r);
            }}
          >
            {!preset && <SelectItem value="" text={t('custom')} />}
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value} text={p.text} />
            ))}
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label={t('from')} htmlFor="mgmt-from">
          <TextInput
            id="mgmt-from"
            type="date"
            labelText={t('from')}
            hideLabel
            size="sm"
            value={from}
            max={to}
            onChange={(e) => DATE.test(e.target.value) && set({ from: e.target.value, to })}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('to')} htmlFor="mgmt-to">
          <TextInput
            id="mgmt-to"
            type="date"
            labelText={t('to')}
            hideLabel
            size="sm"
            value={to}
            min={from}
            onChange={(e) => DATE.test(e.target.value) && set({ from, to: e.target.value })}
          />
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={t('computingReport')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('reportError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {query.data && <ManagementReport data={query.data} />}
    </>
  );
}
