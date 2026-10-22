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
import { CopyButton } from '../components/CopyButton';
import { useConfirm } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconKey } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { useSaveShortcut } from '../components/shortcuts';
import { RoleTag, StatusText } from '../components/tags';

/** Inteiro entre min e max (campos numericos do formulario de chave). */
function isIntBetween(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
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
  const tab = searchParams.get('tab') === 'keys' ? 'keys' : 'users';
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
    { id: 'key-role', label: 'Papel concedido', ok: true, api: 'role', value: keyRole },
    {
      id: 'key-maxuses',
      label: 'Máximo de usos (1 a 1000)',
      ok: isIntBetween(keyMaxUses, 1, 1000),
      api: 'maxUses',
      value: keyMaxUses,
    },
    {
      id: 'key-days',
      label: 'Validade (em branco ou 1 a 3650 dias)',
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
      title: 'Redefinir senha',
      message: (
        <>
          Deseja redefinir a senha de <strong>{u.displayName}</strong>? Uma senha temporária será
          gerada e todas as sessões dessa pessoa serão encerradas.
        </>
      ),
      confirmLabel: 'Redefinir',
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
        title: 'Suspender usuário',
        message: (
          <>
            Deseja realmente suspender <strong>{u.displayName}</strong>? A pessoa perde o acesso
            imediatamente.
          </>
        ),
        confirmLabel: 'Suspender',
        danger: true,
      });
      if (!ok) return;
    }
    await updateUser(u.id, { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
  };

  const revokeKey = async (key: ActivationKey) => {
    const ok = await confirm({
      title: 'Revogar chave',
      message: (
        <>
          Deseja realmente revogar a chave <span className="dl-mono">{key.code}</span>? Ela deixa de
          aceitar novos cadastros.
        </>
      ),
      confirmLabel: 'Revogar',
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
      <PageHeader title="Administração" subtitle="Gerencie o funcionamento da aplicação." />

      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {resetResult && (
        <HpsmMessage kind="success">
          Senha temporária de {resetResult.name}:{' '}
          <span className="dl-mono">{resetResult.password}</span>
          <CopyButton value={resetResult.password} label="senha temporária" /> — repasse ao usuário;
          ela não será mostrada de novo. As sessões dessa pessoa foram encerradas.
        </HpsmMessage>
      )}

      <HpsmTabs
        ariaLabel="Administração"
        active={tab}
        onChange={setTab}
        items={[
          { id: 'users', label: 'Usuários' },
          { id: 'keys', label: 'Chaves de ativação' },
        ]}
      />

      <div className="hpsm-tabpanel">
        {tab === 'users' ? (
          <>
            {usersQuery.isLoading && <HpsmLoading text="Carregando usuários..." />}
            {usersQuery.data && (
              <DataTable
                rows={usersQuery.data.users.map((u) => ({ id: u.id }))}
                headers={[
                  { key: 'name', header: 'Nome' },
                  { key: 'email', header: 'E-mail' },
                  { key: 'role', header: 'Papel' },
                  { key: 'status', header: 'Status' },
                  { key: 'entries', header: 'Envios' },
                  { key: 'actions', header: 'Ações' },
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
                          const u = usersQuery.data!.users.find((x) => x.id === row.id);
                          // O DataTable sincroniza as linhas um render depois: pula id antigo.
                          if (!u) return null;
                          return (
                            <TableRow {...getRowProps({ row })} key={row.id}>
                              <TableCell>{u.displayName}</TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell>
                                <RoleTag role={u.role} />
                              </TableCell>
                              <TableCell>
                                <StatusText tone={u.status === 'ACTIVE' ? 'green' : 'red'}>
                                  {u.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}
                                </StatusText>
                              </TableCell>
                              <TableCell>{u._count ? u._count.entries : 0}</TableCell>
                              <TableCell>
                                <div className="dl-row">
                                  <Select
                                    id={`role-${u.id}`}
                                    labelText="Papel"
                                    hideLabel
                                    size="sm"
                                    value={u.role}
                                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                                  >
                                    <SelectItem value="USER" text="Usuário" />
                                    <SelectItem value="ANALYST" text="Analista" />
                                    <SelectItem value="ADMIN" text="Admin" />
                                  </Select>
                                  <Button
                                    size="sm"
                                    kind={u.status === 'ACTIVE' ? 'danger--tertiary' : 'tertiary'}
                                    onClick={() => toggleStatus(u)}
                                  >
                                    {u.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    kind="tertiary"
                                    disabled={u.id === currentUser?.id}
                                    title={
                                      u.id === currentUser?.id
                                        ? 'Use Minha conta > Alterar senha'
                                        : undefined
                                    }
                                    onClick={() => resetPassword(u)}
                                  >
                                    Redefinir senha
                                  </Button>
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
                Chave criada: <span className="dl-mono">{lastKey}</span>
                <CopyButton value={lastKey} label="chave" />
              </HpsmMessage>
            )}

            {keyCheck.message && <HpsmMessage kind="error">{keyCheck.message}</HpsmMessage>}
            <HpsmSection title="Gerar nova chave">
              <HpsmToolbar label="Ações da chave">
                <HpsmToolbarButton
                  label={creating ? 'Gerando...' : 'Gerar chave'}
                  title="Gerar chave (Ctrl+S)"
                  icon={IconKey}
                  disabled={creating}
                  onClick={createKey}
                />
              </HpsmToolbar>
              <HpsmForm columns={2}>
                <HpsmField
                  label="Papel concedido"
                  htmlFor="key-role"
                  invalid={keyCheck.isInvalid('key-role')}
                >
                  <Select
                    id="key-role"
                    labelText="Papel concedido"
                    hideLabel
                    value={keyRole}
                    onChange={(e) => setKeyRole(e.target.value as Role)}
                  >
                    <SelectItem value="USER" text="Usuário" />
                    <SelectItem value="ANALYST" text="Analista" />
                    <SelectItem value="ADMIN" text="Admin" />
                  </Select>
                </HpsmField>
                <HpsmField
                  label="Máximo de usos"
                  htmlFor="key-maxuses"
                  required
                  invalid={keyCheck.isInvalid('key-maxuses')}
                  help="De 1 a 1000 cadastros com esta chave."
                >
                  <TextInput
                    id="key-maxuses"
                    labelText="Máximo de usos"
                    hideLabel
                    type="number"
                    value={keyMaxUses}
                    onChange={(e) => setKeyMaxUses(e.target.value)}
                  />
                </HpsmField>
                <HpsmField
                  label="Validade (dias)"
                  htmlFor="key-days"
                  invalid={keyCheck.isInvalid('key-days')}
                  help="Em branco = sem prazo; de 1 a 3650 dias."
                >
                  <TextInput
                    id="key-days"
                    labelText="Validade (dias)"
                    hideLabel
                    type="number"
                    value={keyDays}
                    onChange={(e) => setKeyDays(e.target.value)}
                  />
                </HpsmField>
              </HpsmForm>
            </HpsmSection>

            {keysQuery.isLoading && <HpsmLoading text="Carregando chaves..." />}
            {keysQuery.data && keysQuery.data.keys.length === 0 && (
              <HpsmMessage kind="info">Nenhuma chave gerada ainda.</HpsmMessage>
            )}
            {keysQuery.data && keysQuery.data.keys.length > 0 && (
              <DataTable
                rows={keysQuery.data.keys.map((k) => ({ id: k.id }))}
                headers={[
                  { key: 'code', header: 'Chave' },
                  { key: 'role', header: 'Papel' },
                  { key: 'uses', header: 'Usos' },
                  { key: 'expires', header: 'Expira em' },
                  { key: 'status', header: 'Situação' },
                  { key: 'actions', header: 'Ações' },
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
                                  <StatusText tone="red">Revogada</StatusText>
                                ) : exhausted ? (
                                  <StatusText tone="gray">Esgotada</StatusText>
                                ) : (
                                  <StatusText tone="green">Ativa</StatusText>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  kind="danger--tertiary"
                                  disabled={k.revoked}
                                  onClick={() => revokeKey(k)}
                                >
                                  Revogar
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
