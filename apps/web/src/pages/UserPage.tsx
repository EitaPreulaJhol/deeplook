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
import { PageHeader } from '../components/PageHeader';
import { SessionsTab } from '../components/SessionsTab';
import { useSaveShortcut } from '../components/shortcuts';
import { roleLabel } from '../components/tags';
import { TwoFactorTab } from '../components/TwoFactorTab';
import { useUnsavedChanges } from '../components/useUnsavedChanges';
import { WatchesTab } from '../components/WatchesTab';
import { clearWorkspaceTabs } from '../components/workspace';

const TABS = [
  { id: 'dados', label: 'Dados' },
  { id: 'senha', label: 'Senha' },
  { id: 'preferencias', label: 'Preferências' },
  { id: '2fa', label: '2FA' },
  { id: 'sessoes', label: 'Sessões' },
  { id: 'indicadores', label: 'Indicadores' },
];

/** Minha Conta: dados (somente leitura), troca de senha e preferencias de uso. */
export function UserPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // "Tokens de API" so aparece com o acesso liberado por um admin.
  const tabs = user?.apiAccess ? [...TABS, { id: 'tokens', label: 'Tokens de API' }] : TABS;
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
      <PageHeader title="Minha Conta" subtitle="Seus dados de acesso e preferências de uso." />

      <HpsmTabs ariaLabel="Minha conta" active={tab} onChange={changeTab} items={tabs} />

      <div className="hpsm-tabpanel">
        {tab === 'dados' && (
          <HpsmSection title="Dados do usuário">
            <HpsmForm columns={2}>
              <HpsmField label="Nome">
                <HpsmReadonly>{user.displayName}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="E-mail">
                <HpsmReadonly>{user.email}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="Papel">
                <HpsmReadonly>{roleLabel(user.role)}</HpsmReadonly>
              </HpsmField>
              <HpsmField label="Membro desde">
                <HpsmReadonly>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</HpsmReadonly>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>
        )}
        {tab === 'senha' &&
          (user?.ldap ? (
            <HpsmMessage kind="info">
              Sua conta é da rede (AD): a senha e a validade dela são as do AD. Para trocá-la, use o
              processo da empresa. O 2FA do DeepLook continua valendo.
            </HpsmMessage>
          ) : (
            <PasswordTab />
          ))}
        {tab === 'preferencias' && <PreferencesTab />}
        {tab === '2fa' && <TwoFactorTab />}
        {tab === 'sessoes' && <SessionsTab />}
        {tab === 'indicadores' && <WatchesTab />}
        {tab === 'tokens' && <ApiTokensTab />}
      </div>
    </>
  );
}

/** Texto da validade da politica (a API decide; aqui so a mensagem). */
const MAX_AGE_TEXT = '90 dias';

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
      label: 'Senha atual',
      ok: current.length > 0,
      api: 'currentPassword',
      value: current,
    },
    {
      id: 'pwd-new',
      label: 'Nova senha (8+ caracteres, com número e caractere especial)',
      ok: passwordProblem(next) === null,
      api: 'newPassword',
      value: next,
    },
    {
      id: 'pwd-confirm',
      label: 'Confirmar senha (igual à nova)',
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
        state: { notice: 'Senha alterada. Entre novamente com a nova senha.' },
      });
    } catch (err) {
      if (!passwordCheck.fromApi(err)) setError((err as Error).message);
      setSaving(false);
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <HpsmSection title="Alterar senha" className="dl-form-col">
      <HpsmToolbar label="Ações da senha">
        <HpsmToolbarButton
          label={saving ? 'Salvando...' : 'Salvar senha'}
          title="Salvar (Ctrl+S)"
          icon={IconKey}
          disabled={saving}
          onClick={save}
        />
      </HpsmToolbar>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {passwordCheck.message && <HpsmMessage kind="error">{passwordCheck.message}</HpsmMessage>}
      <HpsmForm>
        <HpsmField label="Validade">
          <HpsmReadonly>
            {expiresAt
              ? `Sua senha vale até ${new Date(expiresAt).toLocaleDateString('pt-BR')} (${daysLeft} dia${daysLeft === 1 ? '' : 's'}). Ao trocar, ganha mais ${MAX_AGE_TEXT}.`
              : 'Sem validade (contas de administrador não expiram).'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField
          label="Senha atual"
          htmlFor="pwd-current"
          required
          invalid={passwordCheck.isInvalid('pwd-current')}
        >
          <PasswordInput
            id="pwd-current"
            labelText="Senha atual"
            hideLabel
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label="Nova senha"
          htmlFor="pwd-new"
          required
          help={PASSWORD_HELP}
          invalid={passwordCheck.isInvalid('pwd-new')}
        >
          <PasswordInput
            id="pwd-new"
            labelText="Nova senha"
            hideLabel
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </HpsmField>
        <HpsmField
          label="Confirmar senha"
          htmlFor="pwd-confirm"
          required
          help="Ao salvar, todas as sessões são encerradas e você entra novamente."

          invalid={passwordCheck.isInvalid('pwd-confirm')}
        >
          <PasswordInput
            id="pwd-confirm"
            labelText="Confirmar senha"
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
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </HpsmFormActions>
      </HpsmForm>
    </HpsmSection>
  );
}

function PreferencesTab() {
  const { preferences, updatePreferences } = useAuth();
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useUnsavedChanges(
    (Object.keys(draft) as (keyof Preferences)[]).some(
      (key) => key !== 'closedFolders' && draft[key] !== preferences[key],
    ),
  );

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setResult(null);
    setSaving(true);
    try {
      // As pastas do Navegador nao sao desta tela: o rascunho pode estar velho.
      const { closedFolders: _menu, ...fields } = draft;
      await updatePreferences(fields);
      setResult({ kind: 'success', text: 'Preferências salvas.' });
    } catch (err) {
      setResult({ kind: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  useSaveShortcut(save, !saving);

  return (
    <HpsmSection title="Preferências de uso" className="dl-form-col">
      <HpsmToolbar label="Ações das preferências">
        <HpsmToolbarButton
          label={saving ? 'Salvando...' : 'Salvar preferências'}
          title="Salvar (Ctrl+S)"
          icon={IconSettings}
          disabled={saving}
          onClick={save}
        />
        <HpsmToolbarButton
          label="Restaurar padrão"
          icon={IconRefresh}
          disabled={saving}
          onClick={() => setDraft(DEFAULT_PREFERENCES)}
        />
      </HpsmToolbar>
      {result && <HpsmMessage kind={result.kind}>{result.text}</HpsmMessage>}
      <HpsmForm>
        <HpsmField
          label="Página inicial"
          htmlFor="pref-start"
          help="Tela aberta ao entrar no sistema."
        >
          <Select
            id="pref-start"
            labelText="Página inicial"
            hideLabel
            value={draft.startPage}
            onChange={(e) => set('startPage', e.target.value as Preferences['startPage'])}
          >
            <SelectItem value="welcome" text="Página Inicial (boas-vindas)" />
            <SelectItem value="dashboard" text="Painel" />
            <SelectItem value="history" text="Histórico Global" />
            <SelectItem value="mine" text="Meus Uploads" />
          </Select>
        </HpsmField>
        <HpsmField
          label="Registros por página"
          htmlFor="pref-pagesize"
          help="Histórico Global e Meus Uploads."
        >
          <Select
            id="pref-pagesize"
            labelText="Registros por página"
            hideLabel
            value={String(draft.pageSize)}
            onChange={(e) => set('pageSize', Number(e.target.value) as Preferences['pageSize'])}
          >
            <SelectItem value="25" text="25" />
            <SelectItem value="50" text="50" />
            <SelectItem value="100" text="100" />
          </Select>
        </HpsmField>
        <HpsmField label="Abas abertas">
          <Checkbox
            id="pref-restore"
            labelText="Reabrir as abas da sessão anterior ao entrar"
            checked={draft.restoreTabs}
            onChange={(_, { checked }) => set('restoreTabs', checked)}
          />
        </HpsmField>
        <HpsmField label="Painel de detalhe">
          <Checkbox
            id="pref-detail-pane"
            labelText="Mostrar o resumo da amostra abaixo das listas (clique seleciona, duplo clique abre)"
            checked={draft.detailPane}
            onChange={(_, { checked }) => set('detailPane', checked)}
          />
        </HpsmField>
      </HpsmForm>
    </HpsmSection>
  );
}
