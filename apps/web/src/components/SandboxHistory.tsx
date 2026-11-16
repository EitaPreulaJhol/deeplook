import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { SandboxRun } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { SandboxArtifacts } from './SandboxArtifacts';
import { SandboxCompare } from './SandboxCompare';
import { SANDBOX_STATUS_LABELS } from './sandboxStatus';

const fmtDate = (iso: string) => new Date(iso).toLocaleString(intlLocale());
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());

/** Uma execucao anterior: o resumo na linha e os artefatos so quando aberta (carrega sob demanda). */
function PreviousRun({ run }: { run: SandboxRun }) {
  const [open, setOpen] = useState(false);
  const autoRun =
    run.autoRun === 'DONE' && run.autoRunAt
      ? t('historyAutoRun', { time: fmtTime(run.autoRunAt) })
      : run.autoRun === 'FAILED'
        ? t('historyAutoRunFailed')
        : null;
  return (
    <details
      className="dl-static-strings dl-sandbox-history__run"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {t('historyRun', {
          date: fmtDate(run.startedAt ?? run.createdAt),
          who: run.analyst.displayName,
          status: SANDBOX_STATUS_LABELS[run.status],
        })}
        {autoRun && <> · {autoRun}</>}
      </summary>
      {open && <SandboxArtifacts sessionId={run.id} running={false} />}
    </details>
  );
}

/**
 * Execucoes anteriores da amostra (plans/sandbox-execucoes, fase 1): cada ambiente que ja rodou,
 * com os proprios prints, processos, Sysmon e captura. A secao do ambiente mostra o atual; antes,
 * rodar a amostra de novo escondia tudo o que a execucao anterior colheu.
 */
export function SandboxHistory({ entryId, currentId }: { entryId: string; currentId: string }) {
  // Debaixo da chave do painel: abrir ou encerrar um ambiente (que a invalida) atualiza a lista.
  const query = useQuery({
    queryKey: ['sandbox', 'entry', entryId, 'sessions'],
    queryFn: () => api.get<{ sessions: SandboxRun[] }>(`/entries/${entryId}/sandbox/sessions`),
    staleTime: 30_000,
  });
  const sessions = query.data?.sessions ?? [];
  const previous = sessions.filter((s) => s.id !== currentId);
  if (!previous.length) return null;
  return (
    <div className="dl-sandbox-history">
      <h4>{t('historyTitle', { n: previous.length })}</h4>
      {/* Diff entre duas execucoes (plans/novas-analises, item 8): a atual entra na escolha. */}
      <SandboxCompare runs={sessions} />
      {previous.map((run) => (
        <PreviousRun key={run.id} run={run} />
      ))}
    </div>
  );
}
