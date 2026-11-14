import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { EntryEvent, EntryStatus, Priority, Verdict } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/entry';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import type { Mention } from './MentionTextArea';
import { MentionTextArea, renderMentions } from './MentionTextArea';
import { HpsmLoading, HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { priorityLabel, statusLabel, verdictLabel } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

/** Tamanho maximo de uma atualizacao (mesmo limite da API). */
const COMMENT_MAX = 4000;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

const SANDBOX_CLOSE_KEYS: Record<string, 'closeDiscarded' | 'closeExpired'> = {
  descartado: 'closeDiscarded',
  expirado: 'closeExpired',
};

/** Descricao legivel de um evento do historico (tambem usada na ficha impressa). Os detalhes
 * gravados pela API (motivos, nomes de regra) ficam como vieram. */
export function describeEvent(event: EntryEvent): string {
  const from = event.fromValue;
  const to = event.toValue;
  const detail = event.detail;
  const prio = (value?: string | null) => priorityLabel((value ?? 'P3') as Priority);
  switch (event.type) {
    case 'CREATED':
      return t('evCreated');
    case 'STATUS_CHANGED':
      return t('evStatus', {
        from: statusLabel(from as EntryStatus),
        to: statusLabel(to as EntryStatus),
      });
    case 'VERDICT_CHANGED':
      return (
        t('evVerdict', { from: verdictLabel(from as Verdict), to: verdictLabel(to as Verdict) }) +
        (detail === 'principal' ? ` ${t('evFollowingPrincipal')}` : '')
      );
    case 'REPORT_SUBMITTED':
      return t('evReportSubmitted');
    case 'REPORT_APPROVED':
      return t('evReportApproved');
    case 'REPORT_RETURNED':
      return detail ? t('evReportReturnedNote', { note: detail }) : t('evReportReturned');
    case 'MARKED_DUPLICATE':
      return t('evMarkedDuplicate', { title: to ?? t('evOtherSample') });
    case 'UNMARKED_DUPLICATE':
      return t('evUnmarkedDuplicate');
    case 'PRIORITY_CHANGED':
      return (
        t('evPriority', { from: prio(from), to: prio(to) }) +
        (detail === 'escalonamento'
          ? ` ${t('evEscalation')}`
          : detail === 'regra de triagem'
            ? ` ${t('evByTriageRule')}`
            : '')
      );
    case 'SLA_WARN':
      return t('evSlaWarn', { hours: detail ?? '?', priority: prio(from) });
    case 'SLA_LATE':
      return t('evSlaLate', { hours: detail ?? '?', priority: prio(from) });
    case 'FILE_PURGED':
      return detail ? t('evFilePurgedDetail', { detail }) : t('evFilePurged');
    case 'TRASHED':
      return t('evTrashed');
    case 'RESTORED':
      return t('evRestored');
    case 'TRIAGE_RULE':
      return t('evTriageRule', { rule: to ?? '—', detail: detail ?? '' });
    case 'RESOLUTION_SET':
      return (
        (to ? t('evResolutionSet', { text: to }) : t('evResolutionRemoved')) +
        (detail === 'principal' ? ` ${t('evFromPrincipal')}` : '')
      );
    case 'PAGE_CAPTURED':
      return t('evPageCaptured', { status: to ?? '—', detail: detail ? `, ${detail}` : '' });
    case 'CASE_ADDED':
      return t('evCaseAdded', { code: detail ?? '' }).trim();
    case 'CASE_REMOVED':
      return t('evCaseRemoved', { code: detail ?? '' }).trim();
    case 'ASSIGNED':
      return t('evAssigned', { from: from ?? '—', to: to ?? '—' }) + (detail ? ` (${detail})` : '');
    case 'REPORT_CREATED':
      return t('evReportDraft', { verdict: verdictLabel(to as Verdict) });
    case 'REPORT_PUBLISHED':
      return t('evReportPublished', { verdict: verdictLabel(to as Verdict) });
    case 'SANDBOX_OPENED':
      return t('evSandboxOpened');
    case 'SANDBOX_CLOSED': {
      const key = detail ? SANDBOX_CLOSE_KEYS[detail] : undefined;
      const reason = key ? t(key) : detail;
      return t('evSandboxClosed') + (reason ? ` (${reason})` : '');
    }
    case 'SANDBOX_AUTORUN':
      return t(to === 'no-sysmon' ? 'evSandboxAutoRunNoSysmon' : 'evSandboxAutoRun', {
        user: detail ?? '?',
      });
    case 'SANDBOX_FAILED':
      return detail ? t('evSandboxFailedDetail', { detail }) : t('evSandboxFailed');
    case 'COMMENT':
      return t('evComment');
    default:
      return event.type;
  }
}

/**
 * Aba "Historico": nova atualizacao (comentario livre, visivel para todos) e a
 * linha do tempo da amostra (quem fez o que e quando), com filtro para ver so
 * as atualizacoes.
 */
export function EntryHistoryTab({ entryId }: { entryId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['entry', entryId, 'events'];
  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ events: EntryEvent[] }>(`/entries/${entryId}/events`),
  });

  const [text, setText] = useState('');
  // Pessoas escolhidas no "@" (so vao as que continuam citadas no texto).
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [onlyComments, setOnlyComments] = useState(false);
  // Texto digitado e nao salvo: sair da aba/tela pede confirmacao.
  useUnsavedChanges(text.trim().length > 0);
  const check = useRequiredFields([
    {
      id: 'comment-text',
      label: t('evComment'),
      ok: text.trim().length > 0,
      api: 'text',
      value: text,
    },
  ]);

  const addComment = async () => {
    setResult(null);
    if (!check.check()) return;
    setSaving(true);
    try {
      const cited = mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
      await api.post(`/entries/${entryId}/comments`, { text, mentions: cited });
      setText('');
      setMentions([]);
      check.reset();
      setResult({ ok: true, text: t('updateRecorded') });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      if (!check.fromApi(err)) setResult({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S adiciona a atualizacao.
  useSaveShortcut(addComment, !saving);

  const events = query.data?.events ?? [];
  const comments = events.filter((e) => e.type === 'COMMENT');
  const shown = onlyComments ? comments : events;

  return (
    <>
      <HpsmSection title={t('newUpdate')}>
        <HpsmToolbar label={t('updateActions')}>
          <HpsmToolbarButton
            label={saving ? t('saving') : t('addUpdate')}
            title={t('addUpdateHelp')}
            icon={IconAdd}
            disabled={saving}
            onClick={addComment}
          />
        </HpsmToolbar>
        {result && (
          <HpsmMessage key={result.text} kind={result.ok ? 'success' : 'error'}>
            {result.text}
          </HpsmMessage>
        )}
        {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
        <HpsmForm>
          <HpsmField
            label={t('evComment')}
            htmlFor="comment-text"
            required
            wide
            top
            invalid={check.isInvalid('comment-text')}
            help={t('updateHelp', { n: text.length, max: COMMENT_MAX })}
          >
            <MentionTextArea
              id="comment-text"
              labelText={t('evComment')}
              hideLabel
              rows={3}
              maxLength={COMMENT_MAX}
              placeholder={t('updatePlaceholder')}
              value={text}
              onChange={setText}
              onMention={(m) =>
                setMentions((current) =>
                  current.some((c) => c.id === m.id) ? current : [...current, m],
                )
              }
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      {query.isLoading && <HpsmLoading text={t('loadingHistory')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('historyError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {query.data && events.length === 0 && <HpsmMessage kind="info">{t('noEvents')}</HpsmMessage>}
      {events.length > 0 && (
        <>
          <div className="dl-history-filter">
            <Checkbox
              id="history-only-comments"
              labelText={t('onlyUpdates', { n: comments.length })}
              checked={onlyComments}
              onChange={(_, { checked }) => setOnlyComments(checked)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="dl-history-empty">{t('noUpdates')}</p>
          ) : (
            <HistoryTable events={shown} />
          )}
        </>
      )}
    </>
  );
}

function HistoryTable({ events }: { events: EntryEvent[] }) {
  return (
    <TableContainer>
      <Table size="xs" aria-label={t('historyAria')}>
        <TableHead>
          <TableRow>
            <TableHeader scope="col">{t('colDate')}</TableHeader>
            <TableHeader scope="col">{t('colUser')}</TableHeader>
            <TableHeader scope="col">{t('colEvent')}</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((event) => (
            <TableRow
              key={event.id}
              className={event.type === 'COMMENT' ? 'dl-history-comment' : undefined}
            >
              <TableCell>{fmtDate(event.createdAt)}</TableCell>
              <TableCell>{event.actor?.displayName ?? t('system')}</TableCell>
              <TableCell>
                {event.type === 'COMMENT' ? (
                  <>
                    <strong>{describeEvent(event)}:</strong>
                    {/* Texto puro: o React escapa; quebras de linha preservadas no CSS. */}
                    <div className="dl-history-comment__text">
                      {renderMentions(event.detail ?? '', event.toValue)}
                    </div>
                  </>
                ) : (
                  describeEvent(event)
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
