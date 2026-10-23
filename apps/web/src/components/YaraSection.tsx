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
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { YaraInfo, YaraScan } from '../api/types';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

/** Situacao da varredura YARA: escaneando, sem acertos, N regra(s) ou falha. */
export function yaraState(scan: YaraScan): { label: string; tone: StatusTone } {
  if (scan.status === 'PENDING') return { label: 'Escaneando...', tone: 'blue' };
  if (scan.status === 'CLEAN') return { label: 'Nenhuma regra casou', tone: 'green' };
  if (scan.status === 'MATCHED') {
    const n = scan.matches.length;
    return { label: `${n} regra${n > 1 ? 's casaram' : ' casou'}`, tone: 'red' };
  }
  return { label: `Falha: ${scan.error ?? 'erro desconhecido'}`, tone: 'orange' };
}

/**
 * Ultima varredura YARA (GET /api/entries/:id/yara). Atualiza a cada 2,5 s
 * enquanto escaneia; o resumo do topo e a secao dividem a consulta.
 */
export function useYara(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['yara', entryId],
    queryFn: () => api.get<YaraInfo>(`/entries/${entryId}/yara`),
    enabled,
    staleTime: 2000,
    refetchInterval: (q) => (q.state.data?.pending ? 2500 : false),
  });
}

/**
 * Secao "Regras YARA" da aba Detalhes (item 56; so arquivos). Escondida
 * enquanto nao ha regra ativa nem varredura antiga.
 */
export function YaraSection({
  entryId,
  canTriage,
  purged,
}: {
  entryId: string;
  canTriage: boolean;
  purged: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useYara(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (info.activeRules === 0 && !info.scan)) return null;
  const scan = info.scan;

  const rescan = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/yara`, {});
      await queryClient.invalidateQueries({ queryKey: ['yara', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const busy = info.pending;
  const state = scan
    ? yaraState(scan)
    : busy
      ? { label: 'Na fila...', tone: 'blue' as const }
      : { label: 'Não escaneado (enviado antes das regras)', tone: 'gray' as const };
  const hits = scan?.status === 'MATCHED' ? scan.matches : [];
  return (
    <HpsmSection title="Regras YARA">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label="Situação" wide>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.label}</StatusText>
            {canTriage && !purged && info.activeRules > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={asking || busy}
                  onClick={() => void rescan()}
                >
                  {busy ? 'Escaneando...' : scan ? 'Escanear de novo' : 'Escanear agora'}
                </button>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Conjuntos aplicados">
          <HpsmReadonly>
            {scan && !busy ? scan.rulesCount : '—'}
            {canTriage && (
              <>
                {' '}
                <Link className="dl-link" to="/yara">
                  Ver regras
                </Link>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Escaneado em">
          <HpsmReadonly>{scan && !busy ? fmtDate(scan.scannedAt) : '—'}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>
      {hits.length > 0 && (
        <TableContainer>
          <Table size="xs" aria-label="Regras YARA que casaram">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Regra</TableHeader>
                <TableHeader scope="col">Conjunto</TableHeader>
                <TableHeader scope="col">Tags</TableHeader>
                <TableHeader scope="col">Descrição</TableHeader>
                <TableHeader scope="col">Ocorrências</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {hits.map((hit) => (
                <TableRow key={`${hit.rule}:${hit.identifier}`}>
                  <TableCell>
                    <span className="dl-mono">{hit.identifier}</span>
                  </TableCell>
                  <TableCell>{hit.rule}</TableCell>
                  <TableCell>{hit.tags.length ? hit.tags.join(', ') : '—'}</TableCell>
                  <TableCell>{hit.description ?? '—'}</TableCell>
                  <TableCell>{hit.matches}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </HpsmSection>
  );
}
