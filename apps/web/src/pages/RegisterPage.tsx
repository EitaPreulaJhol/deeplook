import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { HpsmMessage } from '../components/messages';

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await register({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        activationKey: activationKey.trim().toUpperCase(),
      });
      navigate('/history');
    } catch (err) {
      setError((err as Error).message || 'Falha no cadastro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Cadastro" altLink={{ to: '/login', label: 'Entrar' }}>
      <form className="dl-auth__form" onSubmit={submit}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}

        <AuthField
          id="displayName"
          label="Nome"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          required
        />
        <AuthField
          id="email"
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <AuthField
          id="password"
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          helperText="Mínimo de 8 caracteres"
          required
        />
        <AuthField
          id="confirmPassword"
          label="Confirme a senha"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
        />
        <AuthField
          id="activationKey"
          label="Chave de ativação"
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
            {loading ? 'Cadastrando...' : 'Criar conta'}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
