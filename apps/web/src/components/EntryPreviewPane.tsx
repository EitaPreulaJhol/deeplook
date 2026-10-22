import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconPage } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusTag, TypeTag, VerdictTag } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Painel de detalhe abaixo da lista (preferencia "Painel de detalhe"): resumo da
 * amostra selecionada sem sair da lista, como no HPSM. Usa o mesmo queryKey da
 * ficha da amostra, entao abrir a ficha depois nao repete a requisicao.
 */
export function EntryPreviewPane({ entryId, onOpen }: { entryId: string; onOpen: () => void }) {
  const query = useQuery({
    queryKey: ['entry', entryId],
    queryFn: () => api.get<{ entry: Entry }>(`/entries/${entryId}`),
  });
  const entry = query.data?.entry;
  const lastReport = entry?.reports?.find((r) => r.status === 'PUBLISHED');

  return (
    <HpsmSection
      title={entry ? `Resumo: ${entry.title}` : 'Resumo da amostra'}
      className="dl-preview"
    >
      <HpsmToolbar label="Ações do resumo">
        <HpsmToolbarButton
          label="Abrir amostra"
          icon={IconPage}
          title="Abrir a ficha completa (Enter ou duplo clique na linha)"
          onClick={onOpen}
        />
      </HpsmToolbar>
      {query.isLoading && <HpsmLoading text="Carregando resumo..." />}
      {query.isError && (
        <HpsmMessage kind="error">Erro ao carregar o resumo da amostra.</HpsmMessage>
      )}
      {entry && (
        <HpsmForm columns={2}>
          <HpsmField label="Tipo">
            <HpsmReadonly>
              <TypeTag type={entry.type} />
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Enviado por">
            <HpsmReadonly>
              {entry.owner.displayName} · {fmtDate(entry.createdAt)}
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Status">
            <HpsmReadonly>
              <StatusTag status={entry.status} />
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Veredito">
            <HpsmReadonly>
              <VerdictTag verdict={entry.verdict} />
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label="Responsável">
            <HpsmReadonly>{entry.assignee?.displayName ?? '—'}</HpsmReadonly>
          </HpsmField>
          <HpsmField label="Tags">
            <HpsmReadonly>{entry.tags.map((t) => t.name).join(', ') || '—'}</HpsmReadonly>
          </HpsmField>
          {entry.type === 'FILE' ? (
            <HpsmField label="SHA-256" wide>
              <HpsmReadonly
                mono
                copyable={entry.sha256 ? { value: entry.sha256, label: 'SHA-256' } : undefined}
              >
                {entry.sha256 || '—'}
              </HpsmReadonly>
            </HpsmField>
          ) : (
            <HpsmField label="URL" wide>
              <HpsmReadonly
                mono
                copyable={entry.url ? { value: entry.url, label: 'URL' } : undefined}
              >
                {entry.url}
              </HpsmReadonly>
            </HpsmField>
          )}
          <HpsmField label="Último relatório" wide top>
            <HpsmReadonly multiline>
              {lastReport
                ? `${lastReport.analyst.displayName} · ${fmtDate(lastReport.createdAt)}\n${lastReport.summary}`
                : 'Nenhum relatório publicado.'}
            </HpsmReadonly>
          </HpsmField>
        </HpsmForm>
      )}
    </HpsmSection>
  );
}
