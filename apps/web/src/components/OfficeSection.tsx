import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { OfficeInfo } from '../api/types';
import { intlLocale } from '../i18n';
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
  if (a.status === 'PENDING') return { tone: 'blue', text: 'Na fila' };
  if (a.status === 'RUNNING')
    return { tone: 'blue', text: `Analisando desde ${fmtDate(a.startedAt)}` };
  if (a.status === 'FAILED')
    return { tone: 'orange', text: `Falhou: ${a.error ?? 'erro desconhecido'}` };
  const high = (a.alerts ?? []).some((x) => x.level === 'high');
  return {
    tone: high ? 'red' : 'green',
    text: `${high ? 'Achados de risco' : 'Nada de alto risco'} · ${fmtDate(a.finishedAt)}${a.ms !== null ? ` (${(a.ms / 1000).toFixed(1)} s)` : ''}`,
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
        {asking ? 'Pedindo...' : analysis ? 'Analisar de novo' : 'Analisar agora'}
      </button>
    ) : null;

  const title = 'Documento (oletools)';
  if (!analysis) {
    return (
      <HpsmSection title={title}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {info.enabled
            ? 'Ainda não analisado (documento enviado antes do oletools, ou acima do teto).'
            : 'A análise de documentos está desligada (OLETOOLS_URL vazio).'}{' '}
          {button}
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
        <HpsmField
          label="Situação"
          help="olevba, MacroRaptor, msodde, oleid e rtfobj num contêiner sem rede. Só lê: nenhuma macro é executada."
        >
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="MacroRaptor">
          <HpsmReadonly>
            {raptor ? (
              <StatusText tone={raptor.suspicious ? 'red' : 'green'}>
                {raptor.suspicious ? 'Suspeita' : 'Sem combinação de risco'} ({raptor.flags})
              </StatusText>
            ) : vba?.macros ? (
              '—'
            ) : (
              'Sem macros VBA'
            )}
          </HpsmReadonly>
        </HpsmField>
        {(analysis.alerts ?? []).length > 0 && (
          <HpsmField label="Alertas" wide top>
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
          <HpsmField label="Campos DDE" wide top>
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
          <HpsmField label="Objetos no RTF" wide top>
            <ul className="dl-office__list">
              {rtf.map((o, i) => (
                <li key={i}>
                  {o.className ?? 'sem classe'}
                  {o.filename ? ` · ${o.filename}` : ''}
                  {o.size ? ` · ${o.size} bytes` : ''}
                </li>
              ))}
            </ul>
          </HpsmField>
        )}
      </HpsmForm>
      {keywords.length > 0 && (
        <table className="dl-risk__reasons" aria-label="Palavras-chave das macros">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Palavra-chave</th>
              <th scope="col">Descrição</th>
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
      {(vba?.xlmLines ?? []).length > 0 && (
        <details className="dl-office__code">
          <summary>Macros XLM 4.0 ({vba!.xlmLines.length} linha(s))</summary>
          <pre>{vba!.xlmLines.join('\n')}</pre>
        </details>
      )}
      {(vba?.modules ?? []).map((m, i) => (
        <details key={i} className="dl-office__code">
          <summary>
            {m.name ?? `Módulo ${i + 1}`} · {m.lines} linha(s)
            {m.truncated ? ' (mostrando o começo)' : ''}
          </summary>
          <pre>{m.code}</pre>
        </details>
      ))}
    </HpsmSection>
  );
}
