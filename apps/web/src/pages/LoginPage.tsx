import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { HpsmMessage } from '../components/messages';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/history');
    } catch (err) {
      setError((err as Error).message || 'Falha ao entrar.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = (event: React.MouseEvent) => {
    event.preventDefault();
    setNotice('Peça a um administrador para redefinir a sua senha.');
  };

  return (
    <AuthLayout title="Entrar" altLink={{ to: '/register', label: 'Criar conta' }}>
      <form className="dl-auth__form" onSubmit={submit}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {notice && <HpsmMessage kind="info">{notice}</HpsmMessage>}

        <AuthField
          id="email"
          label="E-mail"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="nome@exemplo.com"
          autoComplete="email"
          required
        />
        <AuthField
          id="password"
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="Insira sua senha"
          autoComplete="current-password"
          required
        />

        {/* "Esqueceu a senha?" a esquerda e o botao a direita, na coluna dos campos. */}
        <div className="dl-auth__actions">
          <a className="dl-auth__link" href="#" onClick={handleForgot}>
            Esqueceu a senha?
          </a>
          <button
            type="submit"
            className="dl-btn dl-btn--primary dl-auth__submit"
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
