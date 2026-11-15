import { api } from '../api/client';
import type { SandboxRun, SandboxRunSummary } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/sandbox';
import { SANDBOX_STATUS_LABELS } from './sandboxStatus';

/**
 * Resumo da execucao do sandbox para o que sai da amostra (plans/ajustes-usabilidade, item 6): a
 * ficha impressa e o Markdown dos relatorios. A ultima execucao da amostra; so analistas (as rotas
 * do sandbox sao deles).
 */

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(intlLocale()) : '—';
/** O nome do executavel, sem a pasta. */
const base = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '?');

/** O resumo da execucao mais recente da amostra (null sem nenhuma). */
export async function latestRunSummary(entryId: string): Promise<SandboxRunSummary | null> {
  const { sessions } = await api.get<{ sessions: SandboxRun[] }>(
    `/entries/${entryId}/sandbox/sessions`,
  );
  const latest = sessions[0];
  return latest ? api.get<SandboxRunSummary>(`/sandbox/${latest.id}/summary`) : null;
}

/** Os dados da execucao, como pares rotulo e valor. */
export function runFacts(s: SandboxRunSummary): [string, string][] {
  const autoRun =
    s.session.autoRun === 'DONE'
      ? t('runAutoRunDone', {
          time: fmtTime(s.session.autoRunAt),
          user: s.session.autoRunUser ?? '?',
        })
      : s.session.autoRun === 'FAILED'
        ? t('runAutoRunFailed')
        : t('runAutoRunNone');
  const sysmon = !s.sysmon
    ? t('runSysmonNone')
    : s.sysmon.available
      ? t('runSysmonEvents', { n: s.sysmon.events ?? 0 })
      : t('runSysmonOff', { reason: s.sysmon.reason ?? '?' });
  return [
    [
      t('runWhen'),
      `${fmtDate(s.session.startedAt ?? s.session.createdAt)} · ${SANDBOX_STATUS_LABELS[s.session.status]}`,
    ],
    [t('runBy'), s.session.analyst ?? '—'],
    [t('runAutoRun'), autoRun],
    ['Sysmon', sysmon],
    [t('runShots'), String(s.screenshots)],
  ];
}

/** As listas do que a amostra fez, em texto (so as que tem itens). */
export function runSections(s: SandboxRunSummary): { title: string; items: string[] }[] {
  const sections = [
    {
      title: t('runProcesses'),
      items: s.processes.map(
        (p) =>
          `${fmtTime(p.time)} ${base(p.image)} (PID ${p.pid ?? '?'})${p.cmd ? ` — ${p.cmd}` : ''}`,
      ),
    },
    {
      title: t('runDns'),
      items: s.dns.map((d) =>
        d.results ? `${d.query} → ${d.results.replace(/;$/, '')}` : d.query,
      ),
    },
    {
      title: t('runNetwork'),
      items: s.network.map((n) => `${n.protocol ? `${n.protocol} ` : ''}${n.destination}`),
    },
    { title: t('runFiles'), items: s.files },
    {
      title: t('runRegistry'),
      items: s.registry.map(
        (r) => `${r.action ? `${r.action} ` : ''}${r.key}${r.details ? ` = ${r.details}` : ''}`,
      ),
    },
    // Sem Sysmon, o que o agente viu surgir (a mesma lista da tela).
    ...(!s.sysmon?.available
      ? [
          {
            title: t('runAppeared'),
            items: s.appeared.map((p) => `${p.name} (PID ${p.pid})${p.cmd ? ` — ${p.cmd}` : ''}`),
          },
        ]
      : []),
  ];
  return sections.filter((section) => section.items.length > 0);
}

/** O aviso quando a amostra nao aparece no Sysmon (rodada a mao com outro nome, por exemplo). */
export function runNote(s: SandboxRunSummary): string | null {
  return s.sysmon?.available && !s.sample.found
    ? t('runSampleNotFound', { name: s.sample.name })
    : null;
}

/** O resumo em Markdown (exportacao dos relatorios). */
export function runSummaryMarkdown(s: SandboxRunSummary): string[] {
  const cell = (v: string) => v.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const lines = [`## ${t('runTitle')}`, '', '| | |', '|---|---|'];
  for (const [label, value] of runFacts(s)) lines.push(`| ${cell(label)} | ${cell(value)} |`);
  lines.push('');
  const note = runNote(s);
  if (note) lines.push(note, '');
  for (const { title, items } of runSections(s)) {
    // Em bloco de codigo: linhas de comando e chaves vem da amostra (nada de Markdown nelas).
    lines.push(`**${title}**`, '', '```', ...items, '```', '');
  }
  return lines;
}
