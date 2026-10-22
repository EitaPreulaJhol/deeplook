import { Theme } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { Entry, EntryEvent } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { describeEvent } from '../components/EntryHistoryTab';
import { formatFileSize } from '../components/HpsmFileDrop';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPrint } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { StatusTag, TypeTag, VerdictTag } from '../components/tags';

function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

/** Linha "rotulo: valor" da tabela de dados. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/**
 * Ficha para impressao da amostra (menu "Mais" > Imprimir ficha), fora da casca:
 * dados, relatorios publicados e historico de uma vez, com "Impresso por / em".
 * Nada do ambiente isolado (console, credenciais) entra na ficha. Com `?auto=1`
 * abre a caixa de impressao assim que carrega.
 */
export function EntryPrintPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const printedAt = useRef(new Date().toISOString());

  const entryQuery = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<{ entry: Entry }>(`/entries/${id}`),
  });
  const eventsQuery = useQuery({
    queryKey: ['entry', id, 'events'],
    queryFn: () => api.get<{ events: EntryEvent[] }>(`/entries/${id}/events`),
  });

  const entry = entryQuery.data?.entry;
  const events = eventsQuery.data?.events;
  const ready = Boolean(entry && events);

  useEffect(() => {
    if (entry) document.title = `Ficha — ${entry.title}`;
  }, [entry]);

  // Impressao automatica (uma vez) quando tudo carregou.
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current || searchParams.get('auto') !== '1') return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [ready, searchParams]);

  let body: ReactNode;
  if (entryQuery.isLoading || eventsQuery.isLoading) {
    body = <HpsmLoading text="Preparando a ficha..." />;
  } else if (!entry || !events) {
    body = <HpsmMessage kind="error">Amostra não encontrada.</HpsmMessage>;
  } else {
    const published = (entry.reports ?? []).filter((r) => r.published);
    body = (
      <>
        <section className="dl-print__section">
          <h2>Dados da amostra</h2>
          <table className="dl-print__kv">
            <tbody>
              <Row label="ID">{entry.id}</Row>
              <Row label="Tipo">
                <TypeTag type={entry.type} />
              </Row>
              <Row label="Status">
                <StatusTag status={entry.status} />
              </Row>
              <Row label="Veredito">
                <VerdictTag verdict={entry.verdict} />
              </Row>
              <Row label="Responsável">{entry.assignee?.displayName ?? '—'}</Row>
              <Row label="Enviado por">
                {entry.owner.displayName} ({entry.owner.email})
              </Row>
              <Row label="Enviado em">{fmtDate(entry.createdAt)}</Row>
              <Row label="No status desde">{fmtDate(entry.statusChangedAt)}</Row>
              {entry.duplicateOf && (
                <Row label="Duplicata de">
                  {entry.duplicateOf.title} ({entry.duplicateOf.id})
                </Row>
              )}
              {(entry._count?.duplicates ?? 0) > 0 && (
                <Row label="Duplicatas">{entry._count?.duplicates}</Row>
              )}
              {entry.type === 'FILE' ? (
                <>
                  <Row label="Arquivo">
                    {entry.originalFilename ?? '—'} ({formatFileSize(entry.fileSize)})
                  </Row>
                  <Row label="Tipo MIME">{entry.mimeType ?? '—'}</Row>
                  {entry.staticInfo?.detectedType && (
                    <Row label="Tipo real">
                      {entry.staticInfo.detectedType.label}
                      {entry.staticInfo.extensionMismatch?.dangerous &&
                        ` (executável disfarçado de .${entry.staticInfo.extensionMismatch.declared})`}
                    </Row>
                  )}
                  {entry.staticInfo && (
                    <Row label="Entropia">{entry.staticInfo.entropy.toFixed(2)} de 8</Row>
                  )}
                  <Row label="SHA-256">
                    <span className="dl-print__mono">{entry.sha256 ?? '—'}</span>
                  </Row>
                </>
              ) : (
                <Row label="URL">
                  <span className="dl-print__mono">{entry.url}</span>
                </Row>
              )}
              <Row label="Tags">{entry.tags.map((t) => t.name).join(', ') || '—'}</Row>
            </tbody>
          </table>
          <h3>Descrição</h3>
          <p className="dl-print__text">{entry.description || '—'}</p>
        </section>

        <section className="dl-print__section">
          <h2>Relatórios publicados ({published.length})</h2>
          {published.length === 0 && <p>Nenhum relatório publicado.</p>}
          {published.map((report) => (
            <article key={report.id} className="dl-print__report">
              <h3>
                {report.analyst.displayName} — {fmtDate(report.createdAt)} — Veredito:{' '}
                <VerdictTag verdict={report.verdict} />
              </h3>
              <h4>Resumo</h4>
              <p className="dl-print__text">{report.summary}</p>
              {report.findings && (
                <>
                  <h4>Achados</h4>
                  <p className="dl-print__text">{report.findings}</p>
                </>
              )}
              {report.iocs && (
                <>
                  <h4>IOCs</h4>
                  <p className="dl-print__text dl-print__mono">{report.iocs}</p>
                </>
              )}
            </article>
          ))}
        </section>

        <section className="dl-print__section">
          <h2>Histórico ({events.length})</h2>
          <table className="dl-print__grid">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Usuário</th>
                <th scope="col">Evento</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{fmtDate(event.createdAt)}</td>
                  <td>{event.actor?.displayName ?? 'Sistema'}</td>
                  <td>
                    {describeEvent(event)}
                    {event.type === 'COMMENT' && (
                      <span className="dl-print__text">: {event.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </>
    );
  }

  return (
    <Theme theme="g10">
      <div className="dl-print">
        <div className="dl-print__toolbar">
          <HpsmToolbar label="Ações da ficha">
            <HpsmToolbarButton
              label="Imprimir"
              icon={IconPrint}
              disabled={!ready}
              onClick={() => window.print()}
            />
            <HpsmToolbarButton label="Fechar" onClick={() => window.close()} />
          </HpsmToolbar>
        </div>

        <header className="dl-print__head">
          <img src="/icons/magnifier.svg" alt="" className="dl-print__logo" />
          <div>
            <div className="dl-print__brand">DeepLook — Ficha da amostra</div>
            <h1 className="dl-print__title">{entry?.title ?? 'Amostra'}</h1>
          </div>
          <div className="dl-print__meta">
            Impresso por {user?.displayName ?? '—'}
            <br />
            em {fmtDate(printedAt.current)}
          </div>
        </header>

        {body}

        <footer className="dl-print__foot">
          Atenção: esta amostra pode ser maliciosa. Manuseie arquivos e links apenas em ambiente
          isolado.
        </footer>
      </div>
    </Theme>
  );
}
