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
import { lastUse, tokenState } from './ApiTokensTab';
import { useConfirm } from './HpsmConfirm';
import { HpsmFilterBar, HpsmFilterItem } from './HpsmFilterBar';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

type AdminToken = ApiToken & {
  user: { id: string; displayName: string; email: string; apiAccess: boolean };
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
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
      title: 'Revogar token',
      message: `O token "${t.name}" de ${t.user.displayName} deixa de funcionar imediatamente.`,
      confirmLabel: 'Revogar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/admin/api-tokens/${t.id}`);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      setNotice({ ok: true, text: `Token "${t.name}" de ${t.user.displayName} revogado.` });
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
        <HpsmFilterItem label="Mostrar" htmlFor="tokens-status">
          <Select
            id="tokens-status"
            labelText="Mostrar"
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'active' | 'all')}
          >
            <SelectItem value="active" text="Ativos" />
            <SelectItem value="all" text="Todos (inclui vencidos e revogados)" />
          </Select>
        </HpsmFilterItem>
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando tokens..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {query.data && tokens.length === 0 && (
        <HpsmMessage kind="info">
          {status === 'active' ? 'Nenhum token ativo.' : 'Nenhum token gerado.'}
        </HpsmMessage>
      )}
      {tokens.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label="Tokens de API">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Usuário</TableHeader>
                <TableHeader scope="col">Nome</TableHeader>
                <TableHeader scope="col">Início</TableHeader>
                <TableHeader scope="col">Criado em</TableHeader>
                <TableHeader scope="col">Expira em</TableHeader>
                <TableHeader scope="col">Último uso</TableHeader>
                <TableHeader scope="col">Situação</TableHeader>
                <TableHeader scope="col">Ações</TableHeader>
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
                          Revogar…
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
