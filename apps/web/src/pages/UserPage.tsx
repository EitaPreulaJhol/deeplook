import { Checkbox, PasswordInput, Select, SelectItem } from '@carbon/react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { Preferences } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { daysUntil, PASSWORD_HELP, passwordProblem } from '../auth/passwordPolicy';
import { DEFAULT_PREFERENCES } from '../auth/preferences';
import { ApiTokensTab } from '../components/ApiTokensTab';
import {
  HpsmField,
  HpsmForm,
  HpsmFormActions,
  HpsmReadonly,
  HpsmSection,
  useRequiredFields,
} from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconKey, IconRefresh, IconSettings } from '../components/icons';
import { HpsmMessage } from '../components/messages';
import { NotificationsTab } from '../components/NotificationsTab';
import { PageHeader } from '../components/PageHeader';
import { SessionsTab } from '../components/SessionsTab';
import { useSaveShortcut } from '../components/shortcuts';
import { roleLabel } from '../components/tags';
import { TwoFactorTab } from '../components/TwoFactorTab';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { WatchesTab } from '../components/WatchesTab';
import { clearWorkspaceTabs } from '../components/workspace';
import { intlLocale, isLocale, LOCALES, localized, setLocale, t } from '../i18n';
import { t as tr } from '../i18n/account';

const TABS = localized(() => [
  { id: 'dados', label: tr('tabData') },
  { id: 'senha', label: tr('tabPassword') },
  { id: 'preferencias', label: tr('tabPrefs') },
  { id: 'notificacoes', label: tr('tabNotifications') },
  { id: '2fa', label: '2FA' },
  { id: 'sessoes', label: tr('tabSessions') },
  { id: 'indicadores', label: tr('tabIndicators') },
]);

/** Minha Conta: dados (somente leitura), troca de senha e preferencias de uso. */
export function UserPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // "Tokens de API" so aparece com o acesso liberado por um admin.
  const tabs = user?.apiAccess ? [...TABS, { id: 'tokens', label: tr('tabTokens') }] : TABS;
  const tabParam = searchParams.get('tab');
  const tab = tabs.some((t) => t.id === tabParam) ? (tabParam as string) : 'dados';

  // A aba fica na URL: o menu do usuario aponta direto para cada uma.
  const changeTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'dados') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  if (!user) return null;

  return (
    <>
      <PageHeader title={tr('accountTitle')} subtitle={tr('accountSubtitle')} />

      <HpsmTabs ariaLabel={tr('accountAria')} active={tab} onChange={changeTab} items={tabs} />

      <div className="hpsm-tabpanel">
        {tab === 'dados' && (
          <HpsmSection title={tr('userData')}>
            <HpsmForm columns={2}>
              <HpsmField label={tr('name')}>
                <HpsmReadonly>{user.displayName}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="E-mail">
                <HpsmReadonly>{user.email}</HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('role')}>
                <HpsmReadonly>{roleLabel(user.role)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label={tr('memberSince')}>
                <HpsmReadonly>
                  {new Date(user.createdAt).toLocaleDateString(intlLocale())}
                </HpsmReadonly>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
        )}
        {tab === 'senha' &&
          (user?.ldap ? <HpsmMessage kind="info">{tr('adAccount')}</HpsmMessage> : <PasswordTab />)}
        {tab === 'preferencias' && <PreferencesTab />}
        {tab === 'notificacoes' && <NotificationsTab />}
        {tab === '2fa' && <TwoFactorTab />}
        {tab === 'sessoes' && <SessionsTab />}
        {tab === 'indicadores' && <WatchesTab />}
        {tab === 'tokens' && <ApiTokensTab />}
      </div>
    </>
  );
}

/** Texto da validade da politica (a API decide; aqui so a mensagem). */
const MAX_AGE_TEXT = () => tr('maxAge90');

function PasswordTab() {
  const { changePassword, user } = useAuth();
  const expiresAt = user?.passwordExpiresAt ?? null;
  const daysLeft = daysUntil(expiresAt);
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { allowNavigation } = useUnsavedChanges(Boolean(current || next || confirm));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const passwordCheck = useRequiredFields([
    {
      id: 'pwd-current',
      label: tr('currentPassword'),
      ok: current.length > 0,
      api: 'currentPassword',
      value: current,
    },
    {
      id: 'pwd-new',
      label: tr('newPasswordRule'),
      ok: passwordProblem(next) === null,
      api: 'newPassword',
      value: next,
    },
    {
      id: 'pwd-confirm',
      label: tr('confirmPasswordRule'),
      ok: confirm.length > 0 && confirm === next,
    },
  ]);

  const save = async () => {
    setError(null);
    if (!passwordCheck.check()) return;
    setSaving(true);
    try {
      // A API encerra todas as sessoes: o usuario volta ao login.
      await changePassword(current, next);
      allowNavigation();
      clearWorkspaceTabs();
      navigate('/login', {
        replace: true,
        state: { notice: tr('passwordChanged') },
      });
    } catch (err) {
      if (!passwordCheck.fromApi(err)) setError((err as Error).message);
      setSaving(false);
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <HpsmSection title={tr('changePassword')} className="dl-form-col">
      <HpsmToolbar label={tr('passwordActions')}>
        <HpsmToolbarButton
          label={saving ? tr('saving') : tr('savePassword')}
          title={tr('saveHint')}
          icon={IconKey}
          disabled={saving}
          onClick={save}
        />
      </HpsmToolbar>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {passwordCheck.message && <HpsmMessage kind="error">{passwordCheck.message}</HpsmMessage>}
      <HpsmForm>
        <HpsmField label={tr('validity')}>
          <HpsmReadonly>
            {expiresAt
              ? tr(daysLeft === 1 ? 'pwdValidOne' : 'pwdValidMany', {
                  date: new Date(expiresAt).toLocaleDateString(intlLocale()),
                  n: daysLeft,
                  max: MAX_AGE_TEXT(),
                })
              : tr('noExpiry')}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField
          label={tr('currentPassword')}
          htmlFor="pwd-current"
          required
          invalid={passwordCheck.isInvalid('pwd-current')}
        >
          <PasswordInput
            id="pwd-current"
            labelText={tr('currentPassword')}
            hideLabel
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label={tr('newPassword')}
          htmlFor="pwd-new"
          required
          help={PASSWORD_HELP()}
          invalid={passwordCheck.isInvalid('pwd-new')}
        >
          <PasswordInput
            id="pwd-new"
            labelText={tr('newPassword')}
            hideLabel
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label={tr('confirmPassword')}
          htmlFor="pwd-confirm"
          required
          help={tr('confirmHelp')}

          invalid={passwordCheck.isInvalid('pwd-confirm')}
        >
          <PasswordInput
            id="pwd-confirm"
            labelText={tr('confirmPassword')}
            hideLabel
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </HpsmField>
        <HpsmFormActions>
          <button
            type="button"
            className="dl-btn dl-btn--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? tr('saving') : tr('save')}
          </button>
        </HpsmFormActions>
      </HpsmForm>
    </HpsmSection>
  );
}

/** Preferencias guardadas por outras telas (Navegador, aba Notificacoes). */
const OTHER_SCREENS = new Set<keyof Preferences>(['closedFolders', 'mutedNotifications']);

function PreferencesTab() {
  const { preferences, updatePreferences } = useAuth();
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useUnsavedChanges(
    (Object.keys(draft) as (keyof Preferences)[]).some(
      (key) => !OTHER_SCREENS.has(key) && draft[key] !== preferences[key],
    ),
  );

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setResult(null);
    setSaving(true);
    try {
      // Pastas do Navegador e avisos nao sao desta tela: o rascunho pode estar velho.
      const { closedFolders: _menu, mutedNotifications: _muted, ...fields } = draft;
      await updatePreferences(fields);
      // O idioma muda na hora (a raiz assina): a mensagem ja sai no idioma escolhido.
      setLocale(fields.language);
      setResult({ kind: 'success', text: t('prefs.saved') });
    } catch (err) {
      setResult({ kind: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <HpsmSection title={t('prefs.title')} className="dl-form-col">
      <HpsmToolbar label={t('prefs.toolbar')}>
        <HpsmToolbarButton
          label={saving ? t('prefs.saving') : t('prefs.save')}
          title={t('prefs.saveHint')}
          icon={IconSettings}
          disabled={saving}
          onClick={save}
        />
        <HpsmToolbarButton
          label={t('prefs.reset')}
          icon={IconRefresh}
          disabled={saving}
          onClick={() => setDraft(DEFAULT_PREFERENCES)}
        />
      </HpsmToolbar>
      {result && <HpsmMessage kind={result.kind}>{result.text}</HpsmMessage>}
      <HpsmForm>
        <HpsmField
          label={t('prefs.language')}
          htmlFor="pref-language"
          help={t('prefs.languageHelp')}
        >
          <Select
            id="pref-language"
            labelText={t('prefs.language')}
            hideLabel
            value={draft.language}
            onChange={(e) => {
              if (isLocale(e.target.value)) set('language', e.target.value);
            }}
          >
            {LOCALES.map((l) => (
              <SelectItem key={l.id} value={l.id} text={l.label} />
            ))}
          </Select>
        </HpsmField>
        <HpsmField
          label={t('prefs.startPage')}
          htmlFor="pref-start"
          help={t('prefs.startPageHelp')}
        >
          <Select
            id="pref-start"
            labelText={t('prefs.startPage')}
            hideLabel
            value={draft.startPage}
            onChange={(e) => set('startPage', e.target.value as Preferences['startPage'])}
          >
            <SelectItem value="welcome" text={t('prefs.startWelcome')} />
            <SelectItem value="dashboard" text={t('nav.dashboard')} />
            <SelectItem value="history" text={t('nav.history')} />
            <SelectItem value="mine" text={t('nav.myUploads')} />
          </Select>
        </HpsmField>
        <HpsmField
          label={t('prefs.pageSize')}
          htmlFor="pref-pagesize"
          help={t('prefs.pageSizeHelp')}
        >
          <Select
            id="pref-pagesize"
            labelText={t('prefs.pageSize')}
            hideLabel
            value={String(draft.pageSize)}
            onChange={(e) => set('pageSize', Number(e.target.value) as Preferences['pageSize'])}
          >
            <SelectItem value="25" text="25" />
            <SelectItem value="50" text="50" />
            <SelectItem value="100" text="100" />
          </Select>
        </HpsmField>
        <HpsmField label={t('prefs.tabs')}>
          <Checkbox
            id="pref-restore"
            labelText={t('prefs.restoreTabs')}
            checked={draft.restoreTabs}
            onChange={(_, { checked }) => set('restoreTabs', checked)}
          />
        </HpsmField>
        <HpsmField label={t('prefs.detailPane')}>
          <Checkbox
            id="pref-detail-pane"
            labelText={t('prefs.detailPaneLabel')}
            checked={draft.detailPane}
            onChange={(_, { checked }) => set('detailPane', checked)}
          />
        </HpsmField>
      </HpsmForm>
    </HpsmSection>
  );
}
