import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { OfficeInfo } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');
const TONE: Record<string, StatusTone> = { high: 'red', medium: 'orange', info: 'gray' };

/** Analise do oletools; atualiza a cada 5 s enquanto esta na fila ou rodando. */
export function useOffice(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['office', entryId],
    queryFn: () => api.get<OfficeInfo>(`/entries/${entryId}/office`),
    enabled,
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.analysis?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

function situation(a: NonNullable<OfficeInfo['analysis']>): { tone: StatusTone; text: string } {
  if (a.status === 'PENDING') return { tone: 'blue', text: t('queued') };
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: t('runningSince', { date: fmtDate(a.startedAt) }) };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: t('failed', { error: a.error ?? t('unknownErr') }) };
  const high = (a.alerts ?? []).some((x) => x.level === 'high');
  return {
    tone: high ? 'red' : 'green',
    text: `${high ? t('riskFindings') : t('nothingHighRisk')} · ${fmtDate(a.finishedAt)}${a.ms !== null ? ` (${(a.ms / 1000).toFixed(1)} s)` : ''}`,
  };
}

/**
 * Secao "Documento (oletools)" da aba Detalhes (item 7.14; revisao de novembro, 3.2): macros VBA
 * e XLM 4.0, o veredito do MacroRaptor, campos DDE, objetos de RTF e o codigo das macros. Roda
 * sozinho na chegada de todo documento do Office ou RTF; analistas pedem de novo.
 */
export function OfficeSection({ entryId, canTriage }: { entryId: string; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const query = useOffice(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info || (!info.eligible && !info.analysis)) return null;
  const analysis = info.analysis;

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/office`, {});
      await queryClient.invalidateQueries({ queryKey: ['office', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const busy = analysis?.status === 'PENDING' || analysis?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.eligible && !busy ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? t('requesting') : analysis ? t('analyzeAgain') : t('analyzeNow')}
      </button>
    ) : null;

  const title = t('officeTitle');
  if (!analysis) {
    return (
      <HpsmSection title={title}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled ? t('officeNotYet') : t('officeOff')} {button}
        </p>
      </HpsmSection>
    );
  }

  const state = situation(analysis);
  const vba = analysis.result?.vba;
  const raptor = vba?.mraptor;
  const dde = analysis.result?.dde?.links ?? [];
  const rtf = analysis.result?.rtf?.objects ?? [];
  const keywords = vba?.keywords ?? [];
  return (
    <HpsmSection title={title}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label={t('sigState')} help={t('officeHelp')}>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="MacroRaptor">
          <HpsmReadonly>
            {raptor ? (
              <StatusText tone={raptor.suspicious ? 'red' : 'green'}>
                {raptor.suspicious ? t('suspicious') : t('noRiskCombo')} ({raptor.flags})
              </StatusText>
            ) : vba?.macros ? (
              '—'
            ) : (
              t('noVba')
            )}
          </HpsmReadonly>
        </HpsmField>
        {analysis.result?.decrypted && (
          <HpsmField label={t('officeEncrypted')} wide>
            <HpsmReadonly>
              {analysis.result.decrypted.password ? (
                <>
                  <StatusText tone="orange">
                    {t('officeDecrypted', { password: analysis.result.decrypted.password })}
                  </StatusText>{' '}
                  {analysis.result.decrypted.entryId && (
                    <Link className="dl-link" to={`/entries/${analysis.result.decrypted.entryId}`}>
                      {t('officeDecryptedLink')}
                    </Link>
                  )}
                </>
              ) : (
                t('officeNotDecrypted')
              )}
            </HpsmReadonly>
          </HpsmField>
        )}
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
        {dde.length > 0 && (
          <HpsmField label={t('ddeFields')} wide top>
            <ul className="dl-office__list">
              {dde.map((link, i) => (
                <li key={i} className="dl-mono">
                  {link}
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
        {rtf.length > 0 && (
          <HpsmField label={t('rtfObjects')} wide top>
            <ul className="dl-office__list">
              {rtf.map((o, i) => (
                <li key={i}>
                  {o.className ?? t('noClass')}
                  {o.filename ? ` · ${o.filename}` : ''}
                  {o.size ? ` · ${o.size} bytes` : ''}
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
      </HpsmForm>
      {keywords.length > 0 && (
        <table className="dl-risk__reasons" aria-label={t('macroKeywordsAria')}>
          <thead>
            <tr>
              <th scope="col">{t('type')}</th>
              <th scope="col">{t('keyword')}</th>
              <th scope="col">{t('description')}</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k, i) => (
              <tr key={i}>
                <td>{k.type}</td>
                <td className="dl-mono">{k.keyword}</td>
                <td>{k.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(vba?.xlmResolved ?? []).length > 0 && (
        <details className="dl-office__code" open>
          <summary>{t('xlmResolved', { n: vba!.xlmResolved!.length })}</summary>
          <pre>
            {vba!.xlmResolved!.map((r) => `${r.cell.padEnd(12)} ${r.formula ?? ''}`).join('\n')}
          </pre>
        </details>
      )}
      {(vba?.xlmLines ?? []).length > 0 && (
        <details className="dl-office__code">
          <summary>{t('xlmMacros', { n: vba!.xlmLines.length })}</summary>
          <pre>{vba!.xlmLines.join('\n')}</pre>
        </details>
      )}
      {(vba?.modules ?? []).map((m, i) => (
        <details key={i} className="dl-office__code">
          <summary>
            {m.name ?? t('moduleN', { n: i + 1 })} · {t('lineCount', { n: m.lines })}
            {m.truncated ? ` ${t('showingStart')}` : ''}
          </summary>
          <pre>{m.code}</pre>
        </details>
      ))}
    </HpsmSection>
  );
}
