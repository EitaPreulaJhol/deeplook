import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { passkeyCancelled, passkeysSupported } from '../auth/passkeys';
import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { HpsmMessage } from '../components/messages';
import { t } from '../i18n';

export function LoginPage() {
  const { login, verifyTwoFactor, loginWithPasskey } = useAuth();
  const navigate = useNavigate();
  // Aviso vindo de outra tela (ex.: "Senha alterada. Entre novamente...").
  const { state } = useLocation() as { state: { notice?: string } | null };
  const [email, setEmail] = useState('');
  // Com o AD ligado (item 94), o campo aceita tambem o usuario do AD.
  const options = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: () => api.get<{ ldap: boolean }>('/auth/options'),
    staleTime: Infinity,
    retry: false,
  });
  const ldap = Boolean(options.data?.ldap);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(state?.notice ?? null);
  const [loading, setLoading] = useState(false);
  // 2FA: depois da senha certa, a etapa do codigo (desafio valido por 5 min).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // CAPTCHA de imagem: a API pede (428) depois de varias falhas na conta num dispositivo novo.
  const [captcha, setCaptcha] = useState<{ token: string; image: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const newCaptcha = async () => {
    try {
      setCaptcha(await api.get<{ token: string; image: string }>('/auth/captcha'));
      setCaptchaAnswer('');
    } catch (err) {
      setError((err as Error).message || t('login.captchaFailed'));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const step = await login(
        email.trim(),
        password,
        captcha ? { token: captcha.token, answer: captchaAnswer } : undefined,
      );
      setCaptcha(null);
      if (step) {
        setChallenge(step.challenge);
        setCode('');
        return;
      }
      navigate('/');
    } catch (err) {
      const data = err instanceof ApiError && err.status === 428 ? err.data : null;
      const next = (data as { captcha?: { token: string; image: string } } | null)?.captcha;
      if (next) {
        // Cada imagem vale uma tentativa: a API manda outra a cada erro.
        setCaptcha(next);
        setCaptchaAnswer('');
      }
      setError((err as Error).message || t('login.failed'));
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
      const message = (err as Error).message || t('login.tfaFailed');
      setError(message);
      // Desafio vencido: volta para a etapa da senha. Pelo codigo, nao pelo texto, que vem no idioma
      // da pessoa (em ingles a comparacao com o portugues falhava).
      if (
        err instanceof ApiError &&
        (err.data as { code?: string } | null)?.code === 'TFA_EXPIRED'
      ) {
        setChallenge(null);
      }
    } finally {
      setLoading(false);
    }
  };

  // Login alternativo: a passkey que a pessoa cadastrou em Minha Conta.
  const passkeyLogin = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await loginWithPasskey();
      navigate('/');
    } catch (err) {
      if (!passkeyCancelled(err)) setError((err as Error).message || t('login.failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = (event: React.MouseEvent) => {
    event.preventDefault();
    setNotice(t('login.forgotNotice'));
  };

  if (challenge) {
    return (
      <AuthLayout title={t('login.tfaTitle')} subtitle={t('login.tfaSubtitle')}>
        <form className="dl-auth__form" onSubmit={submitCode}>
          {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
          <AuthField
            id="tfa-login-code"
            label={t('login.tfaCode')}
            value={code}
            onChange={setCode}
            placeholder="000000"
            autoComplete="one-time-code"
            helperText={t('login.tfaHelp')}
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
              {t('login.back')}
            </a>
            <button
              type="submit"
              className="dl-btn dl-btn--primary dl-auth__submit"
              disabled={loading || code.trim().length < 6}
            >
              {loading ? t('login.verifying') : t('login.verify')}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('login.title')}
      altLink={{ to: '/register', label: t('login.createAccount') }}
    >
      <form className="dl-auth__form" onSubmit={submit}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        {notice && <HpsmMessage kind="info">{notice}</HpsmMessage>}

        <AuthField
          id="email"
          label={ldap ? t('login.emailOrUser') : t('login.email')}
          type={ldap ? 'text' : 'email'}
          value={email}
          onChange={setEmail}
          placeholder={ldap ? t('login.emailOrUserPlaceholder') : t('login.emailPlaceholder')}
          autoComplete={ldap ? 'username' : 'email'}
          required
        />
        {ldap && <p className="dl-auth__hint">{t('login.ldapHint')}</p>}
        <AuthField
          id="password"
          label={t('login.password')}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t('login.passwordPlaceholder')}
          autoComplete="current-password"
          required
        />

        {captcha && (
          <div className="dl-auth__captcha">
            <img
              className="dl-auth__captcha-img"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.image)}`}
              alt={t('login.captchaAlt')}
              width={160}
              height={56}
            />
            <button type="button" className="dl-auth__link" onClick={newCaptcha}>
              {t('login.otherImage')}
            </button>
          </div>
        )}
        {captcha && (
          <AuthField
            id="captcha"
            label={t('login.captcha')}
            value={captchaAnswer}
            onChange={setCaptchaAnswer}
            placeholder={t('login.captchaPlaceholder')}
            autoComplete="off"
            helperText={t('login.captchaHelp')}
            required
          />
        )}

        {/* "Esqueceu a senha?" a esquerda e o botao a direita, na coluna dos campos. */}
        <div className="dl-auth__actions">
          <a className="dl-auth__link" href="#" onClick={handleForgot}>
            {t('login.forgot')}
          </a>
          <button
            type="submit"
            className="dl-btn dl-btn--primary dl-auth__submit"
            disabled={loading}
          >
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </div>
        {passkeysSupported() && (
          <div className="dl-auth__alt">
            <span className="dl-auth__hint">{t('login.or')}</span>
            <button
              type="button"
              className="dl-btn dl-auth__passkey"
              disabled={loading}
              onClick={() => void passkeyLogin()}
            >
              {t('login.passkey')}
            </button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
