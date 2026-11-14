import {
  Button,
  DataTable,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ActivationKey, Role, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AdminApiTokensTab } from '../components/AdminApiTokensTab';
import { AdminAuditTab } from '../components/AdminAuditTab';
import { AdminBackupTab } from '../components/AdminBackupTab';
import { AdminSettingsTab } from '../components/AdminSettingsTab';
import { AdminStatusTab } from '../components/AdminStatusTab';
import { AdminTemplatesTab } from '../components/AdminTemplatesTab';
import { AdminTrashTab } from '../components/AdminTrashTab';
import { CopyButton } from '../components/CopyButton';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmMenuButton, HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconKey } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { RoleTag, StatusText } from '../components/tags';
import { intlLocale } from '../i18n';
import { t } from '../i18n/admin';

/** Inteiro entre min e max (campos numericos do formulario de chave). */
function isIntBetween(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<{ users: User[] }>('/admin/users'),
  });

  const keysQuery = useQuery({
    queryKey: ['admin', 'keys'],
    queryFn: () => api.get<{ keys: ActivationKey[] }>('/admin/activation-keys'),
  });

  const [keyRole, setKeyRole] = useState<Role>('USER');
  const [keyMaxUses, setKeyMaxUses] = useState('1');
  const [keyDays, setKeyDays] = useState('30');
  const [creating, setCreating] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  // A aba fica na URL: o navegador lateral aponta direto para cada uma.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab =
    tabParam === 'keys' ||
    tabParam === 'templates' ||
    tabParam === 'status' ||
    tabParam === 'audit' ||
    tabParam === 'trash' ||
    tabParam === 'backup' ||
    tabParam === 'settings' ||
    tabParam === 'tokens'
      ? tabParam
      : 'users';
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'users') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const updateUser = async (id: string, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/admin/users/${id}`, patch);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Validacao HPSM do formulario de chave (e dos erros por campo da API).
  const keyCheck = useRequiredFields([
    { id: 'key-role', label: t('grantedRole'), ok: true, api: 'role', value: keyRole },
    {
      id: 'key-maxuses',
      label: t('maxUsesRange'),
      ok: isIntBetween(keyMaxUses, 1, 1000),
      api: 'maxUses',
      value: keyMaxUses,
    },
    {
      id: 'key-days',
      label: t('validityRange'),
      ok: keyDays.trim() === '' || isIntBetween(keyDays, 1, 3650),
      api: 'expiresInDays',
      value: keyDays,
    },
  ]);

  const createKey = async () => {
    setError(null);
    setLastKey(null);
    if (!keyCheck.check()) return;
    setCreating(true);
    try {
      const res = await api.post<{ key: ActivationKey }>('/admin/activation-keys', {
        role: keyRole,
        maxUses: Number(keyMaxUses),
        expiresInDays: keyDays.trim() ? Number(keyDays) : undefined,
      });
      setLastKey(res.key.code);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'keys'] });
    } catch (err) {
      if (!keyCheck.fromApi(err)) setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  useSaveShortcut(createKey, tab === 'keys' && !creating);

  // Senha temporaria gerada pela ultima redefinicao (mostrada uma unica vez).
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null);

  const resetPassword = async (u: User) => {
    const ok = await confirm({
      title: t('resetPassword'),
      message: (
        <>
          {t('resetPwd1')} <strong>{u.displayName}</strong>
          {t('resetPwd2')}
        </>
      ),
      confirmLabel: t('reset'),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setResetResult(null);
    try {
      const res = await api.post<{ temporaryPassword: string }>(
        `/admin/users/${u.id}/reset-password`,
        {},
      );
      setResetResult({ name: u.displayName, password: res.temporaryPassword });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleStatus = async (u: User) => {
    if (u.status === 'ACTIVE') {
      const ok = await confirm({
        title: t('suspendUser'),
        message: (
          <>
            {t('suspend1')} <strong>{u.displayName}</strong>
            {t('suspend2')}
          </>
        ),
        confirmLabel: t('suspend'),
        danger: true,
      });
      if (!ok) return;
    }
    await updateUser(u.id, { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
  };

  // 2FA: para quem perdeu o celular e os codigos de recuperacao.
  const disableTwoFactor = async (u: User) => {
    const ok = await confirm({
      title: t('disableTfa'),
      message: (
        <>
          {t('tfaOff1')} <strong>{u.displayName}</strong>
          {t('tfaOff2')}
        </>
      ),
      confirmLabel: t('turnOff'),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.post(`/admin/users/${u.id}/disable-2fa`, {});
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Acesso por API: liberar e manual; retirar revoga na hora todos os tokens ativos.
  const toggleApi = async (u: User) => {
    const ok = await confirm({
      title: u.apiAccess ? t('removeApiAccess') : t('grantApiAccess'),
      message: u.apiAccess ? (
        <>
          {t('apiOff1')} <strong>{u.displayName}</strong>
          {t('apiOff2', { n: u._count?.apiTokens ?? 0 })}
        </>
      ) : (
        <>
          {t('apiOn1')} <strong>{u.displayName}</strong>
          {t('apiOn2')}
        </>
      ),
      confirmLabel: u.apiAccess ? t('removeShort') : t('grant'),
      danger: u.apiAccess,
    });
    if (!ok) return;
    await updateUser(u.id, { apiAccess: !u.apiAccess });
  };

  const revokeKey = async (key: ActivationKey) => {
    const ok = await confirm({
      title: t('revokeKey'),
      message: (
        <>
          {t('revokeKey1')} <span className="dl-mono">{key.code}</span>
          {t('revokeKey2')}
        </>
      ),
      confirmLabel: t('revoke'),
      danger: true,
    });
    if (!ok) return;
    const id = key.id;
    setError(null);
    try {
      await api.del(`/admin/activation-keys/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'keys'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <PageHeader title={t('adminTitle')} subtitle={t('adminSubtitle')} />

      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {resetResult && (
        <HpsmMessage kind="success">
          {t('tempPwdOf', { name: resetResult.name })}{' '}
          <span className="dl-mono">{resetResult.password}</span>
          <CopyButton value={resetResult.password} label={t('tempPwdLabel')} /> {t('tempPwdHint')}
        </HpsmMessage>
      )}

      <HpsmTabs
        ariaLabel={t('adminTitle')}
        active={tab}
        onChange={setTab}
        items={[
          { id: 'users', label: t('tabUsers') },
          { id: 'keys', label: t('tabKeys') },
          { id: 'tokens', label: t('tabTokens') },
          { id: 'templates', label: t('tabTemplates') },
          { id: 'status', label: t('tabStatus') },
          { id: 'audit', label: t('tabAudit') },
          { id: 'trash', label: t('tabTrash') },
          // Backup em ZIP (item 81).
          { id: 'backup', label: 'Backup' },
          // Configuracoes feitas na tela (item 140).
          { id: 'settings', label: t('tabSettings') },
        ]}
      />

      <div className="hpsm-tabpanel">
        {tab === 'tokens' ? (
          <AdminApiTokensTab />
        ) : tab === 'trash' ? (
          <AdminTrashTab />
        ) : tab === 'backup' ? (
          <AdminBackupTab />
        ) : tab === 'settings' ? (
          <AdminSettingsTab />
        ) : tab === 'audit' ? (
          <AdminAuditTab />
        ) : tab === 'status' ? (
          <AdminStatusTab />
        ) : tab === 'templates' ? (
          <AdminTemplatesTab />
        ) : tab === 'users' ? (
          <>
            {usersQuery.isLoading && <HpsmLoading text={t('loadingUsers')} />}
            {usersQuery.data && (
              <DataTable
                rows={usersQuery.data.users.map((u) => ({ id: u.id }))}
                headers={[
                  { key: 'name', header: t('name') },
                  { key: 'email', header: 'E-mail' },
                  { key: 'role', header: t('role') },
                  { key: 'status', header: t('status') },
                  { key: 'entries', header: t('submissions') },
                  { key: 'tfa', header: '2FA' },
                  { key: 'api', header: t('apiAccess') },
                  { key: 'actions', header: t('actions') },
                ]}
              >
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="xs" className="dl-users-table">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <TableHeader {...getHeaderProps({ header })} key={header.key}>
                              {header.header}
                            </TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => {
                          const u = usersQuery.data!.users.find((x) => x.id === row.id);
                          // O DataTable sincroniza as linhas um render depois: pula id antigo.
                          if (!u) return null;
                          return (
                            <TableRow {...getRowProps({ row })} key={row.id}>
                              <TableCell>
                                {u.displayName}
                                {u.authSource === 'LDAP' && (
                                  <span className="dl-dup-tag" title={t('adAccountHint')}>
                                    AD
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell>
                                <RoleTag role={u.role} />
                              </TableCell>
                              <TableCell>
                                <StatusText tone={u.status === 'ACTIVE' ? 'green' : 'red'}>
                                  {u.status === 'ACTIVE' ? t('active') : t('suspended')}
                                </StatusText>
                                {u.mustChangePassword && (
                                  <span className="dl-user-pending"> {t('pwdChangePending')}</span>
                                )}
                                {!u.mustChangePassword && u.passwordExpired && (
                                  <span className="dl-user-pending"> {t('pwdExpired')}</span>
                                )}
                              </TableCell>
                              <TableCell>{u._count ? u._count.entries : 0}</TableCell>
                              <TableCell>
                                {u.twoFactorEnabledAt ? (
                                  <StatusText tone="green">{t('active')}</StatusText>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell>
                                {u.apiAccess ? (
                                  <StatusText tone="blue">
                                    {t(
                                      (u._count?.apiTokens ?? 0) === 1
                                        ? 'apiGrantedOne'
                                        : 'apiGrantedMany',
                                      { n: u._count?.apiTokens ?? 0 },
                                    )}
                                  </StatusText>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="dl-row dl-users-table__actions">
                                  <Select
                                    id={`role-${u.id}`}
                                    labelText={t('role')}
                                    hideLabel
                                    size="sm"
                                    value={u.role}
                                    disabled={u.authSource === 'LDAP'}
                                    title={u.authSource === 'LDAP' ? t('adRoleHint') : undefined}
                                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                                  >
                                    <SelectItem value="USER" text={t('roleUser')} />
                                    <SelectItem value="ANALYST" text={t('roleAnalyst')} />
                                    <SelectItem value="ADMIN" text="Admin" />
                                  </Select>
                                  <HpsmMenuButton
                                    label={t('actions')}
                                    menuLabel={t('userActionsFor', { name: u.displayName })}
                                    className="cds--btn cds--btn--tertiary cds--btn--sm dl-menu-button"
                                    caretClassName="dl-menu-button__caret"
                                    items={[
                                      {
                                        label:
                                          u.status === 'ACTIVE' ? t('suspend') : t('reactivate'),
                                        danger: u.status === 'ACTIVE',
                                        action: () => void toggleStatus(u),
                                      },
                                      {
                                        label: t('resetPassword'),
                                        disabled:
                                          u.id === currentUser?.id || u.authSource === 'LDAP',
                                        hint:
                                          u.id === currentUser?.id
                                            ? t('useMyAccount')
                                            : u.authSource === 'LDAP'
                                              ? t('adPwdHint')
                                              : undefined,
                                        action: () => void resetPassword(u),
                                      },
                                      ...(u.twoFactorEnabledAt
                                        ? [
                                            {
                                              label: t('disableTfa'),
                                              danger: true,
                                              action: () => void disableTwoFactor(u),
                                            },
                                          ]
                                        : []),
                                      {
                                        label: u.apiAccess ? t('removeApi') : t('grantApi'),
                                        danger: u.apiAccess,
                                        separated: true,
                                        action: () => void toggleApi(u),
                                      },
                                    ]}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
          </>
        ) : (
          <>
            {lastKey && (
              <HpsmMessage kind="success">
                {t('keyCreated')} <span className="dl-mono">{lastKey}</span>
                <CopyButton value={lastKey} label="chave" />
              </HpsmMessage>
            )}

            {keyCheck.message && <HpsmMessage kind="error">{keyCheck.message}</HpsmMessage>}
            <HpsmSection title={t('newKey')}>
              <HpsmToolbar label={t('keyActions')}>
                <HpsmToolbarButton
                  label={creating ? t('generating') : t('generateKey')}
                  title={t('generateKeyHint')}
                  icon={IconKey}
                  disabled={creating}
                  onClick={createKey}
                />
              </HpsmToolbar>
              <HpsmForm columns={2}>
                <HpsmField
                  label={t('grantedRole')}
                  htmlFor="key-role"
                  invalid={keyCheck.isInvalid('key-role')}
                >
                  <Select
                    id="key-role"
                    labelText={t('grantedRole')}
                    hideLabel
                    value={keyRole}
                    onChange={(e) => setKeyRole(e.target.value as Role)}
                  >
                    <SelectItem value="USER" text={t('roleUser')} />
                    <SelectItem value="ANALYST" text={t('roleAnalyst')} />
                    <SelectItem value="ADMIN" text="Admin" />
                  </Select>
                </HpsmField>
                <HpsmField
                  label={t('maxUses')}
                  htmlFor="key-maxuses"
                  required
                  invalid={keyCheck.isInvalid('key-maxuses')}
                  help={t('maxUsesHelp')}
                >
                  <TextInput
                    id="key-maxuses"
                    labelText={t('maxUses')}
                    hideLabel
                    type="number"
                    value={keyMaxUses}
                    onChange={(e) => setKeyMaxUses(e.target.value)}
                  />
                </HpsmField>
                <HpsmField
                  label={t('validityDays')}
                  htmlFor="key-days"
                  invalid={keyCheck.isInvalid('key-days')}
                  help={t('validityHelp')}
                >
                  <TextInput
                    id="key-days"
                    labelText={t('validityDays')}
                    hideLabel
                    type="number"
                    value={keyDays}
                    onChange={(e) => setKeyDays(e.target.value)}
                  />
                </HpsmField>
              </HpsmForm>
            </HpsmSection>

            {keysQuery.isLoading && <HpsmLoading text={t('loadingKeys')} />}
            {keysQuery.data && keysQuery.data.keys.length === 0 && (
              <HpsmMessage kind="info">{t('noKeys')}</HpsmMessage>
            )}
            {keysQuery.data && keysQuery.data.keys.length > 0 && (
              <DataTable
                rows={keysQuery.data.keys.map((k) => ({ id: k.id }))}
                headers={[
                  { key: 'code', header: t('key') },
                  { key: 'role', header: t('role') },
                  { key: 'uses', header: t('uses') },
                  { key: 'expires', header: t('expiresAt') },
                  { key: 'status', header: t('situation') },
                  { key: 'actions', header: t('actions') },
                ]}
              >
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="xs">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => (
                            <TableHeader {...getHeaderProps({ header })} key={header.key}>
                              {header.header}
                            </TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => {
                          const k = keysQuery.data!.keys.find((x) => x.id === row.id);
                          // O DataTable sincroniza as linhas um render depois: pula id antigo.
                          if (!k) return null;
                          const exhausted = k.usesUsed >= k.maxUses;
                          return (
                            <TableRow {...getRowProps({ row })} key={row.id}>
                              <TableCell>
                                <span className="dl-mono">{k.code}</span>
                                <CopyButton value={k.code} label={`chave ${k.code}`} />
                              </TableCell>
                              <TableCell>
                                <RoleTag role={k.role} />
                              </TableCell>
                              <TableCell>
                                {k.usesUsed}/{k.maxUses}
                              </TableCell>
                              <TableCell>{fmtDate(k.expiresAt)}</TableCell>
                              <TableCell>
                                {k.revoked ? (
                                  <StatusText tone="red">{t('revoked')}</StatusText>
                                ) : exhausted ? (
                                  <StatusText tone="gray">{t('exhausted')}</StatusText>
                                ) : (
                                  <StatusText tone="green">{t('activeF')}</StatusText>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  kind="danger--tertiary"
                                  disabled={k.revoked}
                                  onClick={() => revokeKey(k)}
                                >
                                  {t('revoke')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
          </>
        )}
      </div>
    </>
  );
}
