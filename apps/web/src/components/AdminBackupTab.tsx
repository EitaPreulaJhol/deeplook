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
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/admin';
import { AdminBackupSchedule } from './AdminBackupSchedule';
import { useConfirm } from './HpsmConfirm';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconAdd } from './icons';
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
  localized(() => ({
    RUNNING: { text: t('bkRunning'), tone: 'blue' },
    READY: { text: t('bkReady'), tone: 'green' },
    FAILED: { text: t('bkFailed'), tone: 'red' },
    EXPIRED: { text: t('bkExpired'), tone: 'gray' },
  }));

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');

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
      ? t('zipPwdMin')
      : password !== again
        ? t('pwdMismatch')
        : null;

  const generate = async () => {
    if (passwordProblem) {
      setNotice({ ok: false, text: passwordProblem });
      return;
    }
    const risks = [withSamples && t('riskMalware'), noPassword && t('riskNoPwd')].filter(Boolean);
    if (risks.length) {
      const ok = await confirm({
        title: t('confirmBackup'),
        message: t('createAnyway', { risks: risks.join(' ') }),
        confirmLabel: t('create'),
        cancelLabel: t('cancel'),
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
      return t('backupStarted');
    });
  };

  const remove = async (b: Backup) => {
    const ok = await confirm({
      title: t('deleteBackup'),
      message: t('deleteBackupConfirm', { date: fmt(b.createdAt) }),
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.del(`/admin/backups/${b.id}`);
      return t('backupDeleted');
    });
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmSection title={t('createBackup')} className="dl-form-col">
        <HpsmToolbar label={t('backupActions')}>
          <HpsmToolbarButton
            label={t('createBackup')}
            icon={IconAdd}
            disabled={busy || Boolean(running)}
            onClick={() => void generate()}
          />
        </HpsmToolbar>
        <p className="dl-backup__intro">
          {t('backupIntro', { days: query.data?.retentionDays ?? 7 })}
        </p>
        <p className="dl-backup__intro">
          {query.data?.destination === 'dir' ? t('destDirInfo') : t('destMinioInfo')}
        </p>
        {query.data?.destinationProblem && (
          <HpsmMessage kind="error">{query.data.destinationProblem}</HpsmMessage>
        )}
        <HpsmForm>
          <HpsmField label={t('content')}>
            <Checkbox
              id="backup-samples"
              labelText={t('includeSamples')}
              checked={withSamples}
              disabled={Boolean(running)}
              onChange={(_, { checked }) => setWithSamples(checked)}
            />
          </HpsmField>
          <HpsmField label={t('protection')}>
            <Checkbox
              id="backup-no-password"
              labelText={t('noPassword')}
              checked={noPassword}
              disabled={Boolean(running)}
              onChange={(_, { checked }) => setNoPassword(checked)}
            />
          </HpsmField>
          {!noPassword && (
            <>
              <HpsmField
                label={t('zipPwd')}
                htmlFor="backup-password"
                required
                help={t('zipPwdHelp')}
              >
                <TextInput
                  id="backup-password"
                  type="password"
                  labelText={t('zipPwd')}
                  hideLabel
                  autoComplete="new-password"
                  value={password}
                  disabled={Boolean(running)}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </HpsmField>
              <HpsmField label={t('repeatPwd')} htmlFor="backup-password-again" required>
                <TextInput
                  id="backup-password-again"
                  type="password"
                  labelText={t('repeatPwd')}
                  hideLabel
                  autoComplete="new-password"
                  value={again}
                  disabled={Boolean(running)}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </HpsmField>
            </>
          )}
        </HpsmForm>
        {running && (
          <div className="dl-backup__running" role="status">
            <ProgressBar
              label={running.step ?? t('creating')}
              value={running.progress}
              max={100}
              helperText={`${running.progress}%`}
            />
          </div>
        )}
      </HpsmSection>

      <AdminBackupSchedule />

      <HpsmSection title={t('backupsN', { n: items.length })}>
        {query.isLoading && <HpsmLoading text={t('loadingBackups')} />}
        {!query.isLoading && items.length === 0 ? (
          <p className="dl-static-empty">{t('noBackups')}</p>
        ) : (
          <TableContainer>
            <Table size="xs" aria-label={t('backupsAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('createdAt')}</TableHeader>
                  <TableHeader scope="col">{t('by')}</TableHeader>
                  <TableHeader scope="col">{t('situation')}</TableHeader>
                  <TableHeader scope="col">{t('content')}</TableHeader>
                  <TableHeader scope="col">{t('size')}</TableHeader>
                  <TableHeader scope="col">{t('expiresOn')}</TableHeader>
                  <TableHeader scope="col">{t('actions')}</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id} className={b.status === 'EXPIRED' ? 'is-off' : undefined}>
                    <TableCell>{fmt(b.createdAt)}</TableCell>
                    <TableCell>
                      {b.scheduled ? t('scheduled') : (b.createdBy?.displayName ?? '—')}
                    </TableCell>
                    <TableCell>
                      <StatusText tone={STATUS[b.status].tone}>{STATUS[b.status].text}</StatusText>
                      {b.status === 'RUNNING' && ` (${b.progress}%)`}
                      {b.error && <span className="dl-backup__error">{b.error}</span>}
                    </TableCell>
                    <TableCell>
                      {b.includeSamples ? (
                        <StatusText tone="red">{t('withSamples')}</StatusText>
                      ) : (
                        t('withoutSamples')
                      )}
                      <span className="dl-backup__counts">
                        {b.encrypted ? t('withPwd') : t('withoutPwd')}
                      </span>
                      {b.manifest && (
                        <span className="dl-backup__counts">
                          {t('manifestCounts', {
                            entries: b.manifest.counts.entries,
                            reports: b.manifest.counts.reports,
                            objects: b.manifest.counts.objects,
                            version: b.manifest.version,
                          })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{b.size !== null ? formatFileSize(b.size) : '—'}</TableCell>
                    <TableCell>{b.status === 'READY' ? fmt(b.expiresAt) : '—'}</TableCell>
                    <TableCell>
                      {b.status === 'READY' && (
                        <a
                          className="dl-link-button"
                          href={`/api/admin/backups/${b.id}/download`}
                          download
                        >
                          {t('download')}
                        </a>
                      )}{' '}
                      {b.status !== 'RUNNING' && (
                        <button
                          type="button"
                          className="dl-link-button"
                          disabled={busy}
                          onClick={() => void remove(b)}
                        >
                          {t('delete')}
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
