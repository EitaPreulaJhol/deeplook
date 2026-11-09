import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { UnpackInfo } from '../api/types';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText, VerdictTag } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

/** Desempacotamento da amostra; atualiza a cada 5 s enquanto esta na fila ou trabalhando. */
export function useUnpack(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['unpack', entryId],
    queryFn: () => api.get<UnpackInfo>(`/entries/${entryId}/unpack`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(job: NonNullable<UnpackInfo['job']>): { tone: StatusTone; text: string } {
  if (job.status === 'PENDING') return { tone: 'blue', text: 'Na fila' };
  if (job.status === 'RUNNING')
    return { tone: 'blue', text: `Desempacotando desde ${fmtDate(job.startedAt)}` };
  if (job.status === 'FAILED')
    return { tone: 'orange', text: `Falhou: ${job.error ?? 'erro desconhecido'}` };
  const made = (job.files ?? []).filter((f) => f.entryId).length;
  if (!job.unpacker) return { tone: 'none', text: 'Nenhum desempacotador reconheceu o arquivo' };
  return {
    tone: made ? 'green' : 'none',
    text: `${made} arquivo(s) extraído(s) em ${fmtDate(job.finishedAt)}`,
  };
}

/**
 * Secao "Desempacotamento" da aba Detalhes (item 7.8): o que saiu do executavel (UPX, instalador,
 * PyInstaller, arquivo embutido), cada arquivo como amostra filha. Roda sozinho na chegada quando
 * o executavel parece empacotado; analistas pedem quando nao rodou.
 */
export function UnpackSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useUnpack(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.applicable && !info.job)) return null;
  const job = info.job;
  const files = job?.files ?? [];
  const extracted = files.some((f) => f.entryId);

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/unpack`, {});
      await queryClient.invalidateQueries({ queryKey: ['unpack', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = job?.status === 'PENDING' || job?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && !busy && !extracted ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? 'Pedindo...' : job ? 'Tentar de novo' : 'Desempacotar'}
      </button>
    ) : null;

  if (!job) {
    return (
      <HpsmSection title="Desempacotamento">
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled
            ? 'Não parecia empacotado nem instalador na chegada.'
            : 'O desempacotamento está desligado (UNPACK_URL vazio).'}{' '}
          {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(job);
  const titles = new Map(info.children.map((c) => [c.id, c]));
  return (
    <HpsmSection title="Desempacotamento">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField
          label="Situação"
          help="UPX, instaladores (NSIS e Inno Setup até a 6.2), PyInstaller e arquivos compactados embutidos. Só lê e extrai; nada é executado."
        >
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Desempacotador">
          <HpsmReadonly>
            {job.label ?? '—'}
            {job.note && ` · ${job.note}`}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
      {files.length > 0 && (
        <ul className="dl-unpack-files">
          {files.map((f, i) => {
            const child = f.entryId ? titles.get(f.entryId) : undefined;
            return (
              <li key={`${f.name}-${i}`}>
                {child ? (
                  <>
                    <Link className="dl-link" to={`/entries/${child.id}`}>
                      {child.title}
                    </Link>{' '}
                    <VerdictTag verdict={child.verdict} />
                  </>
                ) : (
                  <code>{f.name}</code>
                )}
                <span className="dl-hint-muted">
                  {' '}
                  · {formatFileSize(f.size)}
                  {f.skipped && ` · ficou de fora: ${f.skipped}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </HpsmSection>
  );
}
