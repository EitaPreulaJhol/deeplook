import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { SandboxArtifacts as Artifacts } from '../api/types';
import { HpsmMessage } from './messages';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR');
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
    refetchInterval: (q) =>
      running && q.state.data?.intervalS ? q.state.data.intervalS * 1000 : false,
  });
  const data = query.data;
  if (!data) return null;
  const shots = data.screenshots;
  const shown = shots.length > SHOWN ? [shots[0], ...shots.slice(-(SHOWN - 1))] : shots;
  const appeared = data.processes?.appeared ?? [];
  if (!shots.length && !data.processes && !data.note) {
    return running && data.intervalS ? (
      <p className="dl-hint-muted">
        A primeira coleta (print e processos) sai em até {data.intervalS} s.
      </p>
    ) : null;
  }
  return (
    <div className="dl-sandbox-artifacts">
      <h4>Artefatos do ambiente</h4>
      {data.note && <HpsmMessage kind="warning">Processos: {data.note}.</HpsmMessage>}
      {shown.length > 0 && (
        <ul className="dl-sandbox-artifacts__shots" aria-label="Prints da tela da VM">
          {shown.map((s) => (
            <li key={s.id}>
              <a
                href={`/api/sandbox/${sessionId}/artifacts/${s.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/sandbox/${sessionId}/artifacts/${s.id}`}
                  alt={`Tela da VM às ${fmtTime(s.createdAt)}`}
                  loading="lazy"
                />
                <span>{fmtTime(s.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {shots.length > SHOWN && (
        <p className="dl-hint-muted">
          {shots.length} prints guardados; aqui, o primeiro e os mais recentes.
        </p>
      )}
      {data.processes && (
        <>
          <p className="dl-sandbox-artifacts__summary">
            {appeared.length
              ? `${appeared.length} processo(s) surgiram desde a primeira listagem (${fmtTime(data.processes.firstAt)}):`
              : `Nenhum processo novo desde a primeira listagem (${data.processes.lists} listagem(ns), a última às ${fmtTime(data.processes.at)}).`}
          </p>
          {appeared.length > 0 && (
            <table className="dl-risk__reasons" aria-label="Processos que surgiram">
              <thead>
                <tr>
                  <th scope="col">PID</th>
                  <th scope="col">Pai</th>
                  <th scope="col">Processo</th>
                  <th scope="col">Linha de comando</th>
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
          <p className="dl-hint-muted">
            É o que o próprio sistema da VM informa pelo agente: um malware pode esconder processos.
          </p>
        </>
      )}
    </div>
  );
}
