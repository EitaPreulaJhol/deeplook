import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/shell';
import { clearWorkspaceTabs } from './workspace';

/** Aviso aparece este tempo antes de a sessao expirar. */
const WARN_BEFORE_MS = 2 * 60_000;
/** Atividade do usuario renova a sessao no maximo uma vez por este intervalo. */
const TOUCH_EVERY_MS = 60_000;
/** Eventos que contam como atividade (inclusive dentro do console do sandbox). */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'mousemove', 'touchstart'] as const;

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Sessao por inatividade (padrao HPSM): atividade do usuario renova a sessao
 * (POST /api/auth/touch); 2 min antes de expirar aparece "Continuar conectado";
 * ao expirar, volta ao login com aviso. Antes de avisar ou encerrar, confere a
 * validade no servidor - outra janela pode ter renovado a sessao.
 */
export function SessionWatcher() {
  const { user, clearSession, logout } = useAuth();
  const navigate = useNavigate();
  const loggedIn = Boolean(user);

  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [warning, setWarning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastTouch = useRef(0);
  const activeSinceTouch = useRef(false);
  const warningRef = useRef(false);
  warningRef.current = warning;
  const expiredRef = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  const expire = useCallback(() => {
    expiredRef.current = true;
    setWarning(false);
    setExpiresAt(null);
    clearWorkspaceTabs();
    clearSession();
  }, [clearSession]);

  const touch = useCallback(async () => {
    lastTouch.current = Date.now();
    activeSinceTouch.current = false;
    try {
      const res = await api.post<{ expiresAt: string }>('/auth/touch', {});
      setExpiresAt(Date.parse(res.expiresAt));
      setWarning(false);
    } catch {
      expire();
    }
  }, [expire]);

  /** Validade atual no servidor, sem renovar (null = sessao ja expirou). */
  const recheck = useCallback(async (): Promise<number | null> => {
    try {
      const res = await api.get<{ expiresAt: string }>('/auth/session');
      const exp = Date.parse(res.expiresAt);
      setExpiresAt(exp);
      return exp;
    } catch {
      return null;
    }
  }, []);

  // Entrar (ou abrir o app) conta como atividade.
  useEffect(() => {
    if (loggedIn) void touch();
    else {
      setExpiresAt(null);
      setWarning(false);
    }
  }, [loggedIn, touch]);

  // Atividade do usuario renova a sessao (no maximo 1x/min). Com o aviso na
  // tela, so o botao "Continuar conectado" renova.
  useEffect(() => {
    if (!loggedIn) return;
    const onActivity = () => {
      if (warningRef.current) return;
      activeSinceTouch.current = true;
      if (Date.now() - lastTouch.current >= TOUCH_EVERY_MS) void touch();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { capture: true, passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
    };
  }, [loggedIn, touch]);

  // 2 min antes do fim: confere no servidor e avisa (ou renova, se houve atividade).
  useEffect(() => {
    if (!expiresAt || warning) return;
    const id = window.setTimeout(
      async () => {
        const exp = await recheck();
        if (exp === null) return expire();
        if (exp - Date.now() > WARN_BEFORE_MS + 5_000) return; // renovada em outra janela
        if (activeSinceTouch.current) return void touch();
        setNow(Date.now());
        setWarning(true);
      },
      Math.max(0, expiresAt - WARN_BEFORE_MS - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [expiresAt, warning, recheck, expire, touch]);

  // Com o aviso na tela: contagem regressiva e encerramento no fim do prazo.
  useEffect(() => {
    if (!warning || !expiresAt) return;
    continueRef.current?.focus();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const id = window.setTimeout(
      async () => {
        const exp = await recheck();
        if (exp !== null && exp - Date.now() > WARN_BEFORE_MS) return setWarning(false);
        expire();
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(id);
    };
  }, [warning, expiresAt, recheck, expire]);

  // Depois de expirar (o app ja voltou as rotas publicas): login com o aviso.
  useEffect(() => {
    if (!loggedIn && expiredRef.current) {
      expiredRef.current = false;
      navigate('/login', {
        replace: true,
        state: { notice: t('sessionExpired') },
      });
    }
  }, [loggedIn, navigate]);

  if (!warning || !expiresAt) return null;

  return (
    <div className="hpsm-modal" role="presentation">
      <div
        className="hpsm-modal__box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dl-session-title"
        aria-describedby="dl-session-message"
      >
        <h2 id="dl-session-title" className="hpsm-modal__head">
          {t('sessionExpiring')}
        </h2>
        <div className="hpsm-modal__body">
          <span className="hpsm-modal__icon" aria-hidden="true">
            !
          </span>
          <div id="dl-session-message" className="hpsm-modal__message">
            {t('expiring1')}{' '}
            <strong className="dl-session-countdown">{mmss(expiresAt - now)}</strong>
            {t('expiring2')}
          </div>
        </div>
        <div className="hpsm-modal__actions">
          <button
            ref={continueRef}
            type="button"
            className="dl-btn dl-btn--primary"
            onClick={() => void touch()}
          >
            {t('staySignedIn')}
          </button>
          <button
            type="button"
            className="dl-btn"
            onClick={async () => {
              setWarning(false);
              await logout();
              clearWorkspaceTabs();
              navigate('/login');
            }}
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
