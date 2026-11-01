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
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { IocDetail, IocSighting } from '../api/types';
import { CopyButton } from '../components/CopyButton';
import { saveEntrySequence } from '../components/entryNav';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconArrowLeft, IconBell } from '../components/icons';
import { IOC_KIND_LABELS, shortIoc } from '../components/iocs';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { useWorkspaceTitle } from '../components/workspace';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/** Onde o indicador aparece naquela amostra. */
function describe(sighting: IocSighting): string {
  switch (sighting.kind) {
    case 'REPORT':
      return `Relatório de ${sighting.analyst} (${fmtDate(sighting.createdAt)})`;
    case 'FILE':
      return 'É o arquivo da amostra (SHA-256)';
    case 'URL_HOST':
      return 'É o domínio da URL da amostra';
  }
}

/**
 * Ficha do indicador (/iocs/:kind/:value): em quais amostras ele aparece -
 * citado num relatorio publicado, como o proprio arquivo ou como o dominio da
 * URL -, com a primeira e a ultima aparicao. Aberta pelo "Ir para:" e pelos
 * links de IOCs da amostra.
 */
export function IocPage() {
  const { kind = '', value = '' } = useParams();
  const navigate = useNavigate();
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const query = useQuery({
    queryKey: ['ioc', kind, value],
    queryFn: () =>
      api.get<IocDetail>(`/iocs/${encodeURIComponent(kind)}/${encodeURIComponent(value)}`),
    retry: false,
  });
  useWorkspaceTitle(`IOC · ${shortIoc(value)}`);

  // Alertas de IOC: seguir avisa na Caixa de entrada quando o indicador aparecer de novo.
  const queryClient = useQueryClient();
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchNotice, setWatchNotice] = useState<string | null>(null);
  const watching = query.data?.watching ?? false;
  const toggleWatch = async () => {
    setWatchBusy(true);
    setWatchNotice(null);
    try {
      const path = `/iocs/${encodeURIComponent(kind)}/${encodeURIComponent(value)}/watch`;
      if (watching) await api.del(path);
      else await api.post(path, {});
      await queryClient.invalidateQueries({ queryKey: ['ioc', kind, value] });
      await queryClient.invalidateQueries({ queryKey: ['me', 'watches'] });
      setWatchNotice(
        watching
          ? 'Você deixou de seguir este indicador.'
          : 'Seguindo: você será avisado quando ele aparecer numa amostra nova ou num relatório.',
      );
    } catch (err) {
      setWatchNotice((err as Error).message);
    } finally {
      setWatchBusy(false);
    }
  };

  const toolbar = (
    <HpsmToolbar label="Ações do indicador">
      <HpsmToolbarButton label="Voltar" icon={IconArrowLeft} onClick={() => navigate(-1)} />
      {query.data && (
        <HpsmToolbarButton
          label={watching ? 'Deixar de seguir' : 'Seguir'}
          icon={IconBell}
          pressed={watching}
          disabled={watchBusy}
          title={
            watching
              ? 'Parar de receber avisos deste indicador'
              : 'Avisar na Caixa de entrada quando este indicador aparecer de novo'
          }
          onClick={() => void toggleWatch()}
        />
      )}
    </HpsmToolbar>
  );

  if (query.isLoading) return <HpsmLoading text="Procurando o indicador..." />;
  if (query.isError || !query.data) {
    return (
      <>
        {toolbar}
        <HpsmMessage kind="error">
          Indicador inválido: {(query.error as Error | null)?.message ?? value}
        </HpsmMessage>
      </>
    );
  }

  const { ioc, items, total, firstSeen, lastSeen } = query.data;
  const open = (id: string) => {
    saveEntrySequence(items.map((item) => item.entry.id));
    navigate(`/entries/${id}`);
  };
  const onRowKeyDown = (event: KeyboardEvent, index: number, id: string) => {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : null;
    if (target !== null) {
      event.preventDefault();
      rowRefs.current[target]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(id);
    }
  };

  return (
    <>
      {toolbar}
      {watchNotice && (
        <HpsmMessage key={watchNotice} kind="success">
          {watchNotice}
        </HpsmMessage>
      )}
      <PageHeader
        title={`${IOC_KIND_LABELS[ioc.kind]}: ${ioc.value}`}
        subtitle="Ficha do indicador: amostras e relatórios publicados em que ele aparece."
      />
      {query.data?.allowed && (
        <HpsmMessage kind="info">
          Indicador permitido
          {query.data.allowed.by !== ioc.value
            ? ` (coberto por ${query.data.allowed.by})`
            : ''}: {query.data.allowed.reason}. Não liga amostras nas Relacionadas nem gera alertas.
        </HpsmMessage>
      )}
      <div className="dl-summary dl-mb-lg">
        <span>
          <span className="dl-summary__label">Tipo:</span> {IOC_KIND_LABELS[ioc.kind]}
        </span>
        <span className="dl-ioc-value">
          <span className="dl-summary__label">Valor:</span>{' '}
          <span className="dl-mono">{ioc.value}</span>
          <CopyButton value={ioc.value} label="indicador" />
        </span>
        <span>
          <span className="dl-summary__label">Primeira aparição:</span> {fmtDate(firstSeen)}
        </span>
        <span>
          <span className="dl-summary__label">Última aparição:</span> {fmtDate(lastSeen)}
        </span>
        <span>
          <span className="dl-summary__label">Amostras:</span> {total}
        </span>
      </div>

      {items.length === 0 ? (
        <HpsmMessage kind="info">
          Este indicador ainda não apareceu em nenhuma amostra nem em relatório publicado.
        </HpsmMessage>
      ) : (
        <TableContainer>
          <Table size="xs" aria-label="Amostras com o indicador (setas navegam, Enter abre)">
            <TableHead>
              <TableRow>
                <TableHeader scope="col">Amostra</TableHeader>
                <TableHeader scope="col">Tipo</TableHeader>
                <TableHeader scope="col">Status</TableHeader>
                <TableHeader scope="col">Veredito</TableHeader>
                <TableHeader scope="col">Onde aparece</TableHeader>
                <TableHeader scope="col">Enviada em</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map(({ entry, sightings }, index) => (
                <TableRow
                  key={entry.id}
                  ref={(el: HTMLTableRowElement | null) => {
                    rowRefs.current[index] = el;
                  }}
                  className="hpsm-grid-row"
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={() => open(entry.id)}
                  onKeyDown={(event: KeyboardEvent) => onRowKeyDown(event, index, entry.id)}
                >
                  <TableCell>
                    <span className="dl-cell-text" title={entry.title}>
                      {entry.title}
                    </span>
                  </TableCell>
                  <TableCell>
                    <TypeTag type={entry.type} />
                  </TableCell>
                  <TableCell>
                    <StatusTag status={entry.status} />
                  </TableCell>
                  <TableCell>
                    <VerdictTag verdict={entry.verdict} />
                  </TableCell>
                  <TableCell>
                    <ul className="dl-related-reasons">
                      {sightings.map((s, i) => (
                        <li key={i}>{describe(s)}</li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>{fmtDate(entry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
