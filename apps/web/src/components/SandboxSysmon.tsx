import type { ReactNode } from 'react';

import type { SandboxSysmon as Sysmon, SysmonProcess } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';

const fmtTime = (iso: string) => (iso ? new Date(iso).toLocaleTimeString(intlLocale()) : '—');
/** O nome do executavel, sem a pasta (C:\Windows\System32\cmd.exe -> cmd.exe). */
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '—');

/**
 * Arvore de processos do Sysmon (evento 1): cada processo sob o pai que o abriu. Quem tem pai fora
 * da lista (aberto antes da sessao, como o explorer) vira raiz, com o nome do pai na frente.
 */
function ProcessTree({ processes }: { processes: SysmonProcess[] }) {
  const pids = new Set(processes.map((p) => p.pid).filter((p): p is number => p !== null));
  const children = new Map<number, SysmonProcess[]>();
  const roots: SysmonProcess[] = [];
  for (const p of processes) {
    if (p.ppid !== null && pids.has(p.ppid) && p.ppid !== p.pid) {
      children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
    } else roots.push(p);
  }
  const seen = new Set<SysmonProcess>();
  const node = (p: SysmonProcess, root: boolean): ReactNode => {
    if (seen.has(p)) return null;
    seen.add(p);
    const kids = p.pid !== null ? (children.get(p.pid) ?? []) : [];
    return (
      <li key={`${p.pid}-${p.time}`}>
        <span className="dl-sysmon__proc">
          {root && p.parentImage && <span className="dl-hint-muted">{base(p.parentImage)} → </span>}
          <strong>{base(p.image)}</strong> <span className="dl-hint-muted">PID {p.pid ?? '?'}</span>
        </span>
        {p.cmd && <code className="dl-mono dl-sysmon__cmd">{p.cmd}</code>}
        {kids.length > 0 && <ul>{kids.map((k) => node(k, false))}</ul>}
      </li>
    );
  };
  return (
    <ul className="dl-sysmon__tree" aria-label={t('sysmonTreeAria')}>
      {roots.map((r) => node(r, true))}
    </ul>
  );
}

export function ArtifactTable({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: ReactNode[][];
}) {
  if (!rows.length) return null;
  return (
    <>
      <h5 className="dl-sysmon__title">
        {label} ({rows.length})
      </h5>
      <table className="dl-risk__reasons dl-sysmon__table" aria-label={label}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className={j === cells.length - 1 ? 'dl-mono' : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * O que o Sysmon do template registrou na VM desde o inicio da sessao (plano pos-revisao, item
 * 5.3): a arvore de processos, as conexoes, as consultas DNS, os arquivos criados e o registro
 * alterado. Sem Sysmon no template, so o motivo.
 */
export function SandboxSysmon({ sysmon }: { sysmon: Sysmon }) {
  if (!sysmon.available) {
    return <p className="dl-hint-muted">{t('sysmonOff', { reason: sysmon.reason })}</p>;
  }
  const time = t('sysmonTime');
  const process = t('process');
  return (
    <div className="dl-sysmon">
      <h4>{t('sysmonTitle')}</h4>
      <p className="dl-sandbox-artifacts__summary dl-sysmon__summary">
        {t('sysmonSummary', { n: sysmon.events, time: fmtTime(sysmon.at) })}
        {sysmon.truncated && ` ${t('sysmonTruncated')}`}
      </p>
      {sysmon.processes.length > 0 && (
        <>
          <h5 className="dl-sysmon__title">
            {t('sysmonTree')} ({sysmon.processes.length})
          </h5>
          <ProcessTree processes={sysmon.processes} />
        </>
      )}
      <ArtifactTable
        label={t('sysmonNetwork')}
        head={[time, process, t('sysmonProtocol'), t('sysmonDestination')]}
        rows={sysmon.network.map((c) => [
          fmtTime(c.time),
          base(c.image),
          c.protocol ?? '—',
          `${c.dstHost ?? c.dstIp ?? '?'}${c.dstPort !== null ? `:${c.dstPort}` : ''}`,
        ])}
      />
      <ArtifactTable
        label={t('sysmonDns')}
        head={[time, process, t('sysmonQuery')]}
        rows={sysmon.dns.map((q) => [
          fmtTime(q.time),
          base(q.image),
          q.results ? `${q.query} → ${q.results.replace(/;$/, '')}` : q.query,
        ])}
      />
      <ArtifactTable
        label={t('sysmonFiles')}
        head={[time, process, t('sysmonPath')]}
        rows={sysmon.files.map((f) => [fmtTime(f.time), base(f.image), f.path])}
      />
      <ArtifactTable
        label={t('sysmonRegistry')}
        head={[time, process, t('sysmonAction'), t('sysmonKey')]}
        rows={sysmon.registry.map((r) => [
          fmtTime(r.time),
          base(r.image),
          r.action ?? '—',
          r.details ? `${r.key} = ${r.details}` : r.key,
        ])}
      />
      {sysmon.events === 0 && <p className="dl-hint-muted">{t('sysmonEmpty')}</p>}
      <p className="dl-hint-muted">{t('sysmonNote')}</p>
    </div>
  );
}
