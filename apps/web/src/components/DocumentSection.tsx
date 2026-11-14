import { useState } from 'react';

import type { DocumentInfo, StaticInfo } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

const FORMAT: Record<DocumentInfo['format'], string> = localized(() => ({
  pdf: 'PDF',
  ooxml: 'Office (OOXML)',
  ole: t('fmtOle'),
  rtf: 'RTF',
}));

const RISK: Record<DocumentInfo['risk'], { label: string; tone: StatusTone }> = localized(() => ({
  high: { label: t('riskHigh'), tone: 'red' },
  medium: { label: t('riskMedium'), tone: 'orange' },
  low: { label: t('riskLow'), tone: 'green' },
}));

const LEVEL_TONE: Record<DocumentInfo['alerts'][number]['level'], StatusTone> = {
  high: 'red',
  medium: 'orange',
  info: 'blue',
};

/** Aviso no topo da ficha: documento com risco alto (macro que roda ao abrir, JavaScript...). */
export function DocumentWarning({ info }: { info?: StaticInfo | null }) {
  const doc = info?.document;
  if (!doc || doc.risk !== 'high') return null;
  const first = doc.alerts.find((a) => a.level === 'high');
  return <HpsmMessage kind="warning">{t('docWarn', { alert: first?.text })}</HpsmMessage>;
}

/**
 * Secao "Documento" (item 70): alertas do PDF/Office/RTF, macros VBA com o
 * codigo (so texto), links e objetos embutidos. Nada foi executado.
 */
export function DocumentSection({ info }: { info?: StaticInfo | null }) {
  const doc = info?.document;
  const [open, setOpen] = useState<string | null>(null);
  if (!doc) return null;
  const office = doc.office;
  return (
    <HpsmSection title={t('docTitle', { format: FORMAT[doc.format] })}>
      <HpsmForm columns={2}>
        <HpsmField label={t('risk')}>
          <HpsmReadonly>
            <StatusText tone={RISK[doc.risk].tone}>{RISK[doc.risk].label}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        {doc.pdf?.pages && (
          <HpsmField label={t('pages')}>
            <HpsmReadonly>{doc.pdf.pages}</HpsmReadonly>
          </HpsmField>
        )}
        <HpsmField label={t('alerts')} wide top>
          {doc.alerts.length === 0 ? (
            <HpsmReadonly>{t('noActiveContent')}</HpsmReadonly>
          ) : (
            <ul className="dl-doc-alerts">
              {doc.alerts.map((a) => (
                <li key={a.text}>
                  <StatusText tone={LEVEL_TONE[a.level]}>{a.text}</StatusText>
                </li>
              ))}
            </ul>
          )}
        </HpsmField>
        {doc.links.length > 0 && (
          <HpsmField label={`Links (${doc.links.length})`} wide top help={t('textOnlyHelp')}>
            <HpsmReadonly multiline mono copyable={{ value: doc.links.join('\n'), label: 'links' }}>
              {doc.links.join('\n')}
            </HpsmReadonly>
          </HpsmField>
        )}
        {office && office.embedded.length > 0 && (
          <HpsmField label={t('embeddedObjects')} wide top>
            <HpsmReadonly multiline mono>
              {office.embedded.join('\n')}
            </HpsmReadonly>
          </HpsmField>
        )}
      </HpsmForm>
      {office && office.modules.length > 0 && (
        <div className="dl-doc-macros">
          <h3 className="dl-doc-macros__head">{t('vbaMacros', { n: office.modules.length })}</h3>
          <ul>
            {office.modules.map((m) => (
              <li key={m.name}>
                <div className="dl-doc-macros__row">
                  <span className="dl-mono">{m.name}</span>
                  <span className="dl-doc-macros__meta">{t('lineCount', { n: m.lines })}</span>
                  {m.autoExec.length > 0 && (
                    <StatusText tone="red">
                      {t('runsOnOpen', { list: m.autoExec.join(', ') })}
                    </StatusText>
                  )}
                  {m.suspicious.length > 0 && (
                    <StatusText tone="orange">{m.suspicious.join(', ')}</StatusText>
                  )}
                  <button
                    type="button"
                    className="dl-link-button"
                    aria-expanded={open === m.name}
                    onClick={() => setOpen(open === m.name ? null : m.name)}
                  >
                    {open === m.name ? t('hideCode') : t('showCode')}
                  </button>
                </div>
                {open === m.name && (
                  <pre
                    className="dl-doc-macros__code"
                    aria-label={t('moduleCode', { name: m.name })}
                  >
                    {m.code}
                    {m.truncated ? `\n… ${t('cut')}` : ''}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </HpsmSection>
  );
}
