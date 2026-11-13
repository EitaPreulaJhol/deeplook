import { Checkbox } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/admin';
import { useConfirm } from './HpsmConfirm';
import { HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import { StatusText } from './tags';

interface Summary {
  added: number;
  changed: number;
  removed: number;
  kept: number;
}

interface Release {
  id: string;
  pack: string;
  commit: string;
  commitDate: string;
  status: 'APPLIED' | 'HELD' | 'ROLLED_BACK' | 'DISMISSED';
  summary: Summary;
  reasons: string[] | null;
  canRollback: boolean;
  createdAt: string;
}

interface UpdateStatus {
  autoUpdate: boolean;
  packs: {
    id: string;
    name: string;
    commit: string;
    commitDate: string;
    lastCheck: string | null;
    lastError: string | null;
  }[];
  releases: Release[];
}

type CheckResult =
  | { outcome: 'current' }
  | { outcome: 'skipped' }
  | { outcome: 'preview'; commit: string; summary: Summary }
  | { outcome: 'applied'; commit: string; summary: Summary }
  | { outcome: 'held'; commit: string; reasons: string[]; summary: Summary };

const STATUS = localized(
  () =>
    ({
      APPLIED: { label: t('upApplied'), tone: 'green' },
      HELD: { label: t('upHeld'), tone: 'orange' },
      ROLLED_BACK: { label: t('upRolledBack'), tone: 'gray' },
      DISMISSED: { label: t('upDismissed'), tone: 'gray' },
    }) as const,
);

const changes = (s: Summary) =>
  t('changesSummary', { added: s.added, changed: s.changed, removed: s.removed }) +
  (s.kept ? `, ${t('keptOut', { n: s.kept })}` : '');

/**
 * Atualizacao automatica dos pacotes de regras (item 150): o que passa nos filtros
 * entra sozinho; o que nao passa fica retido aqui, ate aprovar ou descartar.
 */
export function AdminYaraUpdates() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['admin', 'yara-updates'],
    queryFn: () => api.get<UpdateStatus>('/admin/yara-packs/updates'),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'yara-updates'] }),
      queryClient.invalidateQueries({ queryKey: ['yara-packs'] }),
      queryClient.invalidateQueries({ queryKey: ['yara-pack-rules'] }),
    ]);
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await action();
      setNotice({ ok: true, text });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const setAuto = (autoUpdate: boolean) =>
    run(async () => {
      await api.patch('/admin/yara-packs/updates', { autoUpdate });
      return autoUpdate ? t('autoOn') : t('autoOff');
    });

  const check = (id: string, name: string) =>
    run(async () => {
      const res = await api.post<CheckResult>(`/admin/yara-packs/${id}/check`, { apply: false });
      if (res.outcome === 'current') return t('upToDate', { name });
      if (res.outcome === 'skipped') {
        return t('skippedVersion', { name });
      }
      if (res.outcome === 'held') return t('heldVersion', { name });
      if (res.outcome === 'applied') return t('updated', { name, changes: changes(res.summary) });
      const ok = await confirm({
        title: t('updateTitle', { name }),
        message: t('passedFilters', { changes: changes(res.summary) }),
        confirmLabel: t('apply'),
        cancelLabel: t('notNow'),
      });
      if (!ok) return t('nothingChanged', { name, changes: changes(res.summary) });
      await api.post(`/admin/yara-packs/${id}/check`, { apply: true });
      return t('updated', { name, changes: changes(res.summary) });
    });

  const act = async (
    release: Release,
    action: 'approve' | 'dismiss' | 'rollback',
    title: string,
    message: string,
    confirmLabel: string,
    done: string,
  ) => {
    const ok = await confirm({ title, message, confirmLabel, cancelLabel: t('cancel') });
    if (!ok) return;
    await run(async () => {
      await api.post(`/admin/yara-releases/${release.id}/${action}`, {});
      return done;
    });
  };

  const data = query.data;
  if (!data) return null;
  const nameOf = (id: string) => data.packs.find((p) => p.id === id)?.name ?? id;

  return (
    <HpsmSection title={t('packUpdates')} className="dl-form-col dl-mt-lg">
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmForm>
        <Checkbox
          id="yara-auto-update"
          labelText={t('autoUpdate')}
          helperText={t('autoUpdateHelp')}
          checked={data.autoUpdate}
          disabled={busy}
          onChange={(_, { checked }) => void setAuto(checked)}
        />
        {data.packs.map((pack) => (
          <div key={pack.id} className="dl-pack-update">
            <strong>{pack.name}</strong> · {t('versionOf', { date: pack.commitDate })}
            {pack.lastCheck
              ? ` · ${t('checkedOn', { date: new Date(pack.lastCheck).toLocaleString(intlLocale()) })}`
              : ` · ${t('notChecked')}`}{' '}
            <button
              type="button"
              className="dl-link-button"
              disabled={busy}
              onClick={() => void check(pack.id, pack.name)}
            >
              {t('checkNow')}
            </button>
            {pack.lastError && (
              <p className="hpsm-field__help">{t('lastFailed', { error: pack.lastError })}</p>
            )}
          </div>
        ))}
      </HpsmForm>
      {data.releases.length > 0 && (
        <ul className="dl-pack-releases" aria-label={t('packUpdatesAria')}>
          {data.releases.map((release) => (
            <li key={release.id}>
              <StatusText tone={STATUS[release.status].tone}>
                {STATUS[release.status].label}
              </StatusText>{' '}
              {t('releaseLine', {
                name: nameOf(release.pack),
                date: new Date(release.createdAt).toLocaleDateString(intlLocale()),
              })}{' '}
              <span className="dl-mono">{release.commit.slice(0, 8)}</span> ·{' '}
              {changes(release.summary)}
              {release.status === 'HELD' && (
                <>
                  <ul>
                    {(release.reasons ?? []).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <span className="dl-row-actions">
                    <button
                      type="button"
                      className="dl-link-button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          release,
                          'approve',
                          t('approveUpdate'),
                          t('approveConfirm', { name: nameOf(release.pack) }),
                          t('approve'),
                          t('approved'),
                        )
                      }
                    >
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      className="dl-link-button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          release,
                          'dismiss',
                          t('dismissUpdate'),
                          t('dismissHelp'),
                          t('dismiss'),
                          t('dismissed'),
                        )
                      }
                    >
                      {t('dismiss')}
                    </button>
                  </span>
                </>
              )}
              {release.canRollback && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="dl-link-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        release,
                        'rollback',
                        t('rollback'),
                        t('rollbackConfirm', { name: nameOf(release.pack) }),
                        t('rollbackShort'),
                        t('rolledBack'),
                      )
                    }
                  >
                    {t('rollback')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </HpsmSection>
  );
}
