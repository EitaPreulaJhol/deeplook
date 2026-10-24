import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from './HpsmToolbar';
import { IconScreen } from './icons';
import { HpsmLoading, HpsmMessage } from './messages';
import { StatusText } from './tags';

interface Capture {
  id: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  url: string;
  finalUrl: string | null;
  title: string | null;
  httpStatus: number | null;
  redirects: { url: string; status: number | null }[] | null;
  certificate: {
    subject: string | null;
    issuer: string | null;
    protocol: string | null;
    validFrom: string | null;
    validTo: string | null;
  } | null;
  blocked: { host: string; reason: string }[] | null;
  htmlTruncated: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  requestedBy: { id: string; displayName: string } | null;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/** Data do certificado (dia), com aviso se ja venceu. */
function certDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

/**
 * Captura da pagina (item 80): o analista pede e um navegador isolado (sem
 * acesso a rede interna) abre o link e guarda print, HTML, redirecionamentos e
 * certificado. Nenhum endereco vira link clicavel; o HTML so e baixado como
 * texto.
 */
export function PageCaptureSection({
  entryId,
  canTriage,
}: {
  entryId: string;
  canTriage: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['entry', entryId, 'captures'];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      api.get<{ captures: Capture[]; enabled: boolean }>(`/entries/${entryId}/captures`),
    // Enquanto houver captura em andamento, confere a cada 2 s.
    refetchInterval: (q) =>
      q.state.data?.captures.some((c) => c.status === 'PENDING') ? 2000 : false,
  });
  const [error, setError] = useState<string | null>(null);
  const captures = query.data?.captures ?? [];
  const enabled = query.data?.enabled ?? false;
  const running = captures.some((c) => c.status === 'PENDING');
  const latest = captures[0];

  if (!query.data && !query.isLoading) return null;
  if (query.data && !enabled && captures.length === 0) return null;

  const start = async () => {
    setError(null);
    try {
      await api.post(`/entries/${entryId}/capture`);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <HpsmSection title="Captura da página" className="dl-mt-lg">
      {canTriage && enabled && (
        <HpsmToolbar label="Ações da captura">
          <HpsmToolbarButton
            label={
              running ? 'Capturando...' : captures.length ? 'Capturar de novo' : 'Capturar página'
            }
            title="Abre o link num navegador isolado, sem acesso à rede interna"
            icon={IconScreen}
            disabled={running}
            onClick={() => void start()}
          />
        </HpsmToolbar>
      )}
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text="Carregando capturas..." />}
      {captures.length === 0 && enabled && (
        <p className="dl-static-empty">
          Nenhuma captura.{' '}
          {canTriage
            ? '"Capturar página" abre o link num navegador isolado, sem acesso à rede interna, e guarda o print, o HTML, os redirecionamentos e o certificado.'
            : 'Um analista pode capturar a página.'}
        </p>
      )}
      {latest && (
        <div className="dl-capture">
          {latest.status === 'PENDING' && (
            <HpsmLoading text="Abrindo a página no navegador isolado..." />
          )}
          {latest.status === 'FAILED' && (
            <HpsmMessage kind="error">
              Captura de {fmtDate(latest.createdAt)} falhou: {latest.error ?? 'motivo desconhecido'}
              .
            </HpsmMessage>
          )}
          {latest.status === 'DONE' && (
            <div className="dl-capture__grid">
              <a
                className="dl-capture__shot"
                href={`/api/captures/${latest.id}/screenshot`}
                target="_blank"
                rel="noreferrer"
                title="Abrir o print inteiro em nova aba"
              >
                <img
                  src={`/api/captures/${latest.id}/screenshot`}
                  alt={`Print da página: ${latest.title ?? latest.url}`}
                />
              </a>
              <HpsmForm>
                <HpsmField label="Capturada em">
                  <HpsmReadonly>
                    {fmtDate(latest.finishedAt)} por {latest.requestedBy?.displayName ?? '—'}
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField label="Título">
                  <HpsmReadonly>{latest.title || '—'}</HpsmReadonly>
                </HpsmField>
                <HpsmField label="Endereço final">
                  <HpsmReadonly
                    mono
                    copyable={
                      latest.finalUrl
                        ? { value: latest.finalUrl, label: 'endereço final' }
                        : undefined
                    }
                  >
                    {latest.finalUrl ?? '—'}
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField label="Resposta">
                  <HpsmReadonly>
                    <StatusText
                      tone={latest.httpStatus && latest.httpStatus < 400 ? 'green' : 'orange'}
                    >
                      HTTP {latest.httpStatus ?? '—'}
                    </StatusText>
                  </HpsmReadonly>
                </HpsmField>
                <HpsmField
                  label={`Redirecionamentos (${Math.max(0, (latest.redirects?.length ?? 1) - 1)})`}
                  top
                >
                  <ol className="dl-capture__chain">
                    {(latest.redirects ?? []).map((r, i) => (
                      <li key={i}>
                        <span className="dl-mono">{r.url}</span>{' '}
                        <span className="dl-hint-muted">({r.status ?? '—'})</span>
                      </li>
                    ))}
                  </ol>
                </HpsmField>
                <HpsmField label="Certificado" top>
                  {latest.certificate ? (
                    <HpsmReadonly>
                      {latest.certificate.subject ?? '—'} · emitido por{' '}
                      {latest.certificate.issuer ?? '—'} · {latest.certificate.protocol ?? ''} ·
                      válido de {certDate(latest.certificate.validFrom)} a{' '}
                      {certDate(latest.certificate.validTo)}
                      {latest.certificate.validTo &&
                        new Date(latest.certificate.validTo) < new Date() && (
                          <StatusText tone="red"> (vencido)</StatusText>
                        )}
                    </HpsmReadonly>
                  ) : (
                    <HpsmReadonly>Sem HTTPS (página aberta em HTTP).</HpsmReadonly>
                  )}
                </HpsmField>
                {(latest.blocked?.length ?? 0) > 0 && (
                  <HpsmField label={`Bloqueados (${latest.blocked!.length})`} top>
                    <ul className="dl-capture__blocked">
                      {latest.blocked!.map((b) => (
                        <li key={b.host} title={b.reason}>
                          <span className="dl-mono">{b.host}</span>{' '}
                          <span className="dl-hint-muted">— {b.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </HpsmField>
                )}
                <HpsmField label="HTML">
                  <HpsmReadonly>
                    <a className="dl-link" href={`/api/captures/${latest.id}/html`}>
                      Baixar HTML (texto)
                    </a>
                    {latest.htmlTruncated && (
                      <span className="dl-hint-muted"> — cortado em 2 MB</span>
                    )}
                  </HpsmReadonly>
                </HpsmField>
              </HpsmForm>
            </div>
          )}
          {captures.length > 1 && (
            <details className="dl-capture__older">
              <summary>Capturas anteriores ({captures.length - 1})</summary>
              <ul>
                {captures.slice(1).map((c) => (
                  <li key={c.id}>
                    {fmtDate(c.createdAt)} — {c.requestedBy?.displayName ?? '—'} —{' '}
                    {c.status === 'DONE' ? (
                      <>
                        HTTP {c.httpStatus ?? '—'} ·{' '}
                        <a
                          className="dl-link"
                          href={`/api/captures/${c.id}/screenshot`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          print
                        </a>{' '}
                        ·{' '}
                        <a className="dl-link" href={`/api/captures/${c.id}/html`}>
                          HTML (texto)
                        </a>
                      </>
                    ) : c.status === 'FAILED' ? (
                      `falhou: ${c.error ?? '—'}`
                    ) : (
                      'em andamento'
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </HpsmSection>
  );
}
