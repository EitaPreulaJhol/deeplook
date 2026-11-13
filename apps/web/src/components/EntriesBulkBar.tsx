import { Button, Select, SelectItem, TextInput } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Priority, Verdict } from '../api/types';
import { t as tr } from '../i18n/entry';
import { AddToCaseDialog } from './AddToCaseDialog';
import { useConfirm } from './HpsmConfirm';
import { HpsmFilterItem } from './HpsmFilterBar';
import { RESOLUTION_MAX, RESOLUTION_TEMPLATES } from './ResolutionSection';
import { priorityLabel, statusLabel, verdictLabel } from './tags';

/** Valor do select de responsavel que remove a atribuicao. */
const NO_ASSIGNEE = '__none__';

interface EntriesBulkBarProps {
  ids: string[];
  onClear: () => void;
  /** Resultado da operacao (mostrado pela grade na barra de mensagens). */
  onDone: (result: { kind: 'success' | 'error'; text: string }) => void;
}

/**
 * Atualizacao em massa (padrao "Mass Update" do HPSM): com amostras marcadas na
 * grade, muda status, veredito, responsavel e/ou resolucao de todas de uma vez.
 * Resolucao vazia mantem: remover continua sendo na ficha (item 124).
 */
export function EntriesBulkBar({ ids, onClear, onDone }: EntriesBulkBarProps) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [verdict, setVerdict] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);

  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    staleTime: 5 * 60 * 1000,
  });
  const analysts = analystsQuery.data?.analysts ?? [];

  const apply = async () => {
    const patch: Record<string, string | null> = {};
    const changes: string[] = [];
    if (status) {
      patch.status = status;
      changes.push(tr('bulkStatus', { status: statusLabel(status as EntryStatus) }));
    }
    if (verdict) {
      patch.verdict = verdict;
      changes.push(tr('bulkVerdict', { verdict: verdictLabel(verdict as Verdict) }));
    }
    if (priority) {
      patch.priority = priority;
      changes.push(tr('bulkPriority', { priority: priorityLabel(priority as Priority) }));
    }
    if (assignee) {
      patch.assigneeId = assignee === NO_ASSIGNEE ? null : assignee;
      const name = analysts.find((a) => a.id === assignee)?.displayName ?? tr('noAssignee');
      changes.push(
        tr('bulkAssignee', { name: assignee === NO_ASSIGNEE ? tr('noAssignee') : name }),
      );
    }
    if (resolution.trim()) {
      patch.resolution = resolution.trim();
      changes.push(tr('bulkResolution', { resolution: resolution.trim() }));
    }
    if (changes.length === 0) {
      onDone({ kind: 'error', text: tr('pickOneField') });
      return;
    }

    const summary = changes.join('; ');
    const ok = await confirm({
      title: tr('bulkTitle'),
      message:
        ids.length === 1
          ? tr('bulkConfirmOne', { changes: summary })
          : tr('bulkConfirmMany', { n: ids.length, changes: summary }),
      confirmLabel: tr('update'),
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api.post<{ updated: number; notFound: string[] }>('/entries/bulk', {
        ids,
        patch,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
        queryClient.invalidateQueries({ queryKey: ['entry'] }),
      ]);
      onDone({
        kind: 'success',
        text: res.updated === 1 ? tr('updatedOne') : tr('updatedMany', { n: res.updated }),
      });
      setStatus('');
      setVerdict('');
      setPriority('');
      setAssignee('');
      setResolution('');
      onClear();
    } catch (err) {
      onDone({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hpsm-bulkbar" role="region" aria-label={tr('bulkTitle')}>
      <strong className="hpsm-bulkbar__count">
        {ids.length} {ids.length === 1 ? 'selecionada' : 'selecionadas'}:
      </strong>
      <HpsmFilterItem label={tr('colStatus')} htmlFor="bulk-status">
        <Select
          id="bulk-status"
          labelText={tr('colStatus')}
          hideLabel
          size="sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <SelectItem value="" text={tr('keep')} />
          <SelectItem value="PENDING" text={tr('stPending')} />
          <SelectItem value="IN_REVIEW" text={tr('stInReview')} />
          <SelectItem value="COMPLETED" text={tr('stCompleted')} />
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label={tr('colVerdict')} htmlFor="bulk-verdict">
        <Select
          id="bulk-verdict"
          labelText={tr('colVerdict')}
          hideLabel
          size="sm"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
        >
          <SelectItem value="" text={tr('keep')} />
          <SelectItem value="UNKNOWN" text={tr('vUnknown')} />
          <SelectItem value="CLEAN" text={tr('vClean')} />
          <SelectItem value="SUSPICIOUS" text={tr('vSuspicious')} />
          <SelectItem value="MALICIOUS" text={tr('vMalicious')} />
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label={tr('colPriority')} htmlFor="bulk-priority">
        <Select
          id="bulk-priority"
          labelText={tr('colPriority')}
          hideLabel
          size="sm"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <SelectItem value="" text={tr('keep')} />
          <SelectItem value="P1" text={tr('p1')} />
          <SelectItem value="P2" text={tr('p2')} />
          <SelectItem value="P3" text={tr('p3')} />
          <SelectItem value="P4" text={tr('p4')} />
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label={tr('colAssignee')} htmlFor="bulk-assignee">
        <Select
          id="bulk-assignee"
          labelText={tr('colAssignee')}
          hideLabel
          size="sm"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <SelectItem value="" text={tr('keep')} />
          <SelectItem value={NO_ASSIGNEE} text={tr('noAssigneeOption')} />
          {analysts.map((a) => (
            <SelectItem key={a.id} value={a.id} text={a.displayName} />
          ))}
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label={tr('resolution')} htmlFor="bulk-resolution">
        <TextInput
          id="bulk-resolution"
          labelText={tr('resolutionLabel')}
          hideLabel
          size="sm"
          list="bulk-resolution-templates"
          maxLength={RESOLUTION_MAX}
          placeholder={tr('keep')}
          title={tr('resolutionHelp')}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
        <datalist id="bulk-resolution-templates">
          {RESOLUTION_TEMPLATES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </HpsmFilterItem>
      <Button kind="primary" size="sm" disabled={busy} onClick={apply}>
        {busy ? tr('applying') : tr('apply')}
      </Button>
      {/* Casos (item 55): incluir as marcadas num caso ativo ou num novo. */}
      <Button kind="tertiary" size="sm" disabled={busy} onClick={() => setCaseOpen(true)}>
        {tr('addToCase')}
      </Button>
      {caseOpen && (
        <AddToCaseDialog
          entryIds={ids}
          onClose={(result) => {
            setCaseOpen(false);
            if (!result) return;
            const n = ids.length;
            onDone({
              kind: 'success',
              text: result.created
                ? tr(n === 1 ? 'caseCreatedOne' : 'caseCreatedMany', { code: result.code, n })
                : tr(n === 1 ? 'caseAddedOne' : 'caseAddedMany', { code: result.code, n }),
            });
            onClear();
          }}
        />
      )}
      {/* Exatamente duas marcadas: comparar lado a lado (item 58). */}
      {ids.length === 2 && (
        <Button
          kind="tertiary"
          size="sm"
          disabled={busy}
          onClick={() => navigate(`/comparar?a=${ids[0]}&b=${ids[1]}`)}
        >
          {tr('compareTwo')}
        </Button>
      )}
      <Button kind="ghost" size="sm" disabled={busy} onClick={onClear}>
        {tr('clearSelection')}
      </Button>
    </div>
  );
}
