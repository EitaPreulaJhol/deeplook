import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AppNotification } from '../api/types';
import { IconBell } from './icons';
import {
  notificationHref,
  notificationText,
  useMarkRead,
  useNotificationCount,
  useNotifications,
} from './notifications';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Quantas aparecem no painel do sininho (o resto fica na Caixa de entrada). */
const PANEL_LIMIT = 8;

/**
 * Sininho do masthead (To Do do HPSM): contador de nao lidas e painel com as
 * mais recentes. Clicar abre a amostra e marca como lida. Teclado: Enter,
 * Espaco ou seta abrem; setas navegam; Esc fecha e volta ao sininho.
 */
export function HpsmInboxMenu() {
  const navigate = useNavigate();
  const unread = useNotificationCount();
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const list = useNotifications(PANEL_LIMIT, false, open);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const items = list.data?.items ?? [];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Ao abrir (e quando a lista chega), o foco vai para a primeira notificacao.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    (
      root?.querySelector<HTMLElement>('.hpsm-inbox__item') ??
      root?.querySelector<HTMLElement>('[role="menuitem"]')
    )?.focus();
  }, [open, list.data]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const openNotification = (n: AppNotification) => {
    close(false);
    if (!n.readAt) void markRead([n.id]);
    navigate(notificationHref(n));
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const all = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const current = all.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => all[(i + all.length) % all.length]?.focus();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(current - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const label = unread
    ? `Caixa de entrada: ${unread} não lida${unread > 1 ? 's' : ''}`
    : 'Caixa de entrada';

  return (
    <div className="hpsm-usermenu hpsm-inbox" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="hpsm-inbox__bell"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconBell size={16} />
        {unread > 0 && (
          <span className="hpsm-inbox__badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="hpsm-usermenu__panel hpsm-inbox__panel"
          role="menu"
          aria-label="Caixa de entrada"
          onKeyDown={onMenuKeyDown}
        >
          <div className="hpsm-inbox__head" role="none">
            <span>Caixa de entrada</span>
            {unread > 0 && (
              <button
                type="button"
                role="menuitem"
                className="dl-link-button"
                onClick={() => void markRead()}
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          {list.isLoading && <div className="hpsm-inbox__empty">Carregando...</div>}
          {list.data && items.length === 0 && (
            <div className="hpsm-inbox__empty">Nenhuma notificação.</div>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              role="menuitem"
              className={`hpsm-usermenu__item hpsm-inbox__item${n.readAt ? '' : ' is-unread'}`}
              onClick={() => openNotification(n)}
            >
              <span className="hpsm-inbox__dot" aria-hidden="true" />
              <span className="hpsm-inbox__text">
                <span className="hpsm-inbox__title">{notificationText(n)}</span>
                <span className="hpsm-inbox__entry">{n.entry.title}</span>
                {n.detail &&
                  (n.type === 'MENTION' ||
                    n.type === 'COMMENT' ||
                    n.type === 'REPORT_RETURNED') && (
                    <span className="hpsm-inbox__detail">“{n.detail}”</span>
                  )}
              </span>
              <span className="hpsm-inbox__date">{fmtDate(n.createdAt)}</span>
              {!n.readAt && <span className="cds--visually-hidden"> (não lida)</span>}
            </button>
          ))}
          <div className="hpsm-usermenu__sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="hpsm-usermenu__item"
            onClick={() => {
              close(false);
              navigate('/inbox');
            }}
          >
            Ver todas na Caixa de entrada
          </button>
        </div>
      )}
    </div>
  );
}
