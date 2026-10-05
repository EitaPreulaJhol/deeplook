import {
  Button,
  DataTable,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { ActivationKey, Role, User } from '../api/types';
import { HpsmTabs } from '../components/HpsmTabs';
import { PageHeader } from '../components/PageHeader';
import { RoleTag } from '../components/tags';

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
  const [tab, setTab] = useState('users');

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
      <PageHeader title="Administração" subtitle="Gerencie usuários e chaves de ativação." />

      {error && (
        <InlineNotification
          kind="error"
          title="Erro"
          subtitle={error}
          lowContrast
          className="dl-note dl-mb-lg"
        />
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
            {usersQuery.isLoading && <InlineLoading description="Carregando usuários..." />}
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
                    <Table {...getTableProps()} size="lg">
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
                          const u = usersQuery.data!.users.find((x) => x.id === row.id) as User;
                          return (
                            <TableRow {...getRowProps({ row })} key={row.id}>
                              <TableCell>{u.displayName}</TableCell>
                              <TableCell>{u.email}</TableCell>
                              <TableCell>
                                <RoleTag role={u.role} />
                              </TableCell>
                              <TableCell>
                                <Tag type={u.status === 'ACTIVE' ? 'green' : 'red'} size="sm">
                                  {u.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}
                                </Tag>
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
            <Tile className="dl-mb-lg">
              <h3 className="dl-mb-md">Gerar nova chave</h3>
              <div className="dl-toolbar">
                <Select
                  id="key-role"
                  labelText="Papel concedido"
                  value={keyRole}
                  onChange={(e) => setKeyRole(e.target.value as Role)}
                >
                  <SelectItem value="USER" text="Usuário" />
                  <SelectItem value="ANALYST" text="Analista" />
                  <SelectItem value="ADMIN" text="Admin" />
                </Select>
                <TextInput
                  id="key-maxuses"
                  labelText="Máximo de usos"
                  type="number"
                  value={keyMaxUses}
                  onChange={(e) => setKeyMaxUses(e.target.value)}
                />
                <TextInput
                  id="key-days"
                  labelText="Validade (dias)"
                  type="number"
                  value={keyDays}
                  onChange={(e) => setKeyDays(e.target.value)}
                />
                <Button onClick={createKey} disabled={creating}>
                  {creating ? 'Gerando...' : 'Gerar chave'}
                </Button>
              </div>
              {lastKey && (
                <InlineNotification
                  kind="success"
                  lowContrast
                  title="Chave criada"
                  subtitle={lastKey}
                  className="dl-note"
                />
              )}
            </Tile>

            {keysQuery.isLoading && <InlineLoading description="Carregando chaves..." />}
            {keysQuery.data && keysQuery.data.keys.length === 0 && (
              <div className="dl-empty">Nenhuma chave gerada ainda.</div>
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
                    <Table {...getTableProps()} size="lg">
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
                          const k = keysQuery.data!.keys.find(
                            (x) => x.id === row.id,
                          ) as ActivationKey;
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
                                  <Tag type="red" size="sm">
                                    Revogada
                                  </Tag>
                                ) : exhausted ? (
                                  <Tag type="warm-gray" size="sm">
                                    Esgotada
                                  </Tag>
                                ) : (
                                  <Tag type="green" size="sm">
                                    Ativa
                                  </Tag>
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
