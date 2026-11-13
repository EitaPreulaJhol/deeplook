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
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { ApiToken } from '../api/types';
import { intlLocale } from '../i18n';
import { t as tr } from '../i18n/admin';
import { lastUse, SCOPE_LABEL, tokenState } from './ApiTokensTab';
import { useConfirm } from './HpsmConfirm';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

type AdminToken = ApiToken & {
  user: { id: string; displayName: string; email: string; apiAccess: boolean };
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Aba "Tokens de API" da Administracao: tokens pessoais de todos os usuarios,
 * com ultimo uso e IP, e revogacao individual. A liberacao do acesso fica na
 * aba Usuarios.
 */
export function AdminApiTokensTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'api-tokens', status],
    queryFn: () => api.get<{ tokens: AdminToken[] }>(`/admin/api-tokens?status=${status}`),
  });

  const revoke = async (t: AdminToken) => {
    const ok = await confirm({
      title: tr('revokeToken'),
      message: tr('revokeTokenMsg', { name: t.name, user: t.user.displayName }),
      confirmLabel: tr('revoke'),
      cancelLabel: tr('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/admin/api-tokens/${t.id}`);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      setNotice({ ok: true, text: tr('tokenRevoked', { name: t.name, user: t.user.displayName }) });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  const tokens = query.data?.tokens ?? [];

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmFilterBar onClear={() => setStatus('active')}>
        <HpsmFilterItem label={tr('show')} htmlFor="tokens-status">
          <Select
            id="tokens-status"
            labelText={tr('show')}
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'active' | 'all')}
          >
            <SelectItem value="active" text={tr('activeTokens')} />
            <SelectItem value="all" text={tr('allTokens')} />
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text={tr('loadingTokens')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && tokens.length === 0 && (
        <HpsmMessage kind="info">
          {status === 'active' ? tr('noActiveTokens') : tr('noTokens')}
        </HpsmMessage>
      )}
      {tokens.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label={tr('tokensAria')}>
            <TableHead>
              <TableRow>
                <TableHeader scope="col">{tr('user')}</TableHeader>
                <TableHeader scope="col">{tr('name')}</TableHeader>
                <TableHeader scope="col">{tr('purpose')}</TableHeader>
                <TableHeader scope="col">{tr('prefix')}</TableHeader>
                <TableHeader scope="col">{tr('createdOn')}</TableHeader>
                <TableHeader scope="col">{tr('expiresAt')}</TableHeader>
                <TableHeader scope="col">{tr('lastUse')}</TableHeader>
                <TableHeader scope="col">{tr('situation')}</TableHeader>
                <TableHeader scope="col">{tr('actions')}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {tokens.map((t) => {
                const state = tokenState(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <span title={t.user.email}>{t.user.displayName}</span>
                    </TableCell>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{SCOPE_LABEL[t.scope]}</TableCell>
                    <TableCell>
                      <span className="dl-mono">{t.prefix}…</span>
                    </TableCell>
                    <TableCell>{fmtDate(t.createdAt)}</TableCell>
                    <TableCell>{fmtDate(t.expiresAt)}</TableCell>
                    <TableCell>{lastUse(t)}</TableCell>
                    <TableCell>
                      <StatusText tone={state.tone}>{state.label}</StatusText>
                    </TableCell>
                    <TableCell>
                      {state.label === 'Ativo' ? (
                        <button
                          type="button"
                          className="dl-link-button dl-link-button--danger"
                          onClick={() => void revoke(t)}
                        >
                          {tr('revokeEllipsis')}
                        </button>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
