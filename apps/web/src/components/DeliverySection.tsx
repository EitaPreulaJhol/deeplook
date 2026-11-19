import { Link } from 'react-router-dom';

import type { DeliveryInfo, StaticInfo } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import { StatusText, type StatusTone } from './tags';

const TITLE: Record<DeliveryInfo['format'], () => string> = {
  onenote: () => t('dlvTitleOnenote'),
  html: () => t('dlvTitleHtml'),
  msi: () => t('dlvTitleMsi'),
  pdf: () => t('dlvTitlePdf'),
  msc: () => t('dlvTitleMsc'),
  url: () => t('dlvTitleUrl'),
  scf: () => t('dlvTitleScf'),
  'library-ms': () => t('dlvTitleLibrary'),
  'search-ms': () => t('dlvTitleSearch'),
  appinstaller: () => t('dlvTitleAppinstaller'),
  iqy: () => t('dlvTitleIqy'),
  slk: () => t('dlvTitleSlk'),
  reg: () => t('dlvTitleReg'),
  inf: () => t('dlvTitleInf'),
  sct: () => t('dlvTitleSct'),
  settingcontent: () => t('dlvTitleSettings'),
};

const RISK: Record<DeliveryInfo['risk'], { label: string; tone: StatusTone }> = localized(() => ({
  high: { label: t('riskHigh'), tone: 'red' },
  medium: { label: t('riskMedium'), tone: 'orange' },
  low: { label: t('riskLow'), tone: 'green' },
}));

const LEVEL_TONE: Record<DeliveryInfo['alerts'][number]['level'], StatusTone> = {
  high: 'red',
  medium: 'orange',
  info: 'blue',
};

const fmtSize = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} MB`
    : n >= 1024
      ? `${(n / 1024).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} KB`
      : `${n} B`;

/** Aviso no topo da ficha: carga escondida de risco alto (OneNote, HTML smuggling, MSI). */
export function DeliveryWarning({ info }: { info?: StaticInfo | null }) {
  const d = info?.delivery;
  if (!d || d.risk !== 'high') return null;
  const first = d.alerts.find((a) => a.level === 'high');
  return <HpsmMessage kind="warning">{t('dlvWarn', { alert: first?.text })}</HpsmMessage>;
}

/**
 * OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4): os alertas, o que estava escondido
 * (cada arquivo leva a amostra filha) e, no MSI, o produto e as acoes personalizadas. So texto:
 * nada foi executado.
 */
export function DeliverySection({ info }: { info?: StaticInfo | null }) {
  const d = info?.delivery;
  if (!d) return null;
  const msi = d.msi;
  return (
    <HpsmSection title={TITLE[d.format]()}>
      <HpsmForm columns={2}>
        <HpsmField label={t('risk')}>
          <HpsmReadonly>
            <StatusText tone={RISK[d.risk].tone}>{RISK[d.risk].label}</StatusText>
          </HpsmReadonly>
        </HpsmField>
        {d.onenote && (
          <HpsmField label={t('dlvFiles', { n: d.files.length })}>
            <HpsmReadonly>
              {t('dlvObjects', { n: d.onenote.objects, images: d.onenote.images })}
            </HpsmReadonly>
          </HpsmField>
        )}
        {d.html && (
          <HpsmField label={t('dlvSmuggling')}>
            <HpsmReadonly>
              {d.html.smuggling.length ? d.html.smuggling.join(', ') : t('dlvNone')} ·{' '}
              {t('dlvEncoded', {
                b64: d.html.base64,
                uris: d.html.dataUris,
                arrays: d.html.byteArrays,
              })}
            </HpsmReadonly>
          </HpsmField>
        )}
        {msi && (
          <>
            <HpsmField label={t('dlvProduct')}>
              <HpsmReadonly>{msi.product.name ?? '—'}</HpsmReadonly>
            </HpsmField>
            <HpsmField label={t('dlvManufacturer')}>
              <HpsmReadonly>
                {msi.product.manufacturer ?? '—'}
                {msi.product.version && ` · ${t('dlvVersion')} ${msi.product.version}`}
              </HpsmReadonly>
            </HpsmField>
          </>
        )}
        <HpsmField label={t('alerts')} wide top>
          {d.alerts.length === 0 ? (
            <HpsmReadonly>{t('noActiveContent')}</HpsmReadonly>
          ) : (
            <ul className="dl-doc-alerts">
              {d.alerts.map((a) => (
                <li key={a.text}>
                  <StatusText tone={LEVEL_TONE[a.level]}>{a.text}</StatusText>
                </li>
              ))}
            </ul>
          )}
        </HpsmField>
      </HpsmForm>

      {d.targets && (
        <>
          <h4 className="dl-subsection-title">{t('dlvTargets', { n: d.targets.length })}</h4>
          <ul className="dl-doc-alerts">
            {d.targets.map((target) => (
              <li key={target}>
                <code>{target}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {!d.targets && (
        <h4 className="dl-subsection-title">{t('dlvFiles', { n: d.files.length })}</h4>
      )}
      {d.targets ? null : d.files.length === 0 ? (
        <p className="dl-hint-muted">{t('dlvNoFiles')}</p>
      ) : (
        <table className="dl-risk__reasons" aria-label={t('dlvFiles', { n: d.files.length })}>
          <thead>
            <tr>
              <th scope="col">{t('dlvSample')}</th>
              <th scope="col">{t('dlvFrom')}</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {d.files.map((f) => (
              <tr key={f.sha256}>
                <td>
                  {f.entryId ? (
                    <Link
                      className="dl-link"
                      to={`/entries/${f.entryId}`}
                      title={t('dlvOpenChild')}
                    >
                      {f.name}
                    </Link>
                  ) : (
                    f.name
                  )}{' '}
                  <span className="dl-hint-muted">
                    ({f.type ?? '?'} · {fmtSize(f.size)}){f.skipped && ` · ${f.skipped}`}
                  </span>
                </td>
                <td className="dl-mono">{f.source}</td>
                <td className="dl-mono dl-break">{f.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {msi && msi.customActions.length > 0 && (
        <>
          <h4 className="dl-subsection-title">{t('dlvActions')}</h4>
          <table className="dl-risk__reasons" aria-label={t('dlvActions')}>
            <thead>
              <tr>
                <th scope="col">{t('dlvAction')}</th>
                <th scope="col">{t('dlvKind')}</th>
                <th scope="col">{t('dlvSourceCol')}</th>
                <th scope="col">{t('dlvTarget')}</th>
              </tr>
            </thead>
            <tbody>
              {msi.customActions.map((a) => (
                <tr key={a.action}>
                  <td className="dl-mono">{a.action}</td>
                  <td>
                    {a.kind}
                    {a.flags.length > 0 && (
                      <span className="dl-hint-muted"> · {a.flags.join(', ')}</span>
                    )}
                  </td>
                  <td className="dl-mono">{a.source ?? '—'}</td>
                  <td className="dl-mono dl-break">{a.target ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {msi.filesTotal > 0 && (
            <p className="dl-hint-muted">{t('dlvInstalled', { n: msi.filesTotal })}</p>
          )}
        </>
      )}
    </HpsmSection>
  );
}
