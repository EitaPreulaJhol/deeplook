import {
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
import { intlLocale } from '../i18n';
import { useConfirm } from './HpsmConfirm';
import { HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconLogout } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface SessionRow {
  handle: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/**
 * Minha Conta > Sessoes (item 61): navegadores onde a conta esta logada, com IP
 * e ultimo acesso; encerrar uma sessao ou todas as outras (ex.: computador
 * emprestado, celular perdido).
 */
export function SessionsTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () => api.get<{ sessions: SessionRow[] }>('/me/sessions'),
  });
  const sessions = query.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['me', 'sessions'] });
      setNotice({ ok: true, text });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: SessionRow) => {
    const ok = await confirm({
      title: 'Encerrar sessão',
      message: `Encerrar a sessão em ${s.device}${s.ip ? ` (${s.ip})` : ''}? Quem estiver usando terá de entrar de novo.`,
      confirmLabel: 'Encerrar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/me/sessions/${s.handle}`);
      return `Sessão em ${s.device} encerrada.`;
    });
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: 'Encerrar as outras sessões',
      message: `Encerrar ${others} sessão(ões) em outros navegadores? Esta continua aberta.`,
      confirmLabel: 'Encerrar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const res = await api.post<{ revoked: number }>('/me/sessions/revoke-others', {});
      return `${res.revoked} sessão(ões) encerrada(s).`;
    });
  };

  return (
    <>
      <HpsmToolbar label="Ações das sessões">
        <HpsmToolbarButton
          label="Encerrar as outras sessões"
          icon={IconLogout}
          disabled={busy || others === 0}
          title={others === 0 ? 'Não há outras sessões abertas' : undefined}
          onClick={() => void revokeOthers()}
        />
      </HpsmToolbar>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text="Carregando sessões..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      <HpsmSection title={`Sessões abertas (${sessions.length})`}>
        <p className="dl-static-empty">
          Onde sua conta está logada agora. Se não reconhecer alguma, encerre-a e troque a senha.
        </p>
        {sessions.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label="Sessões abertas">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Navegador</TableHeader>
                  <TableHeader scope="col">IP</TableHeader>
                  <TableHeader scope="col">Entrou em</TableHeader>
                  <TableHeader scope="col">Último acesso</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.handle}>
                    <TableCell>
                      <span title={s.userAgent ?? undefined}>{s.device}</span>
                      {s.current && (
                        <>
                          {' '}
                          <StatusText tone="green">esta sessão</StatusText>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="dl-mono">{s.ip ?? '—'}</span>
                    </TableCell>
                    <TableCell>{fmtDate(s.createdAt)}</TableCell>
                    <TableCell>{fmtDate(s.lastSeenAt)}</TableCell>
                    <TableCell>
                      {s.current ? (
                        '—'
                      ) : (
                        <button
                          type="button"
                          className="dl-link-button dl-link-button--danger"
                          disabled={busy}
                          onClick={() => void revoke(s)}
                        >
                          Encerrar…
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
