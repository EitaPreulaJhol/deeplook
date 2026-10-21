import type { Preferences, StartPage } from '../api/types';

/** Mesmos valores padrao da API (apps/api/src/lib/preferences.ts). */
export const DEFAULT_PREFERENCES: Preferences = {
  startPage: 'welcome',
  pageSize: 50,
  restoreTabs: true,
};

const START_PATHS: Record<StartPage, string> = {
  welcome: '/inicio',
  history: '/history',
  mine: '/me',
};

/** Rota da pagina inicial escolhida (usada apos o login e na raiz "/"). */
export function startPath(preferences: Preferences): string {
  return START_PATHS[preferences.startPage] ?? START_PATHS.welcome;
}
