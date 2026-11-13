import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { GhidraFunction, GhidraInfo } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { CopyButton } from './CopyButton';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
/** Maiores funcoes mostradas (o resumo traz ate 300). */
const LARGEST_SHOWN = 20;

/** Analise com o Ghidra da amostra; atualiza a cada 5 s enquanto esta na fila ou analisando. */
export function useGhidra(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ghidra', entryId],
    queryFn: () => api.get<GhidraInfo>(`/entries/${entryId}/ghidra`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.analysis?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(a: NonNullable<GhidraInfo['analysis']>): { tone: StatusTone; text: string } {
  if (a.status === 'PENDING') {
    const retry = a.attempts > 0 && a.error ? ` ${t('retrying', { error: a.error })}` : '';
    return {
      tone: 'blue',
      text: (a.ahead ? t('queuedAhead', { n: a.ahead }) : t('queued')) + retry,
    };
  }
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: t('runningSince', { date: fmtDate(a.startedAt) }) };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: t('failed', { error: a.error ?? t('unknownErr') }) };
  return { tone: 'green', text: t('doneAt', { date: fmtDate(a.finishedAt) }) };
}

function DecompiledFunction({ fn }: { fn: GhidraFunction }) {
  const label = [
    fn.isEntryPoint ? t('entryPointLower') : null,
    fn.sensitive.length ? t('calls', { apis: fn.sensitive.join(', ') }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <details className="dl-static-strings dl-ghidra-fn">
      <summary>
        <code>{fn.name}</code> <span className="dl-hint-muted">{fn.entry}</span>
        {label && <> · {label}</>}
      </summary>
      {fn.callers.length > 0 && (
        <p className="dl-ghidra-fn__callers">{t('calledBy', { list: fn.callers.join(', ') })}</p>
      )}
      {fn.c ? (
        <>
          <div className="dl-ghidra-fn__tools">
            <CopyButton value={fn.c} label={t('pseudoCOf', { name: fn.name })} />
            {fn.truncated && <span className="dl-hint-muted"> {t('cut20k')}</span>}
          </div>
          <pre className="dl-doc-macros__code" aria-label={t('pseudoCOfCap', { name: fn.name })}>
            {fn.c}
          </pre>
        </>
      ) : (
        <p className="dl-static-empty">
          {t('decompileFailed', { error: fn.error ?? t('noReason') })}
        </p>
      )}
    </details>
  );
}

/**
 * Secao "Analise com o Ghidra" da aba Detalhes (item 7.3): sob demanda, so executaveis do Windows
 * e do Linux. Analistas pedem; quem ve a amostra ve o resultado; quem pode baixar a amostra baixa o
 * projeto .gzf (que tem os bytes dela).
 */
export function GhidraSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useGhidra(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.applicable && !info.analysis)) return null;
  const a = info.analysis;

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/ghidra`, {});
      await queryClient.invalidateQueries({ queryKey: ['ghidra', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = a?.status === 'PENDING' || a?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.eligible && !busy ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? 'Pedindo...' : a ? t('analyzeAgain') : t('analyzeGhidra')}
      </button>
    ) : null;

  if (!a) {
    return (
      <HpsmSection title={t('ghidraTitle')}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {!info.enabled ? t('ghidraOff') : info.reason ? info.reason : t('ghidraOnDemand')}{' '}
          {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(a);
  const s = a.summary;
  return (
    <HpsmSection title={t('ghidraTitle')}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label={t('sigState')} help={t('ghidraHelp')}>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('requestedBy')}>
          <HpsmReadonly>
            {t('byOn', { name: a.requestedBy?.displayName ?? '—', date: fmtDate(a.createdAt) })}
          </HpsmReadonly>
        </HpsmField>
        {s && (
          <>
            <HpsmField label={t('program')}>
              <HpsmReadonly>
                {[s.format, s.language, s.compiler].filter(Boolean).join(' · ')}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('functions')}>
              <HpsmReadonly>
                {t('fnCount', { functions: s.functions, thunks: s.thunks })}{' '}
                {s.sensitiveFunctions ? (
                  <StatusText tone="orange">
                    {t('sensitiveCount', { n: s.sensitiveFunctions })}
                  </StatusText>
                ) : (
                  t('noneSensitive')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('baseEntry')}>
              <HpsmReadonly>
                <code>{s.imageBase ?? '—'}</code> {t('entryLower')}{' '}
                <code>{s.entryPoint ?? '—'}</code>
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('project')} help={t('projectHelp')}>
              <HpsmReadonly>
                {a.hasProject && info.canDownload ? (
                  <a className="dl-link" href={`/api/entries/${entryId}/ghidra/project`} download>
                    {t('downloadProject', { size: formatFileSize(a.gzfSize ?? 0) })}
                  </a>
                ) : a.hasProject ? (
                  t('downloadWho')
                ) : (
                  (a.gzfError ?? '—')
                )}
              </HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('tool')}>
              <HpsmReadonly>
                Ghidra {a.version ?? '?'}
                {a.ms !== null && ` · ${Math.round(a.ms / 1000)} s`}
              </HpsmReadonly>
            </HpsmField>
          </>
        )}
      </HpsmForm>

      {s && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">{t('pseudoC', { n: s.decompiled.length })}</h4>
          <p className="dl-related-hint">{t('pseudoCHelp')}</p>
          {s.decompiled.map((fn) => (
            <DecompiledFunction key={fn.entry} fn={fn} />
          ))}
        </div>
      )}

      {s && s.largest.length > 0 && (
        <div className="dl-static-block">
          <h4 className="dl-static-title">{t('largestFns')}</h4>
          <TableContainer>
            <Table size="xs" aria-label={t('largestFnsAria')}>
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">{t('function')}</TableHeader>
                  <TableHeader scope="col">{t('address')}</TableHeader>
                  <TableHeader scope="col">{t('size')}</TableHeader>
                  <TableHeader scope="col">{t('complexity')}</TableHeader>
                  <TableHeader scope="col">{t('callsCalledBy')}</TableHeader>
                  <TableHeader scope="col">APIs</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {s.largest.slice(0, LARGEST_SHOWN).map((f) => (
                  <TableRow key={f.entry}>
                    <TableCell>
                      <code>{f.name}</code>
                    </TableCell>
                    <TableCell>
                      <code>{f.entry}</code>
                    </TableCell>
                    <TableCell>{formatFileSize(f.size)}</TableCell>
                    <TableCell>{f.complexity >= 0 ? f.complexity : '—'}</TableCell>
                    <TableCell>
                      {f.calls} / {f.callers}
                    </TableCell>
                    <TableCell>
                      <span title={f.apis.join('\n')}>
                        {f.apis.slice(0, 3).join(', ')}
                        {f.apis.length > 3 ? ` (+${f.apis.length - 3})` : ''}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </HpsmSection>
  );
}
