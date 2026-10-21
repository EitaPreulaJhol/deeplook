import { Button, Select, SelectItem } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { EntryStatus, Verdict } from '../api/types';
import { useConfirm } from './HpsmConfirm';
import { HpsmFilterItem } from './HpsmFilterBar';
import { statusLabel, verdictLabel } from './tags';

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
 * grade, muda status, veredito e/ou responsavel de todas de uma vez.
 */
export function EntriesBulkBar({ ids, onClear, onDone }: EntriesBulkBarProps) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [verdict, setVerdict] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);

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
      changes.push(`status → ${statusLabel(status as EntryStatus)}`);
    }
    if (verdict) {
      patch.verdict = verdict;
      changes.push(`veredito → ${verdictLabel(verdict as Verdict)}`);
    }
    if (assignee) {
      patch.assigneeId = assignee === NO_ASSIGNEE ? null : assignee;
      const name = analysts.find((a) => a.id === assignee)?.displayName ?? 'sem responsável';
      changes.push(`responsável → ${assignee === NO_ASSIGNEE ? 'sem responsável' : name}`);
    }
    if (changes.length === 0) {
      onDone({ kind: 'error', text: 'Escolha ao menos um campo para alterar.' });
      return;
    }

    const plural = ids.length === 1 ? 'amostra' : 'amostras';
    const ok = await confirm({
      title: 'Atualização em massa',
      message: `Atualizar ${ids.length} ${plural}: ${changes.join('; ')}?`,
      confirmLabel: 'Atualizar',
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
        text: res.updated === 1 ? '1 amostra atualizada.' : `${res.updated} amostras atualizadas.`,
      });
      setStatus('');
      setVerdict('');
      setAssignee('');
      onClear();
    } catch (err) {
      onDone({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hpsm-bulkbar" role="region" aria-label="Atualização em massa">
      <strong className="hpsm-bulkbar__count">
        {ids.length} {ids.length === 1 ? 'selecionada' : 'selecionadas'}:
      </strong>
      <HpsmFilterItem label="Status" htmlFor="bulk-status">
        <Select
          id="bulk-status"
          labelText="Status"
          hideLabel
          size="sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <SelectItem value="" text="(manter)" />
          <SelectItem value="PENDING" text="Pendente" />
          <SelectItem value="IN_REVIEW" text="Em análise" />
          <SelectItem value="COMPLETED" text="Concluído" />
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label="Veredito" htmlFor="bulk-verdict">
        <Select
          id="bulk-verdict"
          labelText="Veredito"
          hideLabel
          size="sm"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
        >
          <SelectItem value="" text="(manter)" />
          <SelectItem value="UNKNOWN" text="Desconhecido" />
          <SelectItem value="CLEAN" text="Limpo" />
          <SelectItem value="SUSPICIOUS" text="Suspeito" />
          <SelectItem value="MALICIOUS" text="Malicioso" />
        </Select>
      </HpsmFilterItem>
      <HpsmFilterItem label="Responsável" htmlFor="bulk-assignee">
        <Select
          id="bulk-assignee"
          labelText="Responsável"
          hideLabel
          size="sm"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <SelectItem value="" text="(manter)" />
          <SelectItem value={NO_ASSIGNEE} text="— Sem responsável —" />
          {analysts.map((a) => (
            <SelectItem key={a.id} value={a.id} text={a.displayName} />
          ))}
        </Select>
      </HpsmFilterItem>
      <Button kind="primary" size="sm" disabled={busy} onClick={apply}>
        {busy ? 'Aplicando...' : 'Aplicar'}
      </Button>
      <Button kind="ghost" size="sm" disabled={busy} onClick={onClear}>
        Limpar seleção
      </Button>
    </div>
  );
}
