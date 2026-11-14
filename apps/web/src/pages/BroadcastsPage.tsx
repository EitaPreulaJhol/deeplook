import {
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { Broadcast } from '../components/BroadcastBanner';
import type { CaseSummary } from '../components/cases';
import { useConfirm } from '../components/HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/tags';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/mgmt';

type Row = Broadcast & { active: boolean; _count: { dismissals: number } };

const DURATIONS = localized(() => [
  { value: '4', text: t('dur4h') },
  { value: '24', text: t('dur1d') },
  { value: '72', text: t('dur3d') },
  { value: '168', text: t('dur1w') },
  { value: '720', text: t('dur30d') },
]);

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Avisos gerais (item 88): analistas publicam um aviso para todos, com nivel,
 * validade e caso opcional; no maximo 3 ativos. "Encerrar" tira da faixa na hora.
 */
export function BroadcastsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['broadcasts', 'all'],
    queryFn: () => api.get<{ items: Row[] }>('/broadcasts'),
  });
  const casesQuery = useQuery({
    queryKey: ['cases', 'active-for-broadcast'],
    queryFn: () => api.get<{ items: CaseSummary[] }>('/cases?status=active&limit=100'),
  });
  const items = query.data?.items ?? [];
  const active = items.filter((b) => b.active);
  const [form, setForm] = useState({ text: '', level: 'INFO', hours: '24', caseId: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const check = useRequiredFields([
    {
      id: 'broadcast-text',
      label: t('textRange'),
      ok: form.text.trim().length >= 5,
      api: 'text',
      value: form.text,
    },
  ]);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      setNotice({ ok: true, text });
    } catch (err) {
      if (!check.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!check.check()) return;
    void run(async () => {
      await api.post('/broadcasts', {
        text: form.text,
        level: form.level,
        hours: Number(form.hours),
        caseId: form.caseId || null,
      });
      setForm({ text: '', level: 'INFO', hours: '24', caseId: '' });
      check.reset();
      return t('broadcastPublished');
    });
  };

  const end = async (b: Row) => {
    const ok = await confirm({
      title: t('endBroadcast'),
      message: t('endBroadcastConfirm', { text: b.text }),
      confirmLabel: t('end'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.post(`/broadcasts/${b.id}/end`);
      return t('broadcastEnded');
    });
  };

  return (
    <>
      <PageHeader title={t('broadcastsTitle')} subtitle={t('broadcastsSubtitle')} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

      <HpsmSection title={t('newBroadcast')}>
        {active.length >= 3 ? (
          <p className="dl-static-empty">{t('maxActive')}</p>
        ) : (
          <HpsmForm columns={2}>
            <HpsmField
              label={t('text')}
              htmlFor="broadcast-text"
              required
              wide
              top
              invalid={check.isInvalid('broadcast-text')}
            >
              <TextArea
                id="broadcast-text"
                labelText={t('text')}
                hideLabel
                rows={2}
                maxLength={300}
                placeholder={t('broadcastPlaceholder')}
                value={form.text}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
              />
            </HpsmField>
            <HpsmField label={t('level')} htmlFor="broadcast-level">
              <Select
                id="broadcast-level"
                labelText={t('level')}
                hideLabel
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
              >
                <SelectItem value="INFO" text={t('info')} />
                <SelectItem value="WARNING" text={t('warning')} />
              </Select>
            </HpsmField>
            <HpsmField label={t('validFor')} htmlFor="broadcast-hours">
              <Select
                id="broadcast-hours"
                labelText={t('validFor')}
                hideLabel
                value={form.hours}
                onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
              >
                {DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value} text={d.text} />
                ))}
              </Select>
            </HpsmField>
            <HpsmField label={t('caseOptional')} htmlFor="broadcast-case">
              <Select
                id="broadcast-case"
                labelText={t('case')}
                hideLabel
                value={form.caseId}
                onChange={(e) => setForm((f) => ({ ...f, caseId: e.target.value }))}
              >
                <SelectItem value="" text={t('noneOption')} />
                {(casesQuery.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id} text={`${c.code} · ${c.title}`} />
                ))}
              </Select>
            </HpsmField>
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={publish}
              >
                {t('publishBroadcast')}
              </button>
            </HpsmFormActions>
          </HpsmForm>
        )}
      </HpsmSection>

      <HpsmSection title={t('broadcastsN', { n: items.length })}>
        {query.isLoading && <HpsmLoading text={t('loadingBroadcasts')} />}
        {items.length === 0 && !query.isLoading ? (
          <p className="dl-static-empty">{t('noBroadcasts')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={t('broadcastsTitle')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('notice')}</TableHeader>
                  <TableHeader scope="col">{t('level')}</TableHeader>
                  <TableHeader scope="col">{t('by')}</TableHeader>
                  <TableHeader scope="col">{t('validUntil')}</TableHeader>
                  <TableHeader scope="col">{t('dismissedBy')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id} className={b.active ? undefined : 'is-off'}>
                    <TableCell>
                      {b.text}
                      {b.case && (
                        <>
                          {' '}
                          <Link className="dl-link" to={`/casos/${b.case.id}`}>
                            ({b.case.code})
                          </Link>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={b.level === 'WARNING' ? 'orange' : 'blue'}>
                        {b.level === 'WARNING' ? t('warning') : t('info')}
                      </StatusText>
                    </TableCell>
                    <TableCell>{b.createdBy?.displayName ?? '—'}</TableCell>
                    <TableCell>
                      {fmt(b.expiresAt)}
                      {!b.active && ` ${t('endedParen')}`}
                    </TableCell>
                    <TableCell>{t('peopleN', { n: b._count.dismissals })}</TableCell>
                    <TableCell>
                      {b.active && (
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void end(b)}
                        >
                          {t('end')}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
