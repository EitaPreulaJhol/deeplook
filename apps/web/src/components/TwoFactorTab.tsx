import { PasswordInput, TextInput } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { intlLocale } from '../i18n';
import { t } from '../i18n/account';
import { CopyButton } from './CopyButton';
import { isSubmitEnter } from './enterKey';
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
    <HpsmSection title={t('recoveryCodes')}>
      <HpsmMessage kind="warning">{t('recoveryHint')}</HpsmMessage>
      <ul className="dl-2fa__codes" aria-label={t('recoveryCodes')}>
        {codes.map((c) => (
          <li key={c} className="dl-mono">
            {c}
          </li>
        ))}
      </ul>
      <div className="hpsm-form__buttons">
        <span className="dl-2fa__copy">
          <CopyButton value={text} label={t('recoveryCodesLower')} /> {t('copy')}
        </span>
        <button
          type="button"
          className="dl-btn"
          onClick={() =>
            downloadText('deeplook-codigos-de-recuperacao.txt', `${text}\n`, 'text/plain')
          }
        >
          {t('downloadTxt')}
        </button>
        <button type="button" className="dl-btn dl-btn--primary" onClick={onDone}>
          {t('savedCodes')}
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
      label: t('appCode'),
      ok: /^\d{6}$/.test(code.trim()),
      api: 'code',
      value: code,
    },
  ]);
  const sensitiveCheck = useRequiredFields([
    {
      id: 'tfa-password',
      label: t('currentPassword'),
      ok: password.length > 0,
      api: 'password',
      value: password,
    },
    {
      id: 'tfa-confirm-code',
      label: t('code'),
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
          text: t('tfaEnabled'),
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
        setNotice({ ok: true, text: t('newCodes') });
        await reload();
      } catch (err) {
        if (!sensitiveCheck.fromApi(err)) setNotice({ ok: false, text: (err as Error).message });
      }
    });

  const disable = async () => {
    if (!sensitiveCheck.check()) return;
    const ok = await confirm({
      title: t('disableTfa'),
      message: t('disableTfaHelp'),
      confirmLabel: t('disable'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        await api.post('/me/2fa/disable', { password, code: code.trim() });
        setPassword('');
        setCode('');
        sensitiveCheck.reset();
        setNotice({ ok: true, text: t('tfaDisabled') });
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

      <HpsmSection title={t('tfaTitle')} className="dl-form-col">
        <HpsmForm>
          <HpsmField label={t('situation')}>
            <HpsmReadonly>
              {info.enabled ? (
                <StatusText tone="green">
                  {t('activeSince', {
                    date: info.enabledAt
                      ? new Date(info.enabledAt).toLocaleDateString(intlLocale())
                      : '—',
                  })}
                </StatusText>
              ) : (
                <StatusText tone="gray">{t('disabledState')}</StatusText>
              )}
            </HpsmReadonly>
          </HpsmField>
          {info.enabled && (
            <HpsmField label={t('recovery')}>
              <HpsmReadonly>
                <StatusText tone={info.recoveryRemaining <= 3 ? 'orange' : 'none'}>
                  {t('recoveryLeft', { n: info.recoveryRemaining })}
                </StatusText>
              </HpsmReadonly>
            </HpsmField>
          )}
          <HpsmField label={t('howItWorks')}>
            <HpsmReadonly multiline>{t('tfaHow')}</HpsmReadonly>
          </HpsmField>
          {!info.enabled && !setup && (
            <HpsmFormActions>
              <button
                type="button"
                className="dl-btn dl-btn--primary"
                disabled={busy}
                onClick={() => void startSetup()}
              >
                {t('enableTfa')}
              </button>
            </HpsmFormActions>
          )}
        </HpsmForm>
      </HpsmSection>

      {setup && (
        <HpsmSection title={t('enableTfa')} className="dl-form-col">
          <HpsmForm>
            <HpsmField label={t('scan')} top>
              <img
                className="dl-2fa__qr"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
                alt={t('qrAlt')}
                width={180}
                height={180}
              />
            </HpsmField>
            <HpsmField label={t('orTypeKey')} help={t('keyHelp')}>
              <HpsmReadonly mono copyable={{ value: setup.secret, label: t('tfaKey') }}>
                {grouped(setup.secret)}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField
              label={t('appCodeStep')}
              htmlFor="tfa-code"
              required
              invalid={enableCheck.isInvalid('tfa-code')}
            >
              <TextInput
                id="tfa-code"
                labelText={t('appCode')}
                hideLabel
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (isSubmitEnter(e)) {
                    e.preventDefault();
                    void enable();
                  }
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
                {t('confirmEnable')}
              </button>
              <button
                type="button"
                className="dl-btn"
                disabled={busy}
                onClick={() => setSetup(null)}
              >
                {t('cancel')}
              </button>
            </HpsmFormActions>
          </HpsmForm>
        </HpsmSection>
      )}

      {info.enabled && (
        <HpsmSection title={t('regenOrDisable')} className="dl-form-col">
          <HpsmForm>
            <HpsmField
              label={t('currentPassword')}
              htmlFor="tfa-password"
              required
              invalid={sensitiveCheck.isInvalid('tfa-password')}
            >
              <PasswordInput
                id="tfa-password"
                labelText={t('currentPassword')}
                hideLabel
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </HpsmField>
            <HpsmField
              label={t('code')}
              htmlFor="tfa-confirm-code"
              required
              help={t('codeHelp')}
              invalid={sensitiveCheck.isInvalid('tfa-confirm-code')}
            >
              <TextInput
                id="tfa-confirm-code"
                labelText={t('code')}
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
                {t('generateCodes')}
              </button>
              <button
                type="button"
                className="dl-btn dl-btn--danger"
                disabled={busy}
                onClick={() => void disable()}
              >
                {t('disableTfaEllipsis')}
              </button>
            </HpsmFormActions>
          </HpsmForm>
        </HpsmSection>
      )}
    </>
  );
}
