import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFieldErrors } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PASSWORD_HELP, passwordProblem } from '../auth/passwordPolicy';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { HpsmMessage } from '../components/messages';
import { clearWorkspaceTabs } from '../components/workspace';
import { t } from '../i18n/shell';

/**
 * Troca obrigatoria (senha redefinida por um admin): ate definir uma senha
 * nova, esta e a unica tela. A senha temporaria vem do login; se a pagina foi
 * recarregada, a pessoa digita de novo.
 */
export function ForcePasswordPage() {
  const { user, takeTemporaryPassword, completeForcedPasswordChange, logout } = useAuth();
  const navigate = useNavigate();
  // Senha vencida (politica): a atual e a do login, mas o texto muda.
  const expired = user?.passwordChangeReason === 'expired';
  const [current, setCurrent] = useState(() => takeTemporaryPassword() ?? '');
  const [askCurrent] = useState(() => current === '');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const bad = new Set<string>();
    if (!current) bad.add('force-current');
    const problem = passwordProblem(next);
    if (problem) bad.add('force-new');
    if (!confirm || confirm !== next) bad.add('force-confirm');
    setInvalid(bad);
    if (bad.size) {
      setError(
        bad.has('force-new') && problem
          ? t('newPwdProblem', { problem })
          : bad.has('force-confirm')
            ? t('confirmMismatch')
            : t('enterCurrent'),
      );
      document.getElementById([...bad][0])?.focus();
      return;
    }
    setSaving(true);
    try {
      await completeForcedPasswordChange(current, next);
      clearWorkspaceTabs();
      navigate('/', { replace: true });
    } catch (err) {
      const fields = apiFieldErrors(err);
      if (fields?.newPassword) setInvalid(new Set(['force-new']));
      setError(fields?.newPassword?.[0] ?? (err as Error).message);
      setSaving(false);
    }
  };

  const leave = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <AuthLayout
      hideBack
      title={t('setNewPassword')}
      subtitle={
        expired
          ? t('pwdExpiredMsg', { name: user?.displayName ?? '' })
          : t('pwdMustChange', { name: user?.displayName ?? '' })
      }
    >
      <form className="dl-auth__form" onSubmit={submit}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {askCurrent && (
          <AuthField
            id="force-current"
            label={t('currentOrTemp')}
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            invalid={invalid.has('force-current')}
            required
          />
        )}
        <AuthField
          id="force-new"
          label={t('newPassword')}
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          helperText={`${PASSWORD_HELP()} ${t('differentFromCurrent')}`}
          invalid={invalid.has('force-new')}
          required
        />
        <AuthField
          id="force-confirm"
          label={t('confirmPassword')}
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={invalid.has('force-confirm')}
          required
        />
        <div className="dl-auth__actions">
          <a
            className="dl-auth__link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void leave();
            }}
          >
            {t('signOut')}
          </a>
          <button
            type="submit"
            className="dl-btn dl-btn--primary dl-auth__submit"
            disabled={saving}
          >
            {saving ? t('saving') : t('saveAndEnter')}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
