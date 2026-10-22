import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { StatusLevel, SystemStatus } from '../api/types';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconRefresh } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

/** Atualizacao automatica da pagina de status. */
const REFRESH_MS = 30_000;

const LEVELS: Record<StatusLevel, { tone: StatusTone; label: string }> = {
  ok: { tone: 'green', label: 'OK' },
  warn: { tone: 'orange', label: 'Alerta' },
  error: { tone: 'red', label: 'Falha' },
  off: { tone: 'gray', label: 'Desligado' },
};

/**
 * Aba "Status do sistema" da Administracao (System Status do HPSM): API,
 * banco, armazenamento, Proxmox e filas, com a situacao de cada um. Atualiza
 * sozinha a cada 30 s.
 */
export function AdminStatusTab() {
  const query = useQuery({
    queryKey: ['admin', 'status'],
    queryFn: () => api.get<SystemStatus>('/admin/status'),
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;

  return (
    <>
      <HpsmToolbar label="Ações do status">
        <HpsmToolbarButton
          label={query.isFetching ? 'Verificando...' : 'Atualizar'}
          icon={IconRefresh}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        />
        {data && (
          <span className="hpsm-toolbar__info">
            Verificado às {new Date(data.checkedAt).toLocaleTimeString('pt-BR')} · atualiza a cada
            30 s
          </span>
        )}
      </HpsmToolbar>

      {query.isLoading && <HpsmLoading text="Verificando os componentes..." />}
      {query.isError && (
        <HpsmMessage kind="error">
          Não foi possível obter o status: {(query.error as Error).message}
        </HpsmMessage>
      )}
      {data?.overall === 'error' && (
        <HpsmMessage kind="error">Há componentes com falha. Veja os detalhes abaixo.</HpsmMessage>
      )}
      {data?.overall === 'warn' && (
        <HpsmMessage kind="warning">Há componentes em alerta. Veja os detalhes abaixo.</HpsmMessage>
      )}

      {data && (
        <TableContainer>
          <Table size="xs" aria-label="Status do sistema">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Componente</TableHeader>
                <TableHeader scope="col">Situação</TableHeader>
                <TableHeader scope="col">Resumo</TableHeader>
                <TableHeader scope="col">Tempo</TableHeader>
                <TableHeader scope="col">Detalhes</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.checks.map((check) => (
                <TableRow key={check.id} className={`dl-status-row dl-status-row--${check.level}`}>
                  <TableCell>
                    <strong>{check.name}</strong>
                  </TableCell>
                  <TableCell>
                    <StatusText tone={LEVELS[check.level].tone}>
                      {LEVELS[check.level].label}
                    </StatusText>
                  </TableCell>
                  <TableCell>{check.summary}</TableCell>
                  <TableCell>
                    {check.latencyMs !== undefined ? `${check.latencyMs} ms` : '—'}
                  </TableCell>
                  <TableCell>
                    {check.details.length ? (
                      <span className="dl-status-details">
                        {check.details.map((d, i) => (
                          <span key={d.label}>
                            {i > 0 && ' · '}
                            <span className="dl-status-details__label">{d.label}:</span> {d.value}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
