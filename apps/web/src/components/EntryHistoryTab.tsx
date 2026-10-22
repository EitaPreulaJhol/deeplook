import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { EntryEvent, EntryStatus, Verdict } from '../api/types';
import { HpsmField, HpsmForm, HpsmSection, useRequiredFields } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { useSaveShortcut } from './shortcuts';
import { statusLabel, verdictLabel } from './tags';
import { useUnsavedChanges } from './useUnsavedChanges';

/** Tamanho maximo de uma atualizacao (mesmo limite da API). */
const COMMENT_MAX = 4000;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

const SANDBOX_CLOSE_REASONS: Record<string, string> = {
  descartado: 'descartado',
  expirado: 'expirou',
};

/** Descricao legivel de um evento do historico. */
function describe(event: EntryEvent): string {
  const from = event.fromValue;
  const to = event.toValue;
  switch (event.type) {
    case 'CREATED':
      return 'Amostra enviada';
    case 'STATUS_CHANGED':
      return `Status: ${statusLabel(from as EntryStatus)} → ${statusLabel(to as EntryStatus)}`;
    case 'VERDICT_CHANGED':
      return `Veredito: ${verdictLabel(from as Verdict)} → ${verdictLabel(to as Verdict)}`;
    case 'ASSIGNED':
      return `Responsável: ${from ?? '—'} → ${to ?? '—'}`;
    case 'REPORT_CREATED':
      return `Relatório salvo como rascunho (veredito ${verdictLabel(to as Verdict)})`;
    case 'REPORT_PUBLISHED':
      return `Relatório publicado (veredito ${verdictLabel(to as Verdict)})`;
    case 'SANDBOX_OPENED':
      return 'Ambiente isolado aberto';
    case 'SANDBOX_CLOSED':
      return `Ambiente isolado encerrado${
        event.detail ? ` (${SANDBOX_CLOSE_REASONS[event.detail] ?? event.detail})` : ''
      }`;
    case 'SANDBOX_FAILED':
      return `Falha ao preparar o ambiente isolado${event.detail ? `: ${event.detail}` : ''}`;
    case 'COMMENT':
      return 'Atualização';
    default:
      return event.type;
  }
}

/**
 * Aba "Historico": nova atualizacao (comentario livre, visivel para todos) e a
 * linha do tempo da amostra (quem fez o que e quando), com filtro para ver so
 * as atualizacoes.
 */
export function EntryHistoryTab({ entryId }: { entryId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['entry', entryId, 'events'];
  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ events: EntryEvent[] }>(`/entries/${entryId}/events`),
  });

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [onlyComments, setOnlyComments] = useState(false);
  // Texto digitado e nao salvo: sair da aba/tela pede confirmacao.
  useUnsavedChanges(text.trim().length > 0);
  const check = useRequiredFields([
    { id: 'comment-text', label: 'Atualização', ok: text.trim().length > 0 },
  ]);

  const addComment = async () => {
    setResult(null);
    if (!check.check()) return;
    setSaving(true);
    try {
      await api.post(`/entries/${entryId}/comments`, { text });
      setText('');
      check.reset();
      setResult({ ok: true, text: 'Atualização registrada no histórico.' });
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S adiciona a atualizacao.
  useSaveShortcut(addComment, !saving);

  const events = query.data?.events ?? [];
  const comments = events.filter((e) => e.type === 'COMMENT');
  const shown = onlyComments ? comments : events;

  return (
    <>
      <HpsmSection title="Nova atualização">
        <HpsmToolbar label="Ações da atualização">
          <HpsmToolbarButton
            label={saving ? 'Salvando...' : 'Adicionar atualização'}
            title="Adicionar ao histórico (Ctrl+S)"
            icon={IconAdd}
            disabled={saving}
            onClick={addComment}
          />
        </HpsmToolbar>
        {result && (
          <HpsmMessage key={result.text} kind={result.ok ? 'success' : 'error'}>
            {result.text}
          </HpsmMessage>
        )}
        {check.message && <HpsmMessage kind="error">{check.message}</HpsmMessage>}
        <HpsmForm>
          <HpsmField
            label="Atualização"
            htmlFor="comment-text"
            required
            wide
            top
            invalid={check.isInvalid('comment-text')}
            help={`Texto livre, visível para todos que acessam a amostra (${text.length}/${COMMENT_MAX}).`}
          >
            <TextArea
              id="comment-text"
              labelText="Atualização"
              hideLabel
              rows={3}
              maxLength={COMMENT_MAX}
              placeholder="Ex.: pedi mais informações ao remetente."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </HpsmField>
        </HpsmForm>
      </HpsmSection>

      {query.isLoading && <HpsmLoading text="Carregando histórico..." />}
      {query.isError && (
        <HpsmMessage kind="error">
          Erro ao carregar o histórico: {(query.error as Error).message}
        </HpsmMessage>
      )}
      {query.data && events.length === 0 && (
        <HpsmMessage kind="info">Nenhum evento registrado para esta amostra.</HpsmMessage>
      )}
      {events.length > 0 && (
        <>
          <div className="dl-history-filter">
            <Checkbox
              id="history-only-comments"
              labelText={`Somente atualizações (${comments.length})`}
              checked={onlyComments}
              onChange={(_, { checked }) => setOnlyComments(checked)}
            />
          </div>
          {shown.length === 0 ? (
            <p className="dl-history-empty">Nenhuma atualização registrada ainda.</p>
          ) : (
            <HistoryTable events={shown} />
          )}
        </>
      )}
    </>
  );
}

function HistoryTable({ events }: { events: EntryEvent[] }) {
  return (
    <TableContainer>
      <Table size="xs" aria-label="Histórico da amostra">
        <TableHead>
          <TableRow>
            <TableHeader scope="col">Data</TableHeader>
            <TableHeader scope="col">Usuário</TableHeader>
            <TableHeader scope="col">Evento</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((event) => (
            <TableRow
              key={event.id}
              className={event.type === 'COMMENT' ? 'dl-history-comment' : undefined}
            >
              <TableCell>{fmtDate(event.createdAt)}</TableCell>
              <TableCell>{event.actor?.displayName ?? 'Sistema'}</TableCell>
              <TableCell>
                {event.type === 'COMMENT' ? (
                  <>
                    <strong>{describe(event)}:</strong>
                    {/* Texto puro: o React escapa; quebras de linha preservadas no CSS. */}
                    <div className="dl-history-comment__text">{event.detail}</div>
                  </>
                ) : (
                  describe(event)
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
