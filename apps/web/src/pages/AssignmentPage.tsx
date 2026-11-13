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
import { t } from '../i18n/mgmt';

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
      return t('groupCreated', { name: newGroup.trim() });
    });

  const renameGroup = async (g: Group) => {
    const name = await prompt({
      title: t('renameGroup'),
      label: t('name'),
      defaultValue: g.name,
      maxLength: 60,
      confirmLabel: t('save'),
    });
    if (name === null || name.trim() === g.name) return;
    await run(async () => {
      await api.patch(`/assignment/groups/${g.id}`, { name });
      return t('groupRenamed', { name: name.trim() });
    });
  };

  const deleteGroup = async (g: Group) => {
    const ok = await confirm({
      title: t('deleteGroup'),
      message: t('deleteGroupConfirm', {
        name: g.name,
        rules: g.rules ? ` ${t('groupRulesToo', { n: g.rules })}` : '',
      }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/assignment/groups/${g.id}`);
      return t('groupDeleted', { name: g.name });
    });
  };

  const saveMembers = () =>
    editing &&
    run(async () => {
      await api.patch(`/assignment/groups/${editing.id}`, { memberIds: [...editing.members] });
      setEditing(null);
      return t('membersUpdated');
    });

  const setAway = (userId: string, away: boolean, name: string) =>
    run(async () => {
      await api.put(`/assignment/away/${userId}`, { away });
      if (userId === user?.id) await refresh();
      return away
        ? userId === user?.id
          ? t('youAway')
          : t('userAway', { name })
        : userId === user?.id
          ? t('youBack')
          : t('userBack', { name });
    });

  const addRule = () =>
    run(async () => {
      if (!rule.groupId) throw new Error(t('chooseGroup'));
      await api.post('/assignment/rules', {
        groupId: rule.groupId,
        entryType: rule.entryType || null,
        tag: rule.tag || null,
        priority: rule.priority || null,
      });
      setRule(EMPTY_RULE);
      return t('ruleAddedEnd');
    });

  const moveRule = (r: Rule, direction: 'up' | 'down') =>
    run(async () => {
      await api.post(`/assignment/rules/${r.id}/move`, { direction });
      return t(direction === 'up' ? 'ruleUp' : 'ruleDown', { name: r.label });
    });

  const toggleRule = (r: Rule) =>
    run(async () => {
      await api.patch(`/assignment/rules/${r.id}`, { enabled: !r.enabled });
      return t(r.enabled ? 'ruleOff' : 'ruleOn', { name: r.label });
    });

  const deleteRule = async (r: Rule) => {
    const ok = await confirm({
      title: t('deleteRule'),
      message: t('deleteAssignConfirm', { rule: r.label, group: r.group.name }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/assignment/rules/${r.id}`);
      return t('ruleDeletedShort');
    });
  };

  return (
    <>
      <PageHeader title={t('assignTitle')} subtitle={t('assignSubtitle')} />
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text={t('loadingConfig')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}

      {data && (
        <>
          <HpsmSection title={t('rulesN', { n: data.rules.length })}>
            {data.rules.length === 0 ? (
              <p className="dl-static-empty">{t('noAssignRules')}</p>
            ) : (
              <TableContainer>
                <Table size="xs" aria-label={t('assignRulesAria')}>
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">{t('order')}</TableHeader>
                      <TableHeader scope="col">{t('whenArrives')}</TableHeader>
                      <TableHeader scope="col">{t('goesToGroup')}</TableHeader>
                      <TableHeader scope="col">{t('situation')}</TableHeader>
                      <TableHeader scope="col">{t('actions')}</TableHeader>
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
                            {r.enabled ? t('on') : t('off')}
                          </StatusText>
                        </TableCell>
                        <TableCell>
                          <span className="dl-row-actions">
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy || i === 0}
                              aria-label={t('moveUpRule', { n: i + 1 })}
                              onClick={() => void moveRule(r, 'up')}
                            >
                              {t('moveUp')}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy || i === data.rules.length - 1}
                              aria-label={t('moveDownRule', { n: i + 1 })}
                              onClick={() => void moveRule(r, 'down')}
                            >
                              {t('moveDown')}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void toggleRule(r)}
                            >
                              {r.enabled ? t('turnOff') : t('turnOn')}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void deleteRule(r)}
                            >
                              {t('delete')}
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
              <p className="dl-static-empty">{t('createGroupFirst')}</p>
            ) : (
              <HpsmForm columns={2}>
                <HpsmField label={t('group')} htmlFor="rule-group" required>
                  <Select
                    id="rule-group"
                    labelText={t('group')}
                    hideLabel
                    value={rule.groupId}
                    onChange={(e) => setRule((r) => ({ ...r, groupId: e.target.value }))}
                  >
                    <SelectItem value="" text={t('choose')} />
                    {data.groups.map((g) => (
                      <SelectItem key={g.id} value={g.id} text={g.name} />
                    ))}
                  </Select>
                </HpsmField>
                <HpsmField label={t('type')} htmlFor="rule-type">
                  <Select
                    id="rule-type"
                    labelText={t('type')}
                    hideLabel
                    value={rule.entryType}
                    onChange={(e) => setRule((r) => ({ ...r, entryType: e.target.value }))}
                  >
                    <SelectItem value="" text={t('any')} />
                    <SelectItem value="FILE" text={t('file')} />
                    <SelectItem value="URL" text={t('link')} />
                  </Select>
                </HpsmField>
                <HpsmField label={t('withTag')} htmlFor="rule-tag">
                  <TextInput
                    id="rule-tag"
                    labelText={t('withTag')}
                    hideLabel
                    maxLength={50}
                    placeholder="qualquer"
                    value={rule.tag}
                    onChange={(e) => setRule((r) => ({ ...r, tag: e.target.value }))}
                  />
                </HpsmField>
                <HpsmField label={t('priority')} htmlFor="rule-priority">
                  <Select
                    id="rule-priority"
                    labelText={t('priority')}
                    hideLabel
                    value={rule.priority}
                    onChange={(e) => setRule((r) => ({ ...r, priority: e.target.value }))}
                  >
                    <SelectItem value="" text={t('any')} />
                    <SelectItem value="P1" text={t('p1')} />
                    <SelectItem value="P2" text={t('p2')} />
                    <SelectItem value="P3" text={t('p3')} />
                    <SelectItem value="P4" text={t('p4')} />
                  </Select>
                </HpsmField>
                <HpsmFormActions>
                  <button
                    type="button"
                    className="dl-btn dl-btn--primary"
                    disabled={busy}
                    onClick={() => void addRule()}
                  >
                    {t('addRule')}
                  </button>
                </HpsmFormActions>
              </HpsmForm>
            )}
          </HpsmSection>

          <HpsmSection title={t('groupsN', { n: data.groups.length })} className="dl-mt-lg">
            {data.groups.length > 0 && (
              <TableContainer>
                <Table size="xs" aria-label={t('groupsAria')}>
                  <TableHead>
                    <TableRow>
                      <TableHeader scope="col">{t('group')}</TableHeader>
                      <TableHeader scope="col">{t('members')}</TableHeader>
                      <TableHeader scope="col">{t('rules')}</TableHeader>
                      <TableHeader scope="col">{t('actions')}</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.groups.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>{g.name}</TableCell>
                        <TableCell>
                          {g.members.length === 0 ? (
                            <em>{t('nobody')}</em>
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
                              {t('membersEllipsis')}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void renameGroup(g)}
                            >
                              {t('renameEllipsis')}
                            </button>
                            <button
                              type="button"
                              className="dl-link-button"
                              disabled={busy}
                              onClick={() => void deleteGroup(g)}
                            >
                              {t('delete')}
                            </button>
                          </span>
                          {editing?.id === g.id && (
                            <fieldset className="dl-members">
                              <legend>{t('membersOf', { name: g.name })}</legend>
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
                                  {t('saveMembers')}
                                </button>
                                <button
                                  type="button"
                                  className="dl-btn"
                                  onClick={() => setEditing(null)}
                                >
                                  {t('cancel')}
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
              <HpsmField label={t('newGroup')} htmlFor="group-name">
                <span className="dl-inline-form">
                  <TextInput
                    id="group-name"
                    labelText={t('newGroup')}
                    hideLabel
                    maxLength={60}
                    placeholder={t('groupPlaceholder')}
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                  />
                  <button
                    type="button"
                    className="dl-btn"
                    disabled={busy || newGroup.trim().length < 2}
                    onClick={() => void createGroup()}
                  >
                    {t('createGroup')}
                  </button>
                </span>
              </HpsmField>
            </HpsmForm>
          </HpsmSection>

          <HpsmSection title={t('availability')} className="dl-mt-lg">
            <p className="dl-static-empty">
              {t('awayHint')} {isAdmin ? t('awayAdmin') : t('awaySelf')}
            </p>
            <TableContainer>
              <Table size="xs" aria-label={t('availabilityAria')}>
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('analyst')}</TableHeader>
                    <TableHeader scope="col">{t('away')}</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.analysts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        {a.id === user?.id
                          ? t('youSuffix', { name: a.displayName })
                          : a.displayName}
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
