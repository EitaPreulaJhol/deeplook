import { Link } from 'react-router-dom';

import type { EmailInfo, EmailParty } from '../api/types';
import { intlLocale } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(intlLocale()) : '—';
}

function partyText(p: EmailParty | null): string {
  if (!p) return '—';
  if (p.name && p.address) return `${p.name} <${p.address}>`;
  return p.address ?? p.name ?? '—';
}

/** pass = verde; fail/softfail = vermelho; none/neutral/ausente = cinza. */
function authTone(result: string | null): StatusTone {
  if (result === 'pass') return 'green';
  if (result === 'fail' || result === 'softfail' || result === 'permerror') return 'red';
  if (result === 'temperror') return 'orange';
  return 'gray';
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Secoes "E-mail" e "Anexos" da ficha (item 54): cabecalhos, autenticacao,
 * caminho dos servidores, links (como texto, nunca clicaveis) e o corpo em
 * texto. Cada anexo e uma amostra propria.
 */
export function EmailSection({ info }: { info: EmailInfo }) {
  const domainOf = (p: EmailParty | null) => p?.address?.split('@')[1]?.toLowerCase() ?? null;
  const replyDiffers =
    info.replyTo.length > 0 && info.replyTo.some((r) => domainOf(r) !== domainOf(info.from));
  return (
    <>
      <HpsmSection title="E-mail">
        <HpsmForm columns={2}>
          <HpsmField label={t('subject')} wide>
            <HpsmReadonly>{info.subject ?? '—'}</HpsmReadonly>
          </HpsmField>
          <HpsmField label={t('from')}>
            <HpsmReadonly mono>{partyText(info.from)}</HpsmReadonly>
          </HpsmField>
          <HpsmField label={t('replyTo')}>
            <HpsmReadonly mono>
              {info.replyTo.length ? info.replyTo.map(partyText).join(', ') : '—'}
              {replyDiffers && (
                <>
                  {' '}
                  <StatusText tone="orange">{t('differentDomain')}</StatusText>
                </>
              )}
            </HpsmReadonly>
          </HpsmField>
          <HpsmField label={t('to')} wide>
            <HpsmReadonly mono>
              {info.to.length ? info.to.map(partyText).join(', ') : '—'}
            </HpsmReadonly>
          </HpsmField>
          {info.cc.length > 0 && (
            <HpsmField label="Cc" wide>
              <HpsmReadonly mono>{info.cc.map(partyText).join(', ')}</HpsmReadonly>
            </HpsmField>
          )}
          <HpsmField label={t('date')}>
            <HpsmReadonly>{fmtDate(info.date)}</HpsmReadonly>
          </HpsmField>
          <HpsmField label="Message-ID">
            <HpsmReadonly mono>{info.messageId ?? '—'}</HpsmReadonly>
          </HpsmField>
          <HpsmField label={t('authentication')} wide>
            <HpsmReadonly>
              <span className="dl-email-auth">
                {(['spf', 'dkim', 'dmarc'] as const).map((k) => (
                  <span key={k}>
                    {k.toUpperCase()}:{' '}
                    <StatusText tone={authTone(info.auth[k])}>
                      {info.auth[k] ?? 'ausente'}
                    </StatusText>
                  </span>
                ))}
              </span>
            </HpsmReadonly>
          </HpsmField>
          {info.received.length > 0 && (
            <HpsmField label={t('path')} wide top>
              <ol className="dl-email-hops" aria-label={t('serversAria')}>
                {info.received.map((hop, i) => (
                  <li key={i}>
                    <span className="dl-mono">{hop.from ?? '?'}</span> →{' '}
                    <span className="dl-mono">{hop.by ?? '?'}</span>
                    {hop.date && (
                      <span className="dl-email-hops__date"> · {fmtDate(hop.date)}</span>
                    )}
                  </li>
                ))}
              </ol>
            </HpsmField>
          )}
          {info.links.length > 0 && (
            <HpsmField label={`Links (${info.links.length})`} wide top help={t('linksHelp')}>
              <HpsmReadonly
                multiline
                mono
                copyable={{ value: info.links.join('\n'), label: 'links' }}
              >
                {info.links.join('\n')}
              </HpsmReadonly>
            </HpsmField>
          )}
          <HpsmField
            label={t('body')}
            wide
            top
            help={info.bodyTruncated ? t('bodyTruncated') : t('bodyText')}
          >
            <HpsmReadonly multiline>
              <span className="dl-email-body">{info.body || t('empty')}</span>
            </HpsmReadonly>
          </HpsmField>
        </HpsmForm>
      </HpsmSection>
      {info.attachments.length > 0 && (
        <HpsmSection title={t('attachments', { n: info.attachments.length })}>
          <ul className="dl-email-attachments">
            {info.attachments.map((a, i) => (
              <li key={`${a.filename}-${i}`}>
                {a.entryId ? (
                  <Link className="dl-link" to={`/entries/${a.entryId}`}>
                    {a.filename}
                  </Link>
                ) : (
                  <span>{a.filename}</span>
                )}{' '}
                <span className="dl-email-attachments__meta">
                  {a.mimeType} · {fmtSize(a.size)}
                </span>
                {a.skipped && (
                  <>
                    {' '}
                    <StatusText tone="gray">{t('notSubmitted', { reason: a.skipped })}</StatusText>
                  </>
                )}
              </li>
            ))}
          </ul>
        </HpsmSection>
      )}
    </>
  );
}
