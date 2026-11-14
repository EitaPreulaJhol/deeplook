import { Checkbox } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { YaraPack } from '../api/types';
import { t } from '../i18n/admin';
import { AdminYaraUpdates } from './AdminYaraUpdates';
import { useConfirm } from './HpsmConfirm';
import { HpsmForm, HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';

interface Settings {
  ownSamplesOnly: boolean;
}

/** Configuracoes do sistema feitas na tela (item 140); as demais vem do ambiente. */
export function AdminSettingsTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<Settings>('/admin/settings'),
  });
  const packsQuery = useQuery({
    queryKey: ['yara-packs'],
    queryFn: () => api.get<{ packs: YaraPack[] }>('/yara/packs'),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (next: boolean) => {
    const ok = await confirm({
      title: next ? t('restrictSamples') : t('openSamples'),
      message: next ? t('restrictHelp') : t('openHelp'),
      confirmLabel: next ? t('restrict') : t('open'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.patch<Settings>('/admin/settings', { ownSamplesOnly: next });
      queryClient.setQueryData(['admin', 'settings'], saved);
      await queryClient.invalidateQueries({ queryKey: ['me', 'sample-access'] });
      setNotice({
        ok: true,
        text: next ? t('restricted') : t('opened'),
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const changePack = async (pack: YaraPack, next: boolean) => {
    const ok = await confirm({
      title: t(next ? 'packOnTitle' : 'packOffTitle', { name: pack.name }),
      message: next
        ? t('packOnHelp', { n: pack.fileCount, license: pack.license })
        : t('packOffHelp'),
      confirmLabel: next ? t('switchOn') : t('switchOff'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.patch<{ packs: YaraPack[] }>(`/admin/yara-packs/${pack.id}`, {
        enabled: next,
      });
      queryClient.setQueryData(['yara-packs'], saved);
      setNotice({
        ok: true,
        text: t(next ? 'packOn' : 'packOff', { name: pack.name }),
      });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text={t('loadingSettings')} />}
      {query.isError && (
        <HpsmMessage kind="error">
          {t('loadErr', { error: (query.error as Error).message })}
        </HpsmMessage>
      )}
      {query.data && (
        <HpsmSection title={t('sampleAccess')} className="dl-form-col">
          <HpsmForm>
            <Checkbox
              id="setting-own-samples"
              labelText={t('ownOnly')}
              helperText={t('ownOnlyHelp')}
              checked={query.data.ownSamplesOnly}
              disabled={busy}
              onChange={(_, { checked }) => void change(checked)}
            />
          </HpsmForm>
        </HpsmSection>
      )}
      {packsQuery.data && (
        <HpsmSection title={t('yaraPacks')} className="dl-form-col">
          <HpsmForm>
            {packsQuery.data.packs.map((pack) => (
              <div key={pack.id}>
                <Checkbox
                  id={`yara-pack-${pack.id}`}
                  labelText={t('packSets', { name: pack.name, n: pack.fileCount })}
                  helperText={pack.description}
                  checked={pack.enabled}
                  disabled={busy}
                  onChange={(_, { checked }) => void changePack(pack, checked)}
                />
                <p className="hpsm-field__help">
                  {t('packMeta', {
                    author: pack.author,
                    license: pack.license,
                    date: pack.commitDate,
                  })}{' '}
                  <a className="dl-link" href={pack.url} target="_blank" rel="noreferrer">
                    {t('source')}
                  </a>
                </p>
              </div>
            ))}
          </HpsmForm>
        </HpsmSection>
      )}
      <AdminYaraUpdates />
    </>
  );
}
