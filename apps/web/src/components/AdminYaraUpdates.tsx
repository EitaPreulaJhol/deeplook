import { Checkbox } from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { intlLocale } from '../i18n';
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

const STATUS = {
  APPLIED: { label: 'Aplicada', tone: 'green' },
  HELD: { label: 'Retida', tone: 'orange' },
  ROLLED_BACK: { label: 'Desfeita', tone: 'gray' },
  DISMISSED: { label: 'Descartada', tone: 'gray' },
} as const;

const changes = (s: Summary) =>
  `${s.added} novos, ${s.changed} alterados, ${s.removed} removidos${
    s.kept ? `, ${s.kept} não compilam e ficaram de fora` : ''
  }`;

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
      return autoUpdate
        ? 'Atualização automática ligada.'
        : 'Atualização automática desligada. O botão "Verificar agora" continua valendo.';
    });

  const check = (id: string, name: string) =>
    run(async () => {
      const res = await api.post<CheckResult>(`/admin/yara-packs/${id}/check`, { apply: false });
      if (res.outcome === 'current') return `${name} já está na versão mais recente disponível.`;
      if (res.outcome === 'skipped') {
        return `${name}: a versão mais recente foi desfeita ou descartada. Aguardando uma mais nova.`;
      }
      if (res.outcome === 'held') return `${name}: atualização retida. Veja o motivo abaixo.`;
      if (res.outcome === 'applied') return `${name} atualizado: ${changes(res.summary)}.`;
      const ok = await confirm({
        title: `Atualizar ${name}`,
        message: `A nova versão passou nos filtros: ${changes(res.summary)}. Aplicar agora?`,
        confirmLabel: 'Aplicar',
        cancelLabel: 'Agora não',
      });
      if (!ok) return `${name}: nada mudou. A versão nova: ${changes(res.summary)}.`;
      await api.post(`/admin/yara-packs/${id}/check`, { apply: true });
      return `${name} atualizado: ${changes(res.summary)}.`;
    });

  const act = async (
    release: Release,
    action: 'approve' | 'dismiss' | 'rollback',
    title: string,
    message: string,
    confirmLabel: string,
    done: string,
  ) => {
    const ok = await confirm({ title, message, confirmLabel, cancelLabel: 'Cancelar' });
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
    <HpsmSection title="Atualização dos pacotes" className="dl-form-col dl-mt-lg">
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      <HpsmForm>
        <Checkbox
          id="yara-auto-update"
          labelText="Atualizar sozinho os pacotes ligados"
          helperText="Toda semana, só com versões de pelo menos 7 dias. Entra sozinho o que passa nos filtros: licença igual, até 20% de mudança, sem disparar em amostras Limpas e sem deixar a compilação muito mais lenta. O resto fica retido aqui. Precisa de acesso ao GitHub; sem internet, nada muda."
          checked={data.autoUpdate}
          disabled={busy}
          onChange={(_, { checked }) => void setAuto(checked)}
        />
        {data.packs.map((pack) => (
          <div key={pack.id} className="dl-pack-update">
            <strong>{pack.name}</strong> · versão de {pack.commitDate}
            {pack.lastCheck
              ? ` · verificado em ${new Date(pack.lastCheck).toLocaleString(intlLocale())}`
              : ' · ainda não verificado'}{' '}
            <button
              type="button"
              className="dl-link-button"
              disabled={busy}
              onClick={() => void check(pack.id, pack.name)}
            >
              Verificar agora
            </button>
            {pack.lastError && (
              <p className="hpsm-field__help">Última tentativa falhou: {pack.lastError}</p>
            )}
          </div>
        ))}
      </HpsmForm>
      {data.releases.length > 0 && (
        <ul className="dl-pack-releases" aria-label="Atualizações dos pacotes">
          {data.releases.map((release) => (
            <li key={release.id}>
              <StatusText tone={STATUS[release.status].tone}>
                {STATUS[release.status].label}
              </StatusText>{' '}
              {nameOf(release.pack)} ·{' '}
              {new Date(release.createdAt).toLocaleDateString(intlLocale())} · commit{' '}
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
                          'Aprovar a atualização',
                          `Aplicar esta versão de ${nameOf(release.pack)} mesmo com os motivos acima? Depois dá para voltar.`,
                          'Aprovar',
                          'Atualização aprovada e aplicada.',
                        )
                      }
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      className="dl-link-button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          release,
                          'dismiss',
                          'Descartar a atualização',
                          'Esta versão não será oferecida de novo; só uma mais nova.',
                          'Descartar',
                          'Atualização descartada.',
                        )
                      }
                    >
                      Descartar
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
                        'Voltar a versão',
                        `Desfazer esta atualização de ${nameOf(release.pack)}? Esta versão não volta sozinha; só uma mais nova.`,
                        'Voltar',
                        'Versão anterior restaurada.',
                      )
                    }
                  >
                    Voltar a versão
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
