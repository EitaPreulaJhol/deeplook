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
import { HpsmField, HpsmForm, HpsmSection } from '../components/HpsmForm';
import { HpsmTabs } from '../components/HpsmTabs';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconKey } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { RoleTag, StatusText } from '../components/tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

export function AdminPage() {
  const queryClient = useQueryClient();
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

  const createKey = async () => {
    setError(null);
    setCreating(true);
    try {
      const res = await api.post<{ key: ActivationKey }>('/admin/activation-keys', {
        role: keyRole,
        maxUses: Number(keyMaxUses) || 1,
        expiresInDays: keyDays ? Number(keyDays) : undefined,
      });
      setLastKey(res.key.code);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'keys'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
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
                                    onClick={() =>
                                      updateUser(u.id, {
                                        status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                                      })
                                    }
                                  >
                                    {u.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
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
              </HpsmMessage>
            )}

            <HpsmSection title="Gerar nova chave">
              <HpsmToolbar label="Ações da chave">
                <HpsmToolbarButton
                  label={creating ? 'Gerando...' : 'Gerar chave'}
                  icon={IconKey}
                  disabled={creating}
                  onClick={createKey}
                />
              </HpsmToolbar>
              <HpsmForm columns={2}>
                <HpsmField label="Papel concedido" htmlFor="key-role">
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
                <HpsmField label="Máximo de usos" htmlFor="key-maxuses">
                  <TextInput
                    id="key-maxuses"
                    labelText="Máximo de usos"
                    hideLabel
                    type="number"
                    value={keyMaxUses}
                    onChange={(e) => setKeyMaxUses(e.target.value)}
                  />
                </HpsmField>
                <HpsmField label="Validade (dias)" htmlFor="key-days">
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
                                  onClick={() => revokeKey(k.id)}
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
