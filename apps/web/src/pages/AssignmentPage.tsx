import {
  Checkbox,
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

import { api } from '../api/client';
import type { EntryType, Priority } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useConfirm, usePrompt } from '../components/HpsmConfirm';
import { HpsmField, HpsmForm, HpsmFormActions, HpsmSection } from '../components/HpsmForm';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/tags';

interface Member {
  id: string;
  displayName: string;
  away: boolean;
  available: boolean;
  lastAssignedAt: string | null;
}
interface Group {
  id: string;
  name: string;
  rules: number;
  members: Member[];
}
interface Rule {
  id: string;
  position: number;
  enabled: boolean;
  entryType: EntryType | null;
  tag: string | null;
  priority: Priority | null;
  label: string;
  group: { id: string; name: string };
}
interface AssignmentData {
  groups: Group[];
  rules: Rule[];
  analysts: { id: string; displayName: string; away: boolean }[];
}

const EMPTY_RULE = { groupId: '', entryType: '', tag: '', priority: '' };

/**
 * Atribuicao automatica (item 72): grupos de analistas, regras em ordem
 * ("quando chegar... vai para o grupo") e quem esta ausente. A amostra nova vai
 * para o membro disponivel do grupo que recebeu ha mais tempo (rodizio).
 */
export function AssignmentPage() {
  const { user, refresh } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const query = useQuery({
    queryKey: ['assignment'],
    queryFn: () => api.get<AssignmentData>('/assignment'),
  });
  const data = query.data;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [newGroup, setNewGroup] = useState('');
  const [editing, setEditing] = useState<{ id: string; members: Set<string> } | null>(null);
  const [rule, setRule] = useState(EMPTY_RULE);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['assignment'] });
      setNotice({ ok: true, text });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const createGroup = () =>
    run(async () => {
      await api.post('/assignment/groups', { name: newGroup });
      setNewGroup('');
      return `Grupo "${newGroup.trim()}" criado. Escolha os membros em "Membros…".`;
    });

  const renameGroup = async (g: Group) => {
    const name = await prompt({
      title: 'Renomear grupo',
      label: 'Nome',
      defaultValue: g.name,
      maxLength: 60,
      confirmLabel: 'Salvar',
    });
    if (name === null || name.trim() === g.name) return;
    await run(async () => {
      await api.patch(`/assignment/groups/${g.id}`, { name });
      return `Grupo renomeado para "${name.trim()}".`;
    });
  };

  const deleteGroup = async (g: Group) => {
    const ok = await confirm({
      title: 'Excluir grupo',
      message: `Excluir o grupo "${g.name}"?${g.rules ? ` As ${g.rules} regra(s) dele também saem.` : ''} As amostras já atribuídas não mudam.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/assignment/groups/${g.id}`);
      return `Grupo "${g.name}" excluído.`;
    });
  };

  const saveMembers = () =>
    editing &&
    run(async () => {
      await api.patch(`/assignment/groups/${editing.id}`, { memberIds: [...editing.members] });
      setEditing(null);
      return 'Membros atualizados.';
    });

  const setAway = (userId: string, away: boolean, name: string) =>
    run(async () => {
      await api.put(`/assignment/away/${userId}`, { away });
      if (userId === user?.id) await refresh();
      return away
        ? `${userId === user?.id ? 'Você está' : `${name} está`} ausente: o rodízio pula até voltar.`
        : `${userId === user?.id ? 'Você voltou' : `${name} voltou`} ao rodízio.`;
    });

  const addRule = () =>
    run(async () => {
      if (!rule.groupId) throw new Error('Escolha o grupo que recebe as amostras.');
      await api.post('/assignment/rules', {
        groupId: rule.groupId,
        entryType: rule.entryType || null,
        tag: rule.tag || null,
        priority: rule.priority || null,
      });
      setRule(EMPTY_RULE);
      return 'Regra incluída no fim da lista.';
    });

  const moveRule = (r: Rule, direction: 'up' | 'down') =>
    run(async () => {
      await api.post(`/assignment/rules/${r.id}/move`, { direction });
      return `Regra "${r.label}" ${direction === 'up' ? 'subiu' : 'desceu'}.`;
    });

  const toggleRule = (r: Rule) =>
    run(async () => {
      await api.patch(`/assignment/rules/${r.id}`, { enabled: !r.enabled });
      return `Regra "${r.label}" ${r.enabled ? 'desligada' : 'ligada'}.`;
    });

  const deleteRule = async (r: Rule) => {
    const ok = await confirm({
      title: 'Excluir regra',
      message: `Excluir a regra "${r.label} → ${r.group.name}"?`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/assignment/rules/${r.id}`);
      return 'Regra excluída.';
    });
  };

  return (
    <>
      <PageHeader
        title="Atribuição automática"
        subtitle="Amostras novas vão para um grupo pela primeira regra que casar; dentro do grupo, para quem recebeu há mais tempo, pulando ausentes. Sem regra, ficam sem responsável."
      />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text="Carregando a configuração..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}

      {data && (
        <>
          <HpsmSection title={`Regras (${data.rules.length})`}>
            {data.rules.length === 0 ? (
              <p className="dl-static-empty">
                Nenhuma regra: as amostras novas ficam sem responsável.
              </p>
            ) : (
              <TableContainer>
                <Table size="xs" aria-label="Regras de atribuição">
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">Ordem</TableHeader>
                      <TableHeader scope="col">Quando chegar</TableHeader>
                      <TableHeader scope="col">Vai para o grupo</TableHeader>
                      <TableHeader scope="col">Situação</TableHeader>
                      <TableHeader scope="col">Ações</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.rules.map((r, i) => (
                      <TableRow key={r.id} className={r.enabled ? undefined : 'is-off'}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>{r.label}</TableCell>
                        <TableCell>{r.group.name}</TableCell>
                        <TableCell>
                          <StatusText tone={r.enabled ? 'green' : 'gray'}>
                            {r.enabled ? 'Ligada' : 'Desligada'}
                          </StatusText>
                        </TableCell>
                        <TableCell>
                          <span className="dl-row-actions">
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy || i === 0}
                              aria-label={`Subir a regra ${i + 1}`}
                              onClick={() => void moveRule(r, 'up')}
                            >
                              ▲ Subir
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy || i === data.rules.length - 1}
                              aria-label={`Descer a regra ${i + 1}`}
                              onClick={() => void moveRule(r, 'down')}
                            >
                              ▼ Descer
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void toggleRule(r)}
                            >
                              {r.enabled ? 'Desligar' : 'Ligar'}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void deleteRule(r)}
                            >
                              Excluir
                            </button>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {data.groups.length === 0 ? (
              <p className="dl-static-empty">Crie um grupo abaixo para poder incluir regras.</p>
            ) : (
              <HpsmForm columns={2}>
                <HpsmField label="Grupo" htmlFor="rule-group" required>
                  <Select
                    id="rule-group"
                    labelText="Grupo"
                    hideLabel
                    value={rule.groupId}
                    onChange={(e) => setRule((r) => ({ ...r, groupId: e.target.value }))}
                  >
                    <SelectItem value="" text="— Escolha —" />
                    {data.groups.map((g) => (
                      <SelectItem key={g.id} value={g.id} text={g.name} />
                    ))}
                  </Select>
                </HpsmField>
                <HpsmField label="Tipo" htmlFor="rule-type">
                  <Select
                    id="rule-type"
                    labelText="Tipo"
                    hideLabel
                    value={rule.entryType}
                    onChange={(e) => setRule((r) => ({ ...r, entryType: e.target.value }))}
                  >
                    <SelectItem value="" text="Qualquer" />
                    <SelectItem value="FILE" text="Arquivo" />
                    <SelectItem value="URL" text="Link" />
                  </Select>
                </HpsmField>
                <HpsmField label="Com a tag" htmlFor="rule-tag">
                  <TextInput
                    id="rule-tag"
                    labelText="Com a tag"
                    hideLabel
                    maxLength={50}
                    placeholder="qualquer"
                    value={rule.tag}
                    onChange={(e) => setRule((r) => ({ ...r, tag: e.target.value }))}
                  />
                </HpsmField>
                <HpsmField label="Prioridade" htmlFor="rule-priority">
                  <Select
                    id="rule-priority"
                    labelText="Prioridade"
                    hideLabel
                    value={rule.priority}
                    onChange={(e) => setRule((r) => ({ ...r, priority: e.target.value }))}
                  >
                    <SelectItem value="" text="Qualquer" />
                    <SelectItem value="P1" text="P1 Crítica" />
                    <SelectItem value="P2" text="P2 Alta" />
                    <SelectItem value="P3" text="P3 Média" />
                    <SelectItem value="P4" text="P4 Baixa" />
                  </Select>
                </HpsmField>
                <HpsmFormActions>
                  <button
                    type="button"
                    className="dl-btn dl-btn--primary"
                    disabled={busy}
                    onClick={() => void addRule()}
                  >
                    Incluir regra
                  </button>
                </HpsmFormActions>
              </HpsmForm>
            )}
          </HpsmSection>

          <HpsmSection title={`Grupos (${data.groups.length})`} className="dl-mt-lg">
            {data.groups.length > 0 && (
              <TableContainer>
                <Table size="xs" aria-label="Grupos de analistas">
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">Grupo</TableHeader>
                      <TableHeader scope="col">Membros</TableHeader>
                      <TableHeader scope="col">Regras</TableHeader>
                      <TableHeader scope="col">Ações</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.groups.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>{g.name}</TableCell>
                        <TableCell>
                          {g.members.length === 0 ? (
                            <em>ninguém (as regras dele não atribuem)</em>
                          ) : (
                            g.members.map((m, i) => (
                              <span key={m.id}>
                                {i > 0 && ', '}
                                {m.available ? (
                                  m.displayName
                                ) : (
                                  <span className="dl-hint-muted">
                                    {m.displayName} ({m.away ? 'ausente' : 'inativo'})
                                  </span>
                                )}
                              </span>
                            ))
                          )}
                        </TableCell>
                        <TableCell>{g.rules}</TableCell>
                        <TableCell>
                          <span className="dl-row-actions">
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() =>
                                setEditing({
                                  id: g.id,
                                  members: new Set(g.members.map((m) => m.id)),
                                })
                              }
                            >
                              Membros…
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void renameGroup(g)}
                            >
                              Renomear…
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void deleteGroup(g)}
                            >
                              Excluir
                            </button>
                          </span>
                          {editing?.id === g.id && (
                            <fieldset className="dl-members">
                              <legend>Membros de {g.name}</legend>
                              {data.analysts.map((a) => (
                                <Checkbox
                                  key={a.id}
                                  id={`member-${g.id}-${a.id}`}
                                  labelText={a.displayName}
                                  checked={editing.members.has(a.id)}
                                  onChange={(_, { checked }) => {
                                    const next = new Set(editing.members);
                                    if (checked) next.add(a.id);
                                    else next.delete(a.id);
                                    setEditing({ id: g.id, members: next });
                                  }}
                                />
                              ))}
                              <span className="dl-row-actions">
                                <button
                                  type="button"
                                  className="dl-btn dl-btn--primary"
                                  disabled={busy}
                                  onClick={() => void saveMembers()}
                                >
                                  Salvar membros
                                </button>
                                <button
                                  type="button"
                                  className="dl-btn"
                                  onClick={() => setEditing(null)}
                                >
                                  Cancelar
                                </button>
                              </span>
                            </fieldset>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <HpsmForm>
              <HpsmField label="Novo grupo" htmlFor="group-name">
                <span className="dl-inline-form">
                  <TextInput
                    id="group-name"
                    labelText="Novo grupo"
                    hideLabel
                    maxLength={60}
                    placeholder="ex.: Phishing"
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                  />
                  <button
                    type="button"
                    className="dl-btn"
                    disabled={busy || newGroup.trim().length < 2}
                    onClick={() => void createGroup()}
                  >
                    Criar grupo
                  </button>
                </span>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>

          <HpsmSection title="Disponibilidade" className="dl-mt-lg">
            <p className="dl-static-empty">
              Quem está ausente (férias, folga) não recebe amostras do rodízio.{' '}
              {isAdmin
                ? 'Como admin, você marca qualquer analista.'
                : 'Você marca a si mesmo; um admin marca os outros.'}
            </p>
            <TableContainer>
              <Table size="xs" aria-label="Disponibilidade dos analistas">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Analista</TableHeader>
                    <TableHeader scope="col">Ausente</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.analysts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        {a.id === user?.id ? `${a.displayName} (você)` : a.displayName}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          id={`away-${a.id}`}
                          labelText={`${a.displayName} ausente`}
                          hideLabel
                          checked={a.away}
                          disabled={busy || (!isAdmin && a.id !== user?.id)}
                          onChange={(_, { checked }) => void setAway(a.id, checked, a.displayName)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </HpsmSection>
        </>
      )}
    </>
  );
}
