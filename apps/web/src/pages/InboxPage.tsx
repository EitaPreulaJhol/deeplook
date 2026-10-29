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
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AppNotification } from '../api/types';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import {
  notificationHref,
  notificationResolution,
  notificationText,
  useMarkRead,
  useNotifications,
} from '../components/notifications';
import { PageHeader } from '../components/PageHeader';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Caixa de entrada (To Do do HPSM): as ultimas 100 notificacoes, com filtro
 * de nao lidas. Clique ou Enter abrem a amostra e marcam como lida.
 */
export function InboxPage() {
  const navigate = useNavigate();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const query = useNotifications(100, onlyUnread);
  const markRead = useMarkRead();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const items = query.data?.items ?? [];
  const unread = query.data?.unread ?? 0;

  const open = (n: AppNotification) => {
    if (!n.readAt) void markRead([n.id]);
    navigate(notificationHref(n));
  };
  const onRowKeyDown = (event: KeyboardEvent, index: number, n: AppNotification) => {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : null;
    if (target !== null) {
      event.preventDefault();
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(n);
    }
  };

  return (
    <>
      <HpsmToolbar label="Ações da caixa de entrada">
        <HpsmToolbarButton
          label="Marcar todas como lidas"
          disabled={unread === 0}
          onClick={() => void markRead()}
        />
        <HpsmToolbarButton label="Atualizar" icon={IconRefresh} onClick={() => query.refetch()} />
      </HpsmToolbar>
      <PageHeader
        title="Caixa de entrada"
        subtitle="Atribuições, amostras concluídas, menções e atualizações nas suas amostras."
      />
      <div className="dl-history-filter">
        <Checkbox
          id="inbox-only-unread"
          labelText={`Somente não lidas (${unread})`}
          checked={onlyUnread}
          onChange={(_, { checked }) => setOnlyUnread(checked)}
        />
      </div>

      {query.isLoading && <HpsmLoading text="Carregando notificações..." />}
      {query.data && items.length === 0 && (
        <HpsmMessage kind="info">
          {onlyUnread ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação ainda.'}
        </HpsmMessage>
      )}
      {items.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label="Notificações (setas navegam, Enter abre)">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">
                  <span className="cds--visually-hidden">Situação</span>
                </TableHeader>
                <TableHeader scope="col">Notificação</TableHeader>
                <TableHeader scope="col">Amostra</TableHeader>
                <TableHeader scope="col">Quando</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((n, index) => (
                <TableRow
                  key={n.id}
                  ref={(el: HTMLTableRowElement | null) => {
                    rowRefs.current[index] = el;
                  }}
                  className={`hpsm-grid-row${n.readAt ? '' : ' dl-inbox-unread'}`}
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => open(n)}
                  onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, n)}
                >
                  <TableCell className="dl-inbox-state">
                    {!n.readAt && <span className="hpsm-inbox__dot" title="Não lida" />}
                    <span className="cds--visually-hidden">{n.readAt ? 'Lida' : 'Não lida'}</span>
                  </TableCell>
                  <TableCell>
                    {notificationText(n)}
                    {n.detail &&
                      (n.type === 'MENTION' ||
                        n.type === 'COMMENT' ||
                        n.type === 'REPORT_RETURNED') && (
                        <div className="hpsm-inbox__detail">“{n.detail}”</div>
                      )}
                    {notificationResolution(n) && (
                      <div className="hpsm-inbox__detail dl-resolution-line">
                        O que fazer: {notificationResolution(n)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{n.entry.title}</TableCell>
                  <TableCell>{fmtDate(n.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
