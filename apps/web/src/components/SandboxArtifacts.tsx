import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { SandboxArtifacts as Artifacts } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { HpsmMessage } from './messages';
import { SandboxNetwork } from './SandboxNetwork';
import { SandboxSysmon } from './SandboxSysmon';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale());
/** Miniaturas mostradas (as mais recentes); o primeiro print fica sempre. */
const SHOWN = 8;

/**
 * Artefatos do ambiente isolado (revisao de novembro, 3.7): os prints que a API guarda de tempos
 * em tempos e os processos que surgiram desde a primeira listagem, pelo agente do guest. Ficam
 * depois que a VM e destruida. Atualiza a cada intervalo enquanto o ambiente roda.
 */
export function SandboxArtifacts({ sessionId, running }: { sessionId: string; running: boolean }) {
  const query = useQuery({
    queryKey: ['sandbox', 'artifacts', sessionId],
    queryFn: () => api.get<Artifacts>(`/sandbox/${sessionId}/artifacts`),
    refetchInterval: (q) => {
      // O Suricata analisa depois que o ambiente encerra (plano pos-revisao, 5.4).
      const ids = q.state.data?.network?.ids?.status;
      if (ids === 'PENDING' || ids === 'RUNNING') return 5000;
      return running && q.state.data?.intervalS ? q.state.data.intervalS * 1000 : false;
    },
  });
  const data = query.data;
  if (!data) return null;
  const shots = data.screenshots;
  const shown = shots.length > SHOWN ? [shots[0], ...shots.slice(-(SHOWN - 1))] : shots;
  const appeared = data.processes?.appeared ?? [];
  if (!shots.length && !data.processes && !data.note && !data.sysmon && !data.network) {
    return running && data.intervalS ? (
      <p className="dl-hint-muted">{t('firstCollect', { n: data.intervalS })}</p>
    ) : null;
  }
  return (
    <div className="dl-sandbox-artifacts">
      <h4>{t('artifactsTitle')}</h4>
      {data.note && (
        <HpsmMessage kind="warning">{t('processesNote', { note: data.note })}</HpsmMessage>
      )}
      {shown.length > 0 && (
        <ul className="dl-sandbox-artifacts__shots" aria-label={t('vmShotsAria')}>
          {shown.map((s) => (
            <li key={s.id}>
              <a
                href={`/api/sandbox/${sessionId}/artifacts/${s.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/sandbox/${sessionId}/artifacts/${s.id}`}
                  alt={t('vmScreenAt', { time: fmtTime(s.createdAt) })}
                  loading="lazy"
                />
                <span>{fmtTime(s.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {shots.length > SHOWN && (
        <p className="dl-hint-muted">{t('shotsKept', { n: shots.length })}</p>
      )}
      {data.processes && (
        <>
          <p className="dl-sandbox-artifacts__summary">
            {appeared.length
              ? t('processesAppeared', {
                  n: appeared.length,
                  time: fmtTime(data.processes.firstAt),
                })
              : t('noNewProcesses', {
                  lists: data.processes.lists,
                  time: fmtTime(data.processes.at),
                })}
          </p>
          {appeared.length > 0 && (
            <table className="dl-risk__reasons" aria-label={t('appearedAria')}>
              <thead>
                <tr>
                  <th scope="col">PID</th>
                  <th scope="col">{t('parent')}</th>
                  <th scope="col">{t('process')}</th>
                  <th scope="col">{t('commandLine')}</th>
                </tr>
              </thead>
              <tbody>
                {appeared.map((p) => (
                  <tr key={`${p.pid}-${p.name}`}>
                    <td>{p.pid}</td>
                    <td>{p.ppid ?? '—'}</td>
                    <td>{p.name}</td>
                    <td className="dl-mono">{p.cmd ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="dl-hint-muted">{t('agentNote')}</p>
        </>
      )}
      {data.sysmon && <SandboxSysmon sysmon={data.sysmon} />}
      {data.network && <SandboxNetwork sessionId={sessionId} network={data.network} />}
    </div>
  );
}
