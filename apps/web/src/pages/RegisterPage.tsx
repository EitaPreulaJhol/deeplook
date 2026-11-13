import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { PASSWORD_HELP, passwordProblem } from '../auth/passwordPolicy';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { useRequiredFields } from '../components/HpsmForm';
import { HpsmMessage } from '../components/messages';
import { t } from '../i18n/shell';

/** Formata a chave como DL-XXXX-XXXX-XXXX. */
function formatActivationKey(raw: string): string {
  const value = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 14);
  return [value.slice(0, 2), value.slice(2, 6), value.slice(6, 10), value.slice(10, 14)]
    .filter(Boolean)
    .join('-');
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activationKey, setActivationKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validacao HPSM: senha confirmada aqui; o resto vem dos `details` da API.
  const check = useRequiredFields([
    { id: 'displayName', label: t('name'), ok: true, value: displayName },
    { id: 'email', label: 'E-mail', ok: true, value: email },
    {
      id: 'password',
      label: t('passwordRule'),
      ok: passwordProblem(password) === null,
      value: password,
    },
    {
      id: 'confirmPassword',
      label: t('confirmRule'),
      ok: confirmPassword === password,
    },
    { id: 'activationKey', label: t('activationKey'), ok: true, value: activationKey },
  ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!check.check()) return;

    setLoading(true);
    try {
      await register({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        activationKey: activationKey.trim().toUpperCase(),
      });
      navigate('/');
    } catch (err) {
      if (!check.fromApi(err)) setError((err as Error).message || t('registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={t('register')} altLink={{ to: '/login', label: t('signIn') }}>
      <form className="dl-auth__form" onSubmit={submit}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}

        <AuthField
          id="displayName"
          invalid={check.isInvalid('displayName')}
          label={t('name')}
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          required
        />
        <AuthField
          id="email"
          invalid={check.isInvalid('email')}
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <AuthField
          id="password"
          invalid={check.isInvalid('password')}
          label={t('password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          helperText={PASSWORD_HELP()}
          required
        />
        <AuthField
          id="confirmPassword"
          invalid={check.isInvalid('confirmPassword')}
          label={t('confirmPwd')}
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        <AuthField
          id="activationKey"
          invalid={check.isInvalid('activationKey')}
          label={t('activationKey')}
          value={activationKey}
          onChange={(value) => setActivationKey(formatActivationKey(value))}
          placeholder="DL-XXXX-XXXX-XXXX"
          uppercase
        />

        <div className="dl-auth__actions">
          <button
            type="submit"
            className="dl-btn dl-btn--primary dl-auth__submit"
            disabled={loading}
          >
            {loading ? t('registering') : t('createAccount')}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
