import {
  Checkbox,
  ProgressBar,
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
import { useConfirm } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface Backup {
  id: string;
  status: 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  includeSamples: boolean;
  step: string | null;
  progress: number;
  size: number | null;
  manifest: {
    version: string;
    containsMalware: boolean;
    fileCount: number;
    counts: { entries: number; reports: number; users: number; cases: number; objects: number };
  } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  createdBy: { id: string; displayName: string } | null;
}

const STATUS: Record<Backup['status'], { text: string; tone: 'blue' | 'green' | 'red' | 'gray' }> = {
  RUNNING: { text: 'Gerando', tone: 'blue' },
  READY: { text: 'Pronto', tone: 'green' },
  FAILED: { text: 'Falhou', tone: 'red' },
  EXPIRED: { text: 'Vencido', tone: 'gray' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

/**
 * Backup em ZIP para baixar (item 81): gerar (um por vez, em segundo plano),
 * acompanhar a etapa, baixar e excluir. Com as amostras, o ZIP tem malware.
 */
export function AdminBackupTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api.get<{ items: Backup[]; retentionDays: number }>('/admin/backups'),
    // Acompanha o que esta em andamento.
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'RUNNING') ? 2000 : false),
  });
  const [withSamples, setWithSamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const items = query.data?.items ?? [];
  const running = items.find((b) => b.status === 'RUNNING');

  const run = async (fn: () => Promise<string>) => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await fn();
      await queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] });
      setNotice({ ok: true, text });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (withSamples) {
      const ok = await confirm({
        title: 'Backup com as amostras',
        message:
          'O ZIP vai conter os arquivos enviados, ou seja, malware real. Guarde-o como as amostras e não abra os arquivos. Gerar assim mesmo?',
        confirmLabel: 'Gerar com as amostras',
        cancelLabel: 'Cancelar',
        danger: true,
      });
      if (!ok) return;
    }
    await run(async () => {
      await api.post('/admin/backups', { includeSamples: withSamples });
      return 'Backup iniciado. Acompanhe abaixo; "Baixar" aparece quando terminar.';
    });
  };

  const remove = async (b: Backup) => {
    const ok = await confirm({
      title: 'Excluir backup',
      message: `Excluir o backup de ${fmt(b.createdAt)}? O ZIP sai do servidor.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/admin/backups/${b.id}`);
      return 'Backup excluído.';
    });
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmSection title="Gerar backup">
        <p className="dl-backup__intro">
          Um ZIP com o banco (pg_dump), as evidências e capturas do MinIO e um manifesto com o
          SHA-256 de cada parte. Fica disponível por {query.data?.retentionDays ?? 7} dias. A
          restauração está no LEIA-ME dentro do ZIP e no README.
        </p>
        <Checkbox
          id="backup-samples"
          labelText="Incluir os arquivos das amostras (o ZIP terá malware)"
          checked={withSamples}
          disabled={Boolean(running)}
          onChange={(_, { checked }) => setWithSamples(checked)}
        />
        <button
          type="button"
          className="dl-btn dl-btn--primary"
          disabled={busy || Boolean(running)}
          onClick={() => void generate()}
        >
          Gerar backup
        </button>
        {running && (
          <div className="dl-backup__running" role="status">
            <ProgressBar
              label={running.step ?? 'Gerando...'}
              value={running.progress}
              max={100}
              helperText={`${running.progress}%`}
            />
          </div>
        )}
      </HpsmSection>

      <HpsmSection title={`Backups (${items.length})`} className="dl-mt-lg">
        {query.isLoading && <HpsmLoading text="Carregando backups..." />}
        {!query.isLoading && items.length === 0 ? (
          <p className="dl-static-empty">Nenhum backup gerado ainda.</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label="Backups">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Gerado em</TableHeader>
                  <TableHeader scope="col">Por</TableHeader>
                  <TableHeader scope="col">Situação</TableHeader>
                  <TableHeader scope="col">Conteúdo</TableHeader>
                  <TableHeader scope="col">Tamanho</TableHeader>
                  <TableHeader scope="col">Vence em</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id} className={b.status === 'EXPIRED' ? 'is-off' : undefined}>
                    <TableCell>{fmt(b.createdAt)}</TableCell>
                    <TableCell>{b.createdBy?.displayName ?? '—'}</TableCell>
                    <TableCell>
                      <StatusText tone={STATUS[b.status].tone}>{STATUS[b.status].text}</StatusText>
                      {b.status === 'RUNNING' && ` (${b.progress}%)`}
                      {b.error && <span className="dl-backup__error">{b.error}</span>}
                    </TableCell>
                    <TableCell>
                      {b.includeSamples ? (
                        <StatusText tone="red">com as amostras (malware)</StatusText>
                      ) : (
                        'sem as amostras'
                      )}
                      {b.manifest && (
                        <span className="dl-backup__counts">
                          {b.manifest.counts.entries} amostra(s), {b.manifest.counts.reports}{' '}
                          relatório(s), {b.manifest.counts.objects} arquivo(s) · versão{' '}
                          {b.manifest.version}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{b.size !== null ? formatFileSize(b.size) : '—'}</TableCell>
                    <TableCell>{b.status === 'READY' ? fmt(b.expiresAt) : '—'}</TableCell>
                    <TableCell>
                      {b.status === 'READY' && (
                        <a className="dl-link" href={`/api/admin/backups/${b.id}/download`} download>
                          Baixar
                        </a>
                      )}{' '}
                      {b.status !== 'RUNNING' && (
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void remove(b)}
                        >
                          Excluir
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
