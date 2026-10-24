import { Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { Entry, EntryStatus, Priority, SlaConfig, Verdict } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AttackFilterInput } from '../components/attack';
import { EntriesTable, entryListParams } from '../components/EntriesTable';
import { suggestViewName } from '../components/favorites';
import { HpsmFilterBar, HpsmFilterItem } from '../components/HpsmFilterBar';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPage } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { priorityLabel, statusLabel, verdictLabel } from '../components/tags';
import { useEntryListState } from '../components/useEntryListState';
import { useTakeNext } from '../components/useTakeNext';

export function GlobalHistoryPage() {
  const { user, preferences } = useAuth();
  const canTriage = user?.role === 'ANALYST' || user?.role === 'ADMIN';
  const pageSize = preferences.pageSize;
  // Busca, filtros, ordenacao e pagina ficam na URL (ver useEntryListState).
  const list = useEntryListState();
  const next = useTakeNext();
  const { q, draftQ, setDraftQ, sort, offset } = list;
  const { type, status, verdict, priority, attack, assignee, age, submittedFrom, completedFrom } =
    list.filters;
  // Analistas do select "Responsável" (o Painel leva a um analista especifico).
  const analystsQuery = useQuery({
    queryKey: ['analysts'],
    queryFn: () => api.get<{ analysts: { id: string; displayName: string }[] }>('/analysts'),
    enabled: canTriage,
    staleTime: 5 * 60 * 1000,
  });
  // Filtros de periodo (links do Painel) aparecem como etiquetas removiveis.
  const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
  const chips = [
    ...(submittedFrom
      ? [
          {
            label: `Enviadas desde ${dateLabel(submittedFrom)}`,
            onRemove: () => list.setFilter('submittedFrom', ''),
          },
        ]
      : []),
    ...(completedFrom
      ? [
          {
            label: `Concluídas desde ${dateLabel(completedFrom)}`,
            onRemove: () => list.setFilter('completedFrom', ''),
          },
        ]
      : []),
  ];

  const params = new URLSearchParams();
  params.set('scope', 'all');
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (verdict) params.set('verdict', verdict);
  if (priority) params.set('priority', priority);
  if (attack) params.set('attack', attack);
  if (assignee) params.set('assignee', assignee);
  if (age) params.set('age', age);
  if (submittedFrom) params.set('submittedFrom', submittedFrom);
  if (completedFrom) params.set('completedFrom', completedFrom);
  entryListParams(params, sort, offset, pageSize);

  // Exportar CSV: mesma busca, filtros e ordenacao, sem paginacao.
  const exportParams = new URLSearchParams(params);
  exportParams.delete('offset');
  exportParams.delete('limit');
  const exportHref = `/api/entries/export.csv?${exportParams.toString()}`;

  const viewName = suggestViewName('Histórico Global', [
    status && statusLabel(status as EntryStatus),
    verdict && verdictLabel(verdict as Verdict),
    priority && priorityLabel(priority as Priority),
    attack && `ATT&CK ${attack}`,
    type && (type === 'FILE' ? 'Arquivos' : 'URLs'),
    assignee === 'me' && 'Atribuídas a mim',
    assignee === 'none' && 'Sem responsável',
    age === 'warn' && 'Em alerta',
    age === 'late' && 'Atrasadas',
    q && `"${q}"`,
  ]);

  const query = useQuery({
    queryKey: [
      'entries',
      'all',
      q,
      type,
      status,
      verdict,
      priority,
      attack,
      assignee,
      age,
      submittedFrom,
      completedFrom,
      sort.key,
      sort.dir,
      offset,
      pageSize,
    ],
    queryFn: () =>
      api.get<{ items: Entry[]; total: number; sla: SlaConfig }>(`/entries?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Histórico Global" subtitle="Todas as amostras enviadas pela comunidade." />

      {/* Analistas: "Pegar a proxima" em todas as filas (Next in queue do HPSM). */}
      {canTriage && (
        <HpsmToolbar label="Ações da fila">
          <HpsmToolbarButton
            label={next.taking ? 'Pegando...' : 'Pegar a próxima'}
            icon={IconPage}
            title="Atribui a você a amostra pendente sem responsável mais antiga e abre a ficha"
            disabled={next.taking}
            onClick={() => void next.take()}
          />
        </HpsmToolbar>
      )}
      {next.notice && (
        <HpsmMessage key={next.notice.text} kind={next.notice.kind}>
          {next.notice.text}
        </HpsmMessage>
      )}

      <HpsmFilterBar onClear={list.clear} exportHref={exportHref} viewName={viewName} chips={chips}>
        <HpsmFilterItem label="Buscar" htmlFor="q">
          <TextInput
            id="q"
            labelText="Buscar"
            hideLabel
            size="sm"
            placeholder="Título, hash, URL, arquivo..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label="Tipo" htmlFor="type">
          <Select
            id="type"
            labelText="Tipo"
            hideLabel
            size="sm"
            value={type}
            onChange={(e) => list.setFilter('type', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="FILE" text="Arquivo" />
            <SelectItem value="URL" text="Link" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Status" htmlFor="status">
          <Select
            id="status"
            labelText="Status"
            hideLabel
            size="sm"
            value={status}
            onChange={(e) => list.setFilter('status', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="PENDING" text="Pendente" />
            <SelectItem value="IN_REVIEW" text="Em análise" />
            <SelectItem value="COMPLETED" text="Concluído" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Veredito" htmlFor="verdict">
          <Select
            id="verdict"
            labelText="Veredito"
            hideLabel
            size="sm"
            value={verdict}
            onChange={(e) => list.setFilter('verdict', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="UNKNOWN" text="Desconhecido" />
            <SelectItem value="CLEAN" text="Limpo" />
            <SelectItem value="SUSPICIOUS" text="Suspeito" />
            <SelectItem value="MALICIOUS" text="Malicioso" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="Prioridade" htmlFor="priority">
          <Select
            id="priority"
            labelText="Prioridade"
            hideLabel
            size="sm"
            value={priority}
            onChange={(e) => list.setFilter('priority', e.target.value)}
          >
            <SelectItem value="" text="Todas" />
            <SelectItem value="P1" text="P1 Crítica" />
            <SelectItem value="P2" text="P2 Alta" />
            <SelectItem value="P3" text="P3 Média" />
            <SelectItem value="P4" text="P4 Baixa" />
          </Select>
        </HpsmFilterItem>
        <HpsmFilterItem label="ATT&CK" htmlFor="attack">
          <AttackFilterInput
            id="attack"
            value={attack}
            onChange={(value) => list.setFilter('attack', value)}
          />
        </HpsmFilterItem>
        <HpsmFilterItem label="Prazo" htmlFor="age">
          <Select
            id="age"
            labelText="Prazo"
            hideLabel
            size="sm"
            value={age}
            onChange={(e) => list.setFilter('age', e.target.value)}
          >
            <SelectItem value="" text="Todos" />
            <SelectItem value="warn" text="Em alerta ou atrasadas" />
            <SelectItem value="late" text="Atrasadas" />
          </Select>
        </HpsmFilterItem>
        {canTriage && (
          <HpsmFilterItem label="Responsável" htmlFor="assignee">
            <Select
              id="assignee"
              labelText="Responsável"
              hideLabel
              size="sm"
              value={assignee}
              onChange={(e) => list.setFilter('assignee', e.target.value)}
            >
              <SelectItem value="" text="Todos" />
              <SelectItem value="me" text="Atribuídas a mim" />
              <SelectItem value="none" text="Sem responsável" />
              {(analystsQuery.data?.analysts ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id} text={a.displayName} />
              ))}
            </Select>
          </HpsmFilterItem>
        )}
      </HpsmFilterBar>

      {query.isLoading && <HpsmLoading text="Carregando amostras..." />}
      {query.isError && (
        <HpsmMessage kind="error">Erro ao carregar: {(query.error as Error).message}</HpsmMessage>
      )}
      {/* Lista vazia: a grade continua visivel e o aviso vai para a barra de mensagens. */}
      {query.data && query.data.items.length === 0 && (
        <HpsmMessage kind="info">Nenhuma amostra encontrada.</HpsmMessage>
      )}
      {query.data && (
        <EntriesTable
          entries={query.data.items}
          sla={query.data.sla}
          total={query.data.total}
          offset={offset}
          pageSize={pageSize}
          sort={sort}
          onSortChange={list.setSort}
          onPageChange={list.setOffset}
          selectable={canTriage}
        />
      )}
    </>
  );
}
