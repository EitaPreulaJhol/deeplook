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
  TextInput,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { AdminBackupSchedule } from './AdminBackupSchedule';
import { useConfirm } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface Backup {
  id: string;
  status: 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  includeSamples: boolean;
  encrypted: boolean;
  /** Gerado pelo agendamento (item 6.13). */
  scheduled?: boolean;
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

const STATUS: Record<Backup['status'], { text: string; tone: 'blue' | 'green' | 'red' | 'gray' }> =
  {
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
    queryFn: () =>
      api.get<{
        items: Backup[];
        retentionDays: number;
        destination?: 'dir' | 'bucket';
        destinationProblem?: string | null;
      }>('/admin/backups'),
    // Acompanha o que esta em andamento.
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => b.status === 'RUNNING') ? 2000 : false,
  });
  const [withSamples, setWithSamples] = useState(false);
  const [noPassword, setNoPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
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

  const passwordProblem = noPassword
    ? null
    : password.length < 12
      ? 'A senha do ZIP precisa de 12 caracteres ou mais.'
      : password !== again
        ? 'As duas senhas não conferem.'
        : null;

  const generate = async () => {
    if (passwordProblem) {
      setNotice({ ok: false, text: passwordProblem });
      return;
    }
    const risks = [
      withSamples && 'O ZIP vai conter os arquivos enviados, ou seja, malware real.',
      noPassword &&
        'Sem senha, qualquer pessoa com o ZIP lê o banco, com hashes de senha e segredos de 2FA.',
    ].filter(Boolean);
    if (risks.length) {
      const ok = await confirm({
        title: 'Confirmar o backup',
        message: `${risks.join(' ')} Gerar assim mesmo?`,
        confirmLabel: 'Gerar',
        cancelLabel: 'Cancelar',
        danger: true,
      });
      if (!ok) return;
    }
    await run(async () => {
      await api.post(
        '/admin/backups',
        noPassword
          ? { includeSamples: withSamples, noPassword: true }
          : { includeSamples: withSamples, password },
      );
      setPassword('');
      setAgain('');
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
        <p className="dl-backup__intro">
          {query.data?.destination === 'dir'
            ? 'Gravado na pasta de backup do servidor (BACKUP_DIR), com um arquivo .sha256 ao lado para conferir a cópia.'
            : 'Guardado no MinIO, no mesmo disco dos dados: configure BACKUP_DIR no .env para gravar numa pasta fora dele.'}
        </p>
        {query.data?.destinationProblem && (
          <HpsmMessage kind="error">{query.data.destinationProblem}</HpsmMessage>
        )}
        <Checkbox
          id="backup-samples"
          labelText="Incluir os arquivos das amostras (o ZIP terá malware)"
          checked={withSamples}
          disabled={Boolean(running)}
          onChange={(_, { checked }) => setWithSamples(checked)}
        />
        <Checkbox
          id="backup-no-password"
          labelText="Exportar sem senha (qualquer pessoa com o ZIP lê o banco)"
          checked={noPassword}
          disabled={Boolean(running)}
          onChange={(_, { checked }) => setNoPassword(checked)}
        />
        {!noPassword && (
          <div className="dl-backup__password">
            <TextInput
              id="backup-password"
              type="password"
              labelText="Senha do ZIP"
              autoComplete="new-password"
              helperText="12 caracteres ou mais. Não fica guardada: sem ela, o backup não abre. Abra com o 7-Zip."
              value={password}
              disabled={Boolean(running)}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextInput
              id="backup-password-again"
              type="password"
              labelText="Repita a senha"
              autoComplete="new-password"
              value={again}
              disabled={Boolean(running)}
              onChange={(e) => setAgain(e.target.value)}
            />
          </div>
        )}
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

      <AdminBackupSchedule />

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
                    <TableCell>
                      {b.scheduled ? 'Agendado' : (b.createdBy?.displayName ?? '—')}
                    </TableCell>
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
                      <span className="dl-backup__counts">
                        {b.encrypted ? 'com senha' : 'sem senha'}
                      </span>
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
                        <a
                          className="dl-link"
                          href={`/api/admin/backups/${b.id}/download`}
                          download
                        >
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
