import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { HpsmMessage } from '../components/messages';

export function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  // Aviso vindo de outra tela (ex.: "Senha alterada. Entre novamente...").
  const { state } = useLocation() as { state: { notice?: string } | null };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(state?.notice ?? null);
  const [loading, setLoading] = useState(false);
  // 2FA: depois da senha certa, a etapa do codigo (desafio valido por 5 min).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const step = await login(email.trim(), password);
      if (step) {
        setChallenge(step.challenge);
        setCode('');
        return;
      }
      navigate('/');
    } catch (err) {
      setError((err as Error).message || 'Falha ao entrar.');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      // A rota "/" leva a pagina inicial (ou a aba 2FA, se entrou com codigo de recuperacao).
      await verifyTwoFactor(challenge, code.trim());
      navigate('/');
    } catch (err) {
      const message = (err as Error).message || 'Falha ao verificar o código.';
      setError(message);
      if (message.startsWith('A verificação expirou')) setChallenge(null);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = (event: React.MouseEvent) => {
    event.preventDefault();
    setNotice('Peça a um administrador para redefinir a sua senha.');
  };

  if (challenge) {
    return (
      <AuthLayout
        title="Verificação em duas etapas"
        subtitle="Digite o código de 6 dígitos do seu aplicativo autenticador."
      >
        <form className="dl-auth__form" onSubmit={submitCode}>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          <AuthField
            id="tfa-login-code"
            label="Código"
            value={code}
            onChange={setCode}
            placeholder="000000"
            autoComplete="one-time-code"
            helperText="Sem o celular? Use um dos códigos de recuperação (ex.: k7tm-q2xa)."
            required
          />
          <div className="dl-auth__actions">
            <a
              className="dl-auth__link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setChallenge(null);
                setError(null);
                setPassword('');
              }}
            >
              Voltar
            </a>
            <button
              type="submit"
              className="dl-btn dl-btn--primary dl-auth__submit"
              disabled={loading || code.trim().length < 6}
            >
              {loading ? 'Verificando...' : 'Verificar'}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

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
