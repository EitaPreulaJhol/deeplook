import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { api } from '../api/client';
import type {
  AndroidResult,
  ConfigResult,
  EmulationResult,
  ServiceAnalysisInfo,
  ServiceKindId,
} from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
const TONE: Record<string, StatusTone> = { high: 'red', medium: 'orange', info: 'gray' };
/** Linhas mostradas por lista antes do "ver todas". */
const SHOWN = 15;

/** A analise de um servico novo; atualiza a cada 5 s enquanto esta na fila ou rodando. */
export function useServiceAnalysis<R>(kind: ServiceKindId, entryId: string, enabled = true) {
  return useQuery({
    queryKey: ['service-analysis', kind, entryId],
    queryFn: () => api.get<ServiceAnalysisInfo<R>>(`/entries/${entryId}/analyses/${kind}`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.analysis?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

type Analysis<R> = NonNullable<ServiceAnalysisInfo<R>['analysis']>;

function situation<R>(a: Analysis<R>): { tone: StatusTone; text: string } {
  if (a.status === 'PENDING') return { tone: 'blue', text: t('queued') };
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: t('runningSince', { date: fmtDate(a.startedAt) }) };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: t('failed', { error: a.error ?? t('unknownErr') }) };
  const high = (a.alerts ?? []).some((x) => x.level === 'high');
  return {
    tone: high ? 'red' : 'green',
    text: `${high ? t('riskFindings') : t('nothingHighRisk')} · ${fmtDate(a.finishedAt)}${
      a.ms !== null ? ` (${(a.ms / 1000).toFixed(1)} s)` : ''
    }`,
  };
}

/** Lista de texto (veio da amostra: nunca HTML), com "ver todas" acima do teto. */
function TextList({ items, mono = true }: { items: string[]; mono?: boolean }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <>
      <ul className="dl-office__list">
        {shown.map((x, i) => (
          <li key={i} className={mono ? 'dl-mono' : undefined}>
            {x}
          </li>
        ))}
      </ul>
      {items.length > SHOWN && (
        <button type="button" className="dl-link-button" onClick={() => setAll(!all)}>
          {all ? t('seeLess') : t('seeAll', { n: items.length })}
        </button>
      )}
    </>
  );
}

/**
 * O esqueleto comum das tres secoes: a situacao, o botao de pedir (de novo), os alertas e os IOCs.
 * Cada secao diz o titulo, os textos de vazio e o corpo com o resultado.
 */
function ServiceSection<R>({
  kind,
  entryId,
  canTriage,
  title,
  help,
  notYet,
  off,
  extraButtons,
  body,
}: {
  kind: ServiceKindId;
  entryId: string;
  canTriage: boolean;
  title: string;
  help: string;
  notYet: string;
  off: string;
  /** Botoes alem do "analisar" (o shellcode da emulacao). */
  extraButtons?: (request: (options?: object) => void, asking: boolean) => ReactNode;
  body: (result: R, analysis: Analysis<R>) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const query = useServiceAnalysis<R>(kind, entryId);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.auto && !info.manual && !info.analysis)) return null;
  // Tipo que so vai a mao (shellcode, APK dentro de um ZIP) e que ninguem pediu: so analistas veem.
  if (!info.auto && !info.analysis && !(canTriage && info.enabled)) return null;
  const analysis = info.analysis;

  const request = async (options: object = {}) => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/analyses/${kind}`, options);
      await queryClient.invalidateQueries({ queryKey: ['service-analysis', kind, entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = analysis?.status === 'PENDING' || analysis?.status === 'RUNNING';
  const buttons =
    canTriage && info.enabled && !busy ? (
      <>
        {(info.auto || analysis) && (
          <button
            type="button"
            className="dl-link-button"
            disabled={asking}
            onClick={() => request(analysis?.options ?? {})}
          >
            {asking ? t('requesting') : analysis ? t('analyzeAgain') : t('analyzeNow')}
          </button>
        )}
        {extraButtons?.((o) => void request(o), asking)}
      </>
    ) : null;

  if (!analysis) {
    return (
      <HpsmSection title={title}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled ? notYet : off} {buttons}
        </p>
      </HpsmSection>
    );
  }
  const state = situation(analysis);
  return (
    <HpsmSection title={title}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label={t('sigState')} help={help} wide>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {buttons}
            {analysis.version && <span className="dl-hint-muted"> · {analysis.version}</span>}
          </HpsmReadonly>
        </HpsmField>
        {(analysis.alerts ?? []).length > 0 && (
          <HpsmField label={t('alerts')} wide top>
            <ul className="dl-office__alerts">
              {(analysis.alerts ?? []).map((a, i) => (
                <li key={i}>
                  <StatusText tone={TONE[a.level] ?? 'gray'}>{a.text}</StatusText>
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
        {analysis.status === 'DONE' && analysis.result && body(analysis.result, analysis)}
        {analysis.iocs.length > 0 && (
          <HpsmField label={t('iocsFound', { n: analysis.iocs.length })} wide top>
            <TextList items={analysis.iocs} />
          </HpsmField>
        )}
      </HpsmForm>
    </HpsmSection>
  );
}

const field = (label: string, items: string[]) =>
  items.length > 0 ? (
    <HpsmField label={label} wide top>
      <TextList items={items} />
    </HpsmField>
  ) : null;

// ------------------------------------------------------------------ emulacao (item 4)

function ShellcodeButtons({
  request,
  asking,
}: {
  request: (options?: object) => void;
  asking: boolean;
}) {
  const [arch, setArch] = useState<'x86' | 'amd64'>('x86');
  return (
    <span className="dl-emu__shellcode">
      <label>
        {t('emuArch')}{' '}
        <select value={arch} onChange={(e) => setArch(e.target.value as 'x86' | 'amd64')}>
          <option value="x86">x86</option>
          <option value="amd64">x64 (amd64)</option>
        </select>
      </label>{' '}
      <button
        type="button"
        className="dl-link-button"
        disabled={asking}
        onClick={() => request({ kind: 'shellcode', arch })}
      >
        {t('emuShellcode')}
      </button>
    </span>
  );
}

function EmulationBody({ r }: { r: EmulationResult }) {
  const apis = [...r.apis].sort((a, b) => a.order - b.order);
  const traffic = r.network.traffic.map((x) =>
    `${x.proto ?? ''} ${x.server ?? '?'}${x.port ? `:${x.port}` : ''}${x.method ? ` ${x.method}` : ''}${x.url ? ` ${x.url}` : ''}`.trim(),
  );
  return (
    <>
      <HpsmField label={t('emuKind')}>
        <HpsmReadonly>
          {r.kind === 'shellcode'
            ? t('emuKindShellcode', { arch: r.arch ?? '?' })
            : t('emuKindPe', { n: r.entryPoints.length })}
          {r.dynamicCode > 0 && ` · ${t('emuDynamic', { n: r.dynamicCode })}`}
        </HpsmReadonly>
      </HpsmField>
      {apis.length > 0 && (
        <HpsmField label={t('emuApis', { n: r.apiTotal, u: apis.length })} wide top>
          <TextList
            items={apis.map(
              (a) =>
                `${a.name}${a.count > 1 ? ` ×${a.count}` : ''}(${a.args.filter(Boolean).join(', ')})`,
            )}
          />
        </HpsmField>
      )}
      {field(t('emuNetwork'), [...r.network.dns.map((d) => `DNS ${d.query}`), ...traffic])}
      {field(
        t('emuProcesses'),
        r.processes.map(
          (p) =>
            `${p.event ?? '?'} ${p.path ?? ''}${p.pid !== null && p.pid !== undefined ? ` (${p.pid})` : ''}${
              p.cmdline ? ` — ${p.cmdline}` : ''
            }${p.protect ? ` ${p.protect}` : ''}`,
        ),
      )}
      {field(
        t('emuDropped'),
        r.dropped.map(
          (d) => `${d.path}${d.size ? ` · ${d.size} B` : ''}${d.sha256 ? ` · ${d.sha256}` : ''}`,
        ),
      )}
      {field(
        t('emuFiles'),
        r.files.map((f) => `${f.event ?? '?'} ${f.path}`),
      )}
      {field(
        t('emuRegistry'),
        r.registry.map((k) => `${k.event ?? '?'} ${k.path}${k.value ? ` = ${k.value}` : ''}`),
      )}
      {field(
        t('emuStrings'),
        r.strings.filter((x): x is string => Boolean(x)),
      )}
      {field(
        t('emuErrors'),
        r.errors.map(
          (e) =>
            `${e.entry ?? '?'}: ${e.type ?? '?'}${e.api ? ` (${e.api})` : ''}${e.pc ? ` @ ${e.pc}` : ''}`,
        ),
      )}
    </>
  );
}

/** Secao "Emulacao (Speakeasy)" (plans/novas-analises, item 4). */
export function EmulationSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  return (
    <ServiceSection<EmulationResult>
      kind="emulation"
      entryId={entryId}
      canTriage={canTriage}
      title={t('emuTitle')}
      help={t('emuHelp')}
      notYet={t('emuNotYet')}
      off={t('emuOff')}
      extraButtons={(request, asking) => <ShellcodeButtons request={request} asking={asking} />}
      body={(r) => <EmulationBody r={r} />}
    />
  );
}

// ------------------------------------------------------------------ APK (item 6)

function AndroidBody({ r }: { r: AndroidResult }) {
  const dangerous = r.permissions.filter((p) => p.dangerous).length;
  const signed = (['v1', 'v2', 'v3'] as const).filter((v) => r.signed[v]);
  return (
    <>
      <HpsmField label={t('apkPackage')}>
        <HpsmReadonly>
          <span className="dl-mono">{r.package ?? '—'}</span>
          {r.appName && ` (${r.appName})`}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('apkVersion')}>
        <HpsmReadonly>
          {r.versionName ?? '—'}
          {r.versionCode && ` (${r.versionCode})`}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('apkSdk')}>
        <HpsmReadonly>
          {r.minSdk ?? '—'} / {r.targetSdk ?? '—'}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('apkSigned')}>
        <HpsmReadonly>
          {signed.length ? (
            signed.join(', ')
          ) : (
            <StatusText tone="orange">{t('apkUnsigned')}</StatusText>
          )}
        </HpsmReadonly>
      </HpsmField>
      <HpsmField label={t('apkMain')} wide>
        <HpsmReadonly>
          <span className="dl-mono">{r.mainActivity ?? '—'}</span> ·{' '}
          {t('apkComponents', {
            a: r.components.activities,
            s: r.components.services,
            r: r.components.receivers,
            p: r.components.providers,
          })}
        </HpsmReadonly>
      </HpsmField>
      {r.permissions.length > 0 && (
        <HpsmField label={t('apkPermissions', { n: r.permissions.length, d: dangerous })} wide top>
          <ul className="dl-office__list">
            {[...r.permissions]
              .sort((a, b) => Number(b.dangerous) - Number(a.dangerous))
              .map((p) => (
                <li key={p.name} className="dl-mono" title={p.name}>
                  {p.dangerous ? <StatusText tone="orange">{p.short}</StatusText> : p.short}
                </li>
              ))}
          </ul>
        </HpsmField>
      )}
      {field(
        t('apkExported'),
        r.exported.map(
          (c) =>
            `${c.kind} ${c.name ?? '?'}${c.permission ? ` [${c.permission}]` : ''}${
              c.actions.length ? ` — ${c.actions.filter(Boolean).join(', ')}` : ''
            }`,
        ),
      )}
      {field(t('apkApis'), r.apis)}
      {field(t('apkNetwork'), [
        ...r.urls.filter((x): x is string => Boolean(x)),
        ...r.ips,
        ...r.domains,
      ])}
      {field(
        t('apkCerts'),
        r.certificates.map(
          (c) =>
            `${c.subject ?? '?'}${c.debug ? ` (${t('apkDebugCert')})` : ''} · SHA-256 ${c.sha256} · ${
              c.notBefore?.slice(0, 10) ?? '?'
            } → ${c.notAfter?.slice(0, 10) ?? '?'}`,
        ),
      )}
      {field(
        t('apkHidden'),
        r.hiddenPayloads.filter((x): x is string => Boolean(x)),
      )}
      {field(
        t('apkNative'),
        r.nativeLibs.filter((x): x is string => Boolean(x)),
      )}
    </>
  );
}

/** Secao "Android (APK)" (plans/novas-analises, item 6). */
export function AndroidSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  return (
    <ServiceSection<AndroidResult>
      kind="android"
      entryId={entryId}
      canTriage={canTriage}
      title={t('apkTitle')}
      help={t('apkHelp')}
      notYet={t('apkNotYet')}
      off={t('apkOff')}
      body={(r) => <AndroidBody r={r} />}
    />
  );
}

// ------------------------------------------------------------------ configuracao (item 2)

/** A configuracao em linhas "chave: valor" (aninhada com pontos), como texto. */
function flatten(value: unknown, prefix = '', out: string[] = []): string[] {
  if (out.length >= 500) return out;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('base64' in obj && 'size' in obj) {
      out.push(`${prefix}: <${obj.size} bytes> ${String(obj.base64).slice(0, 80)}…`);
      return out;
    }
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      out.push(`${prefix}: ${value.map(String).join(', ')}`);
    } else value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else {
    out.push(`${prefix}: ${String(value)}`);
  }
  return out;
}

function ConfigBody({ r }: { r: ConfigResult }) {
  if (!r.matches.length && !r.configs.length) {
    return (
      <HpsmField label={t('cfgMatches')} wide>
        <HpsmReadonly>{t('cfgNone', { n: r.parsers ?? '?' })}</HpsmReadonly>
      </HpsmField>
    );
  }
  return (
    <>
      {field(
        t('cfgMatches'),
        r.matches.map((m) => `${m.rule ?? '?'}${m.family ? ` → ${m.family}` : ''}`),
      )}
      {r.configs.map((c, i) => (
        <HpsmField key={i} label={t('cfgFamily', { family: c.family })} wide top>
          <TextList items={flatten(c.config)} />
        </HpsmField>
      ))}
    </>
  );
}

/** Secao "Configuracao extraida (CAPE)" (plans/novas-analises, item 2). */
export function ConfigSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  return (
    <ServiceSection<ConfigResult>
      kind="config"
      entryId={entryId}
      canTriage={canTriage}
      title={t('cfgTitle')}
      help={t('cfgHelp')}
      notYet={t('cfgNotYet')}
      off={t('cfgOff')}
      body={(r) => <ConfigBody r={r} />}
    />
  );
}
