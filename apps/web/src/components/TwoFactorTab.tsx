import { PasswordInput, TextInput } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { intlLocale } from '../i18n';
import { CopyButton } from './CopyButton';
import { downloadText } from './entryExport';
import { useConfirm } from './HpsmConfirm';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmReadonly,
  HpsmSection,
  useRequiredFields,
} from './HpsmForm';
import { HpsmMessage } from './messages';
import { StatusText } from './tags';

interface TwoFactorInfo {
  enabled: boolean;
  enabledAt: string | null;
  recoveryRemaining: number;
}

interface Setup {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

/** "ABCD EFGH IJKL..." para digitar a chave a mao. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/** Codigos de recuperacao recem-gerados: mostrados uma unica vez. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  return (
    <HpsmSection title="Códigos de recuperação">
      <HpsmMessage kind="warning">
        Guarde estes códigos num lugar seguro. Cada um entra uma única vez, no lugar do código do
        aplicativo (ex.: se você perder o celular). Eles não serão mostrados de novo.
      </HpsmMessage>
      <ul className="dl-2fa__codes" aria-label="Códigos de recuperação">
        {codes.map((c) => (
          <li key={c} className="dl-mono">
            {c}
          </li>
        ))}
      </ul>
      <div className="hpsm-form__buttons">
        <span className="dl-2fa__copy">
          <CopyButton value={text} label="códigos de recuperação" /> Copiar
        </span>
        <button
          type="button"
          className="dl-btn"
          onClick={() =>
            downloadText('deeplook-codigos-de-recuperacao.txt', `${text}\n`, 'text/plain')
          }
        >
          Baixar (.txt)
        </button>
        <button type="button" className="dl-btn dl-btn--primary" onClick={onDone}>
          Guardei os códigos
        </button>
      </div>
    </HpsmSection>
  );
}

/**
 * Minha Conta > 2FA (opcional): ativar com o QR code e um codigo do aplicativo,
 * codigos de recuperacao, gerar novos e desativar (senha + codigo).
 */
export function TwoFactorTab() {
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const confirm = useConfirm();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Vindo do login com codigo de recuperacao: aviso para gerar novos ou reconfigurar.
  const arrival = (useLocation().state as { notice?: string } | null)?.notice;

  const query = useQuery({
    queryKey: ['me', '2fa'],
    queryFn: () => api.get<TwoFactorInfo>('/me/2fa'),
  });
  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['me', '2fa'] });
    await refresh();
  };

  const enableCheck = useRequiredFields([
    {
      id: 'tfa-code',
      label: 'Código do aplicativo',
      ok: /^\d{6}$/.test(code.trim()),
      api: 'code',
      value: code,
    },
  ]);
  const sensitiveCheck = useRequiredFields([
    {
      id: 'tfa-password',
      label: 'Senha atual',
      ok: password.length > 0,
      api: 'password',
      value: password,
    },
    {
      id: 'tfa-confirm-code',
      label: 'Código',
      ok: code.trim().length >= 6,
      api: 'code',
      value: code,
    },
  ]);

  const run = async (fn: () => Promise<void>) => {
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      try {
        setSetup(await api.post<Setup>('/me/2fa/setup', {}));
        setCode('');
        enableCheck.reset();
      } catch (err) {
        setNotice({ ok: false, text: (err as Error).message });
      }
    });

  const enable = () =>
    run(async () => {
      if (!enableCheck.check()) return;
      try {
        const res = await api.post<{ recoveryCodes: string[] }>('/me/2fa/enable', {
          code: code.trim(),
        });
        setSetup(null);
        setCode('');
        enableCheck.reset();
        setCodes(res.recoveryCodes);
        setNotice({
          ok: true,
          text: '2FA ativado. A partir do próximo login, o código será pedido.',
        });
        await reload();
      } catch (err) {
        if (!enableCheck.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
      }
    });

  const regenerate = () =>
    run(async () => {
      if (!sensitiveCheck.check()) return;
      try {
        const res = await api.post<{ recoveryCodes: string[] }>('/me/2fa/recovery-codes', {
          password,
          code: code.trim(),
        });
        setPassword('');
        setCode('');
        sensitiveCheck.reset();
        setCodes(res.recoveryCodes);
        setNotice({ ok: true, text: 'Novos códigos gerados; os anteriores deixaram de valer.' });
        await reload();
      } catch (err) {
        if (!sensitiveCheck.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
      }
    });

  const disable = async () => {
    if (!sensitiveCheck.check()) return;
    const ok = await confirm({
      title: 'Desativar 2FA',
      message: 'O login volta a pedir só a senha, e os códigos de recuperação deixam de valer.',
      confirmLabel: 'Desativar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        await api.post('/me/2fa/disable', { password, code: code.trim() });
        setPassword('');
        setCode('');
        sensitiveCheck.reset();
        setNotice({ ok: true, text: '2FA desativado.' });
        await reload();
      } catch (err) {
        if (!sensitiveCheck.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
      }
    });
  };

  const info = query.data;
  if (!info) return null;
  const message = enableCheck.message ?? sensitiveCheck.message;

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {arrival && !notice && <HpsmMessage kind="warning">{arrival}</HpsmMessage>}
      {message && <HpsmMessage kind="error">{message}</HpsmMessage>}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

      <HpsmSection title="Autenticação em dois fatores (2FA)" className="dl-form-col">
        <HpsmForm>
          <HpsmField label="Situação">
            <HpsmReadonly>
              {info.enabled ? (
                <StatusText tone="green">
                  Ativo desde{' '}
                  {info.enabledAt ? new Date(info.enabledAt).toLocaleDateString(intlLocale()) : '—'}
                </StatusText>
              ) : (
                <StatusText tone="gray">Desativado</StatusText>
              )}
            </HpsmReadonly>
          </HpsmField>
          {info.enabled && (
            <HpsmField label="Recuperação">
              <HpsmReadonly>
                <StatusText tone={info.recoveryRemaining <= 3 ? 'orange' : 'none'}>
                  {info.recoveryRemaining} código(s) de recuperação restante(s)
                </StatusText>
              </HpsmReadonly>
            </HpsmField>
          )}
          <HpsmField label="Como funciona">
            <HpsmReadonly multiline>
              Opcional. Com o 2FA ativo, o login pede, além da senha, o código de 6 dígitos de um
              aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Aegis,
              1Password...). Os scripts com token de API não são afetados.
            </HpsmReadonly>
          </HpsmField>
          {!info.enabled && !setup && (
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={() => void startSetup()}
              >
                Ativar 2FA
              </button>
            </HpsmFormActions>
          )}
        </HpsmForm>
      </HpsmSection>

      {setup && (
        <HpsmSection title="Ativar 2FA" className="dl-form-col">
          <HpsmForm>
            <HpsmField label="1. Escaneie" top>
              <img
                className="dl-2fa__qr"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
                alt="QR code para o aplicativo autenticador"
                width={180}
                height={180}
              />
            </HpsmField>
            <HpsmField
              label="ou digite a chave"
              help="Tipo: baseado em tempo (TOTP), 6 dígitos, 30 s."
            >
              <HpsmReadonly mono copyable={{ value: setup.secret, label: 'chave do 2FA' }}>
                {grouped(setup.secret)}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField
              label="2. Código do aplicativo"
              htmlFor="tfa-code"
              required
              invalid={enableCheck.isInvalid('tfa-code')}
            >
              <TextInput
                id="tfa-code"
                labelText="Código do aplicativo"
                hideLabel
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void enable();
                }}
              />
            </HpsmField>
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={() => void enable()}
              >
                Confirmar e ativar
              </button>
              <button
                type="button"
                className="dl-btn"
                disabled={busy}
                onClick={() => setSetup(null)}
              >
                Cancelar
              </button>
            </HpsmFormActions>
          </HpsmForm>
        </HpsmSection>
      )}

      {info.enabled && (
        <HpsmSection title="Gerar novos códigos ou desativar" className="dl-form-col">
          <HpsmForm>
            <HpsmField
              label="Senha atual"
              htmlFor="tfa-password"
              required
              invalid={sensitiveCheck.isInvalid('tfa-password')}
            >
              <PasswordInput
                id="tfa-password"
                labelText="Senha atual"
                hideLabel
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </HpsmField>
            <HpsmField
              label="Código"
              htmlFor="tfa-confirm-code"
              required
              help="Do aplicativo ou um código de recuperação."
              invalid={sensitiveCheck.isInvalid('tfa-confirm-code')}
            >
              <TextInput
                id="tfa-confirm-code"
                labelText="Código"
                hideLabel
                autoComplete="one-time-code"
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </HpsmField>
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn"
                disabled={busy}
                onClick={() => void regenerate()}
              >
                Gerar novos códigos
              </button>
              <button
                type="button"
                className="dl-btn dl-btn--danger"
                disabled={busy}
                onClick={() => void disable()}
              >
                Desativar 2FA…
              </button>
            </HpsmFormActions>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
