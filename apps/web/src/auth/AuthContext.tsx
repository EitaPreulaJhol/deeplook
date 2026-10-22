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
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Salva preferencias (aplica na hora; desfaz se a API recusar). */
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  /** Esquece a sessao no cliente (ex.: expirou por inatividade). */
  clearSession: () => void;
  /** Troca a senha; a API encerra todas as sessoes, entao o usuario sai. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

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
    async (email: string, password: string) => {
      const data = await api.post<{ user: CurrentUser }>('/auth/login', { email, password });
      queryClient.setQueryData(['me'], data.user);
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      preferences: meQuery.data?.preferences ?? DEFAULT_PREFERENCES,
      loading: meQuery.isLoading,
      login,
      register,
      logout,
      refresh,
      updatePreferences,
      clearSession: forgetSession,
      changePassword,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      login,
      register,
      logout,
      refresh,
      updatePreferences,
      forgetSession,
      changePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
