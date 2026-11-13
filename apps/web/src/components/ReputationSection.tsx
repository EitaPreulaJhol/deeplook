import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { ReputationInfo, ReputationResult } from '../api/types';
import { HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText, verdictLabel } from './tags';

const VERDICT_TONE: Record<string, StatusTone> = {
  MALICIOUS: 'red',
  SUSPICIOUS: 'orange',
  CLEAN: 'green',
  UNKNOWN: 'gray',
};

const KIND_LABEL = { HASH: 'SHA-256', DOMAIN: 'Domínio', IP: 'IP' } as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Resultado de um servico: consultando, falha, nao encontrado ou o veredito dele. */
function resultLabel(r: ReputationResult): { label: string; tone: StatusTone } {
  if (r.status === 'PENDING') return { label: 'Consultando...', tone: 'blue' };
  if (r.status === 'ERROR') return { label: 'Falha', tone: 'orange' };
  if (r.status === 'NOT_FOUND') return { label: 'Não encontrado', tone: 'gray' };
  // Registro, certificados e DNS passivo encontram dados, mas nao dao veredito.
  if (r.verdict === 'UNKNOWN') return { label: 'Informativo', tone: 'gray' };
  return { label: verdictLabel(r.verdict), tone: VERDICT_TONE[r.verdict] ?? 'gray' };
}

/**
 * Reputacao da amostra (GET /api/entries/:id/reputation). Enquanto a consulta
 * do envio nao termina, atualiza a cada 2,5 s. Compartilhada pela secao e pelo
 * resumo do topo da ficha (mesmo queryKey).
 */
export function useReputation(entryId: string) {
  return useQuery({
    queryKey: ['reputation', entryId],
    queryFn: () => api.get<ReputationInfo>(`/entries/${entryId}/reputation`),
    // O resumo do topo e a secao montam em momentos diferentes: sem isso a
    // secao buscaria de novo o que o topo acabou de trazer.
    staleTime: 2000,
    refetchInterval: (q) => (q.state.data?.pending ? 2500 : false),
  });
}

/** Resumo para o topo da ficha: "malicioso em 2 de 3 serviços", "sem alertas"... */
export function reputationSummary(
  info?: ReputationInfo,
): { text: string; tone: StatusTone } | null {
  if (!info || info.services.length === 0 || !info.indicator) return null;
  if (info.pending) return { text: 'consultando...', tone: 'blue' };
  const answered = info.results.filter((r) => r.status === 'FOUND' || r.status === 'NOT_FOUND');
  for (const verdict of ['MALICIOUS', 'SUSPICIOUS'] as const) {
    const hits = info.results.filter((r) => r.status === 'FOUND' && r.verdict === verdict).length;
    if (hits) {
      return {
        text: `${verdictLabel(verdict).toLowerCase()} em ${hits} de ${info.results.length} serviço${info.results.length === 1 ? '' : 's'}`,
        tone: VERDICT_TONE[verdict],
      };
    }
  }
  if (answered.length === 0) return { text: 'sem resposta dos serviços', tone: 'gray' };
  const failed = info.results.filter((r) => r.status === 'ERROR').length;
  const counts = `${answered.length} serviço${answered.length === 1 ? '' : 's'}${failed ? ` · ${failed} com falha` : ''}`;
  return { text: `sem alertas (${counts})`, tone: failed ? 'orange' : 'green' };
}

/** Secao "Reputacao externa" da aba Detalhes (escondida sem servico configurado). */
export function ReputationSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useReputation(entryId);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || info.services.length === 0 || !info.indicator) return null;

  const recheck = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/reputation`, {});
      await queryClient.invalidateQueries({ queryKey: ['reputation', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <HpsmSection title="Reputação externa">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <p className="dl-reputation__note">
        Consultado: {KIND_LABEL[info.indicator.kind]}{' '}
        <span className="dl-mono">{info.indicator.value}</span>. Só o indicador sai do DeepLook; o
        arquivo e a URL completa não são enviados.
        {canTriage && (
          <>
            {' '}
            <button
              type="button"
              className="dl-link-button"
              disabled={asking || info.pending}
              onClick={() => void recheck()}
            >
              {info.pending ? 'Consultando...' : 'Consultar de novo'}
            </button>
          </>
        )}
      </p>
      {info.results.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label="Reputação externa">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Serviço</TableHeader>
                <TableHeader scope="col">Resultado</TableHeader>
                <TableHeader scope="col">Resumo</TableHeader>
                <TableHeader scope="col">Consultado em</TableHeader>
                <TableHeader scope="col">Detalhes</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {info.results.map((r) => {
                const res = resultLabel(r);
                return (
                  <TableRow key={r.service}>
                    <TableCell>
                      <strong>{r.name}</strong>
                    </TableCell>
                    <TableCell>
                      <StatusText tone={res.tone}>{res.label}</StatusText>
                    </TableCell>
                    <TableCell>{r.summary}</TableCell>
                    <TableCell className="dl-audit__date">
                      {r.status === 'PENDING' ? '—' : fmtDate(r.checkedAt)}
                    </TableCell>
                    <TableCell>
                      {r.link ? (
                        <a
                          className="dl-link"
                          href={r.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir no {r.name} ↗
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </HpsmSection>
  );
}
