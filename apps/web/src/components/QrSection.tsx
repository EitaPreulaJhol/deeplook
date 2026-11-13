import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

/** Um QR code lido (plano pos-revisao, item 2.2). */
export interface QrCode {
  text: string;
  truncated: boolean;
  source: 'image' | 'pdf' | 'screenshot';
  page: number | null;
  /** O texto como endereco http(s), ou null. */
  url: string | null;
}

export interface QrInfo {
  enabled: boolean;
  applicable: boolean;
  ready: boolean;
  scan: {
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    codes: QrCode[] | null;
    pages: number | null;
    error: string | null;
    ms: number | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale()) : '—');

/** A leitura de QR code; atualiza a cada 5 s enquanto esta na fila ou rodando. */
export function useQr(entryId: string) {
  return useQuery({
    queryKey: ['qr', entryId],
    queryFn: () => api.get<QrInfo>(`/entries/${entryId}/qr`),
    staleTime: 3000,
    refetchInterval: (q) => {
      const status = q.state.data?.scan?.status;
      return status === 'PENDING' || status === 'RUNNING' ? 5000 : false;
    },
  });
}

/** Os enderecos lidos (vao para os IOCs sugeridos). */
export const qrUrls = (info?: QrInfo) =>
  (info?.scan?.codes ?? []).map((c) => c.url).filter((u): u is string => Boolean(u));

function where(code: QrCode): string {
  if (code.source === 'pdf') return t('qrFromPdfPage', { page: code.page ?? '?' });
  if (code.source === 'screenshot') return t('qrFromScreenshot');
  return t('qrFromImage');
}

/**
 * Secao "QR codes" da aba Detalhes: o que o leitor achou na imagem, nas paginas do PDF ou no print
 * da pagina capturada. Enderecos viram IOCs sugeridos e podem ser analisados como amostra de link.
 */
export function QrSection({ entry, canTriage }: { entry: Entry; canTriage: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQr(entry.id);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const info = query.data;
  if (!info || (!info.applicable && !info.scan)) return null;
  const scan = info.scan;

  const request = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entry.id}/qr`, {});
      await queryClient.invalidateQueries({ queryKey: ['qr', entry.id] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };
  // Analisar o link do QR code: uma amostra de link nova, que cita a de origem.
  const analyze = async (url: string) => {
    setError(null);
    setSending(url);
    try {
      const res = await api.post<{ entry: Entry }>('/entries/url', {
        url,
        title: url,
        description: t('qrLinkDescription', { title: entry.title, id: entry.id }),
      });
      navigate(`/entries/${res.entry.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSending(null);
    }
  };

  const busy = scan?.status === 'PENDING' || scan?.status === 'RUNNING';
  const button =
    canTriage && info.enabled && info.ready && !busy ? (
      <button type="button" className="dl-link-button" disabled={asking} onClick={request}>
        {asking ? t('requesting') : scan ? t('analyzeAgain') : t('analyzeNow')}
      </button>
    ) : null;

  const title = t('qrTitle');
  if (!scan) {
    return (
      <HpsmSection title={title}>
        {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
        <p className="dl-static-empty">
          {!info.enabled ? t('qrOff') : info.ready ? t('qrNotYet') : t('qrCaptureFirst')} {button}
        </p>
      </HpsmSection>
    );
  }

  const codes = scan.codes ?? [];
  const state: { tone: StatusTone; text: string } =
    scan.status === 'PENDING'
      ? { tone: 'blue', text: t('queued') }
      : scan.status === 'RUNNING'
        ? { tone: 'blue', text: t('qrReading') }
        : scan.status === 'FAILED'
          ? { tone: 'orange', text: t('failed', { error: scan.error ?? t('unknownErr') }) }
          : {
              tone: codes.some((c) => c.url) ? 'orange' : 'green',
              text: `${codes.length ? t('qrFound', { n: codes.length }) : t('qrNone')} · ${fmtDate(scan.finishedAt)}`,
            };
  return (
    <HpsmSection title={title}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm>
        <HpsmField label={t('sigState')} help={t('qrHelp')}>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.text}</StatusText> {button}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
      {codes.length > 0 && (
        <table className="dl-risk__reasons" aria-label={t('qrCodesAria')}>
          <thead>
            <tr>
              <th scope="col">{t('qrContent')}</th>
              <th scope="col">{t('qrWhere')}</th>
              <th scope="col">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code, i) => (
              <tr key={i}>
                <td className="dl-mono dl-qr__text">
                  {code.text}
                  {code.truncated ? ` ${t('qrTruncated')}` : ''}
                </td>
                <td>{where(code)}</td>
                <td>
                  {code.url ? (
                    <button
                      type="button"
                      className="dl-link-button"
                      disabled={sending !== null}
                      onClick={() => void analyze(code.url!)}
                    >
                      {sending === code.url ? t('qrSending') : t('qrAnalyzeLink')}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HpsmSection>
  );
}
