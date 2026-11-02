import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';

import { api } from '../api/client';
import type { CurrentUser, Preferences } from '../api/types';
import { DEFAULT_PREFERENCES } from './preferences';

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
  activationKey: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  /** Preferencias do usuario (padrao enquanto nao ha sessao). */
  preferences: Preferences;
  loading: boolean;
  /** Entra; com 2FA ativo devolve o desafio da etapa do codigo (sem sessao ainda). */
  login: (
    email: string,
    password: string,
    captcha?: { token: string; answer: string },
  ) => Promise<{ challenge: string } | null>;
  /** Segunda etapa do login com 2FA; devolve quantos codigos de recuperacao restam se usou um. */
  verifyTwoFactor: (
    challenge: string,
    code: string,
  ) => Promise<{ recoveryRemaining: number | null }>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Salva preferencias (aplica na hora; desfaz se a API recusar). */
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  /** Esquece a sessao no cliente (ex.: expirou por inatividade). */
  clearSession: () => void;
  /** Troca a senha; a API encerra todas as sessoes, entao o usuario sai. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Senha temporaria digitada no login (troca obrigatoria); devolve uma vez. */
  takeTemporaryPassword: () => string | null;
  /** Troca obrigatoria: a API ja abre uma sessao nova e a pessoa segue logada. */
  completeForcedPasswordChange: (currentPassword: string, newPassword: string) => Promise<void>;
}

/**
 * Senha temporaria do ultimo login com troca obrigatoria: so em memoria, so
 * ate a tela "Definir nova senha" pegar (para nao pedir de novo).
 */
let temporaryPassword: string | null = null;
/** Senha da primeira etapa enquanto o 2FA confere o codigo (para a troca obrigatoria). */
let pendingPassword: string | null = null;

/**
 * Destino logo depois do login, no lugar da pagina inicial das preferencias (ex.:
 * entrou com codigo de recuperacao -> aba 2FA com aviso). A rota "/" respeita.
 */
let afterLogin: { to: string; state?: unknown } | null = null;
export const peekAfterLogin = () => afterLogin;
export const clearAfterLogin = () => {
  afterLogin = null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        const data = await api.get<{ user: CurrentUser }>('/auth/me');
        return data.user;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const login = useCallback(
    async (email: string, password: string, captcha?: { token: string; answer: string }) => {
      const data = await api.post<{
        user?: CurrentUser;
        twoFactorRequired?: boolean;
        challenge?: string;
      }>('/auth/login', {
        email,
        password,
        ...(captcha && { captchaToken: captcha.token, captchaAnswer: captcha.answer }),
      });
      if (data.twoFactorRequired && data.challenge) {
        pendingPassword = password;
        return { challenge: data.challenge };
      }
      temporaryPassword = data.user?.mustChangePassword ? password : null;
      queryClient.setQueryData(['me'], data.user);
      return null;
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const data = await api.post<{ user: CurrentUser }>('/auth/register', input);
      queryClient.setQueryData(['me'], data.user);
    },
    [queryClient],
  );

  // Esquece a sessao no cliente (o cookie ja foi apagado pela API).
  const forgetSession = useCallback(() => {
    queryClient.setQueryData(['me'], null);
    queryClient.clear();
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } finally {
      forgetSession();
    }
  }, [forgetSession]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const previous = queryClient.getQueryData<CurrentUser | null>(['me']);
      if (!previous) return;
      queryClient.setQueryData<CurrentUser>(['me'], {
        ...previous,
        preferences: { ...previous.preferences, ...patch },
      });
      try {
        const data = await api.patch<{ preferences: Preferences }>('/me/preferences', patch);
        queryClient.setQueryData<CurrentUser | null>(['me'], (current) =>
          current ? { ...current, preferences: data.preferences } : current,
        );
      } catch (err) {
        queryClient.setQueryData(['me'], previous);
        throw err;
      }
    },
    [queryClient],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post('/me/password', { currentPassword, newPassword });
      forgetSession();
    },
    [forgetSession],
  );

  const verifyTwoFactor = useCallback(
    async (challenge: string, code: string) => {
      const data = await api.post<{ user: CurrentUser; recoveryRemaining: number | null }>(
        '/auth/login/2fa',
        { challenge, code },
      );
      temporaryPassword = data.user.mustChangePassword ? pendingPassword : null;
      pendingPassword = null;
      // Entrou com um codigo de recuperacao: provavelmente perdeu o celular.
      afterLogin =
        data.recoveryRemaining === null
          ? null
          : {
              to: '/user?tab=2fa',
              state: {
                notice: `Você entrou com um código de recuperação. Restam ${data.recoveryRemaining}. Gere novos códigos ou reconfigure o 2FA se perdeu o celular.`,
              },
            };
      queryClient.setQueryData(['me'], data.user);
      return { recoveryRemaining: data.recoveryRemaining };
    },
    [queryClient],
  );

  const takeTemporaryPassword = useCallback(() => {
    const value = temporaryPassword;
    temporaryPassword = null;
    return value;
  }, []);

  const completeForcedPasswordChange = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post('/me/password', { currentPassword, newPassword });
      const data = await api.get<{ user: CurrentUser }>('/auth/me');
      queryClient.setQueryData(['me'], data.user);
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      preferences: meQuery.data?.preferences ?? DEFAULT_PREFERENCES,
      loading: meQuery.isLoading,
      login,
      verifyTwoFactor,
      register,
      logout,
      refresh,
      updatePreferences,
      clearSession: forgetSession,
      changePassword,
      takeTemporaryPassword,
      completeForcedPasswordChange,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      login,
      verifyTwoFactor,
      register,
      logout,
      refresh,
      updatePreferences,
      forgetSession,
      changePassword,
      takeTemporaryPassword,
      completeForcedPasswordChange,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
