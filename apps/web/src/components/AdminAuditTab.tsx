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
  TextInput,
} from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../api/client';
import type { AuditAction, AuditChainState, AuditEvent } from '../api/types';
import { getLocale, intlLocale, localized } from '../i18n';
import { t } from '../i18n/admin';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const PAGE_SIZE = 50;

/** Rotulos e cores das acoes (o CSV usa os mesmos rotulos, no backend). */
export const AUDIT_ACTIONS: Record<AuditAction, { label: string; tone: StatusTone }> = localized(
  () => ({
    USER_REGISTERED: { label: t('act.USER_REGISTERED'), tone: 'green' },
    USER_ROLE_CHANGED: { label: t('act.USER_ROLE_CHANGED'), tone: 'blue' },
    USER_SUSPENDED: { label: t('act.USER_SUSPENDED'), tone: 'orange' },
    USER_REACTIVATED: { label: t('act.USER_REACTIVATED'), tone: 'green' },
    USER_LDAP_RELINKED: { label: t('act.USER_LDAP_RELINKED'), tone: 'red' },
    USER_PASSWORD_RESET: { label: t('act.USER_PASSWORD_RESET'), tone: 'orange' },
    USER_PASSWORD_CHANGED: { label: t('act.USER_PASSWORD_CHANGED'), tone: 'blue' },
    KEY_CREATED: { label: t('act.KEY_CREATED'), tone: 'blue' },
    KEY_REVOKED: { label: t('act.KEY_REVOKED'), tone: 'orange' },
    TEMPLATE_CREATED: { label: t('act.TEMPLATE_CREATED'), tone: 'gray' },
    TEMPLATE_UPDATED: { label: t('act.TEMPLATE_UPDATED'), tone: 'gray' },
    TEMPLATE_DELETED: { label: t('act.TEMPLATE_DELETED'), tone: 'gray' },
    LOGIN_FAILED: { label: t('act.LOGIN_FAILED'), tone: 'orange' },
    LOGIN_LOCKED: { label: t('act.LOGIN_LOCKED'), tone: 'red' },
    API_ACCESS_GRANTED: { label: t('act.API_ACCESS_GRANTED'), tone: 'blue' },
    API_ACCESS_REVOKED: { label: t('act.API_ACCESS_REVOKED'), tone: 'orange' },
    API_TOKEN_CREATED: { label: t('act.API_TOKEN_CREATED'), tone: 'blue' },
    API_TOKEN_REVOKED: { label: t('act.API_TOKEN_REVOKED'), tone: 'orange' },
    SESSION_REVOKED: { label: t('act.SESSION_REVOKED'), tone: 'orange' },
    TWO_FACTOR_ENABLED: { label: t('act.TWO_FACTOR_ENABLED'), tone: 'green' },
    TWO_FACTOR_DISABLED: { label: t('act.TWO_FACTOR_DISABLED'), tone: 'orange' },
    TWO_FACTOR_RECOVERY_CODES: { label: t('act.TWO_FACTOR_RECOVERY_CODES'), tone: 'blue' },
    TWO_FACTOR_RECOVERY_USED: { label: t('act.TWO_FACTOR_RECOVERY_USED'), tone: 'orange' },
    ENTRY_TRASHED: { label: t('act.ENTRY_TRASHED'), tone: 'orange' },
    ENTRY_RESTORED: { label: t('act.ENTRY_RESTORED'), tone: 'green' },
    ENTRY_DELETED: { label: t('act.ENTRY_DELETED'), tone: 'red' },
    ENTRY_DOWNLOADED: { label: t('act.ENTRY_DOWNLOADED'), tone: 'orange' },
    ENTRY_INTEGRITY_FAILED: { label: t('act.ENTRY_INTEGRITY_FAILED'), tone: 'red' },
    ENTRY_INTEGRITY_RESTORED: { label: t('act.ENTRY_INTEGRITY_RESTORED'), tone: 'green' },
    YARA_RULE_CREATED: { label: t('act.YARA_RULE_CREATED'), tone: 'gray' },
    YARA_RULE_UPDATED: { label: t('act.YARA_RULE_UPDATED'), tone: 'gray' },
    YARA_RULE_DELETED: { label: t('act.YARA_RULE_DELETED'), tone: 'gray' },
    ALLOWLIST_ADDED: { label: t('act.ALLOWLIST_ADDED'), tone: 'gray' },
    ALLOWLIST_REMOVED: { label: t('act.ALLOWLIST_REMOVED'), tone: 'gray' },
    ALLOWLIST_IMPORTED: { label: t('act.ALLOWLIST_IMPORTED'), tone: 'gray' },
    BACKUP_CREATED: { label: t('act.BACKUP_CREATED'), tone: 'blue' },
    BACKUP_DOWNLOADED: { label: t('act.BACKUP_DOWNLOADED'), tone: 'orange' },
    BACKUP_DELETED: { label: t('act.BACKUP_DELETED'), tone: 'gray' },
    COMPANY_DOMAIN_ADDED: { label: t('act.COMPANY_DOMAIN_ADDED'), tone: 'blue' },
    COMPANY_DOMAIN_REMOVED: { label: t('act.COMPANY_DOMAIN_REMOVED'), tone: 'orange' },
    TRIAGE_RULE_CHANGED: { label: t('act.TRIAGE_RULE_CHANGED'), tone: 'blue' },
    SETTING_CHANGED: { label: t('act.SETTING_CHANGED'), tone: 'blue' },
    YARA_PACK_UPDATED: { label: t('act.YARA_PACK_UPDATED'), tone: 'blue' },
    ASSIGNMENT_CHANGED: { label: t('act.ASSIGNMENT_CHANGED'), tone: 'blue' },
    BROADCAST_PUBLISHED: { label: t('act.BROADCAST_PUBLISHED'), tone: 'blue' },
    BROADCAST_ENDED: { label: t('act.BROADCAST_ENDED'), tone: 'gray' },
  }),
);

const PERIODS = localized(() => [
  { value: '1', text: t('last24h') },
  { value: '7', text: t('last7') },
  { value: '30', text: t('last30') },
  { value: '90', text: t('last90') },
  { value: '', text: t('allTime') },
]);

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Aba "Auditoria" da Administracao: quem mudou papeis, suspendeu contas,
 * redefiniu senhas, gerou ou revogou chaves, mexeu nos modelos de relatorio e
 * as tentativas de login recusadas ou bloqueadas. Somente leitura.
 */
export function AdminAuditTab() {
  const [action, setAction] = useState('');
  const [days, setDays] = useState('30');
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  // Busca com espera curta, como nas listas de amostras.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(draftQ.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [draftQ]);

  const filters = new URLSearchParams();
  if (action) filters.set('action', action);
  if (days) filters.set('days', days);
  if (q) filters.set('q', q);
  const params = new URLSearchParams(filters);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));

  const query = useQuery({
    queryKey: ['admin', 'audit', action, days, q, offset],
    queryFn: () =>
      api.get<{ total: number; items: AuditEvent[] }>(`/admin/audit?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  // Cadeia de hash: cada evento leva o hash do anterior; a API confere a cadeia inteira.
  const chain = useQuery({
    queryKey: ['admin', 'audit', 'verify'],
    queryFn: () => api.get<AuditChainState>('/admin/audit/verify'),
    staleTime: 60_000,
  });

  const clear = () => {
    setAction('');
    setDays('30');
    setDraftQ('');
    setQ('');
    setOffset(0);
  };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + PAGE_SIZE, total);
  const lastOffset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);

  return (
    <>
      <HpsmFilterBar
        onClear={clear}
        exportHref={`/api/admin/audit/export.csv?${filters.toString()}&lang=${getLocale()}`}
      >
        <HpsmFilterItem label={t('search')} htmlFor="audit-q">
          <TextInput
            id="audit-q"
            labelText={t('search')}
            hideLabel
            size="sm"
            placeholder={t('auditSearchPlaceholder')}
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label={t('action')} htmlFor="audit-action">
          <Select
            id="audit-action"
            labelText={t('action')}
            hideLabel
            size="sm"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            <SelectItem value="" text={t('allF')} />
            {(Object.keys(AUDIT_ACTIONS) as AuditAction[]).map((key) => (
              <SelectItem key={key} value={key} text={AUDIT_ACTIONS[key].label} />
            ))}
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label={t('period')} htmlFor="audit-days">
          <Select
            id="audit-days"
            labelText={t('period')}
            hideLabel
            size="sm"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setOffset(0);
            }}
          >
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value} text={p.text} />
            ))}
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {chain.data && !chain.data.ok && (
        <HpsmMessage kind="error">
          {t('chainBroken', { reason: chain.data.problem?.reason ?? t('unknownReason') })}
        </HpsmMessage>
      )}
      {chain.data?.ok && chain.data.head && (
        <p className="dl-audit__chain">
          {t(chain.data.events === 1 ? 'chainOkOne' : 'chainOkMany', { n: chain.data.events })}{' '}
          <span className="dl-mono" title={chain.data.head.hash}>
            #{chain.data.head.seq} {chain.data.head.hash.slice(0, 16)}…
          </span>
        </p>
      )}
      {query.isLoading && <HpsmLoading text={t('loadingAudit')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('auditError', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {query.data && total === 0 && <HpsmMessage kind="info">{t('noAudit')}</HpsmMessage>}

      {query.data && (
        <>
          <TableContainer>
            <Table size="xs" aria-label={t('auditAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('date')}</TableHeader>
                  <TableHeader scope="col">{t('who')}</TableHeader>
                  <TableHeader scope="col">{t('action')}</TableHeader>
                  <TableHeader scope="col">{t('target')}</TableHeader>
                  <TableHeader scope="col">{t('detail')}</TableHeader>
                  <TableHeader scope="col">IP</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="dl-audit__date">{fmtDate(event.createdAt)}</TableCell>
                    <TableCell>
                      {event.actor ? (
                        <span title={event.actor.email}>{event.actor.displayName}</span>
                      ) : (
                        <span className="dl-audit__anon">{t('anonymous')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={AUDIT_ACTIONS[event.action].tone}>
                        {AUDIT_ACTIONS[event.action].label}
                      </StatusText>
                    </TableCell>
                    <TableCell>
                      <span className="dl-mono">
                        {event.targetLabel ?? event.targetUser?.email ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>{event.detail ?? '—'}</TableCell>
                    <TableCell>
                      <span className="dl-mono">{event.ip ?? '—'}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <div className="dl-table-foot">
            <span>{t('showing', { first, last, total })}</span>
            <div className="hpsm-pager" role="group" aria-label={t('pagination')}>
              <button
                type="button"
                className="hpsm-pager__btn"
                title={t('firstPage')}
                aria-label={t('firstPage')}
                disabled={offset === 0}
                onClick={() => setOffset(0)}
              >
                «
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title={t('prevPage')}
                aria-label={t('prevPage')}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t('prevShort')}
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title={t('nextPage')}
                aria-label={t('nextPage')}
                disabled={last >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t('nextShort')}
              </button>
              <button
                type="button"
                className="hpsm-pager__btn"
                title={t('lastPage')}
                aria-label={t('lastPage')}
                disabled={last >= total}
                onClick={() => setOffset(lastOffset)}
              >
                »
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
