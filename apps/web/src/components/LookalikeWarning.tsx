import type { LookalikeHit } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmMessage } from './messages';

export const LOOKALIKE_REASON: Record<LookalikeHit['reason'], string> = localized(() => ({
  TLD: t('lkTld'),
  HOMOGLYPH: t('lkHomoglyph'),
  TYPO: t('lkTypo'),
  KEYWORD: t('lkKeyword'),
  SUBDOMAIN: t('lkSubdomain'),
}));

export const LOOKALIKE_SOURCE: Record<string, string> = localized(() => ({
  URL: t('lsUrl'),
  SENDER: t('lsSender'),
  LINK: t('lsLink'),
  IOC: t('lsIoc'),
  REPORT: t('lsReport'),
}));

/** "letras parecidas" ou "erro de digitação: letra faltando". */
export function lookalikeWhy(hit: Pick<LookalikeHit, 'reason' | 'detail'>): string {
  return `${LOOKALIKE_REASON[hit.reason]}${hit.detail ? `: ${hit.detail}` : ''}`;
}

/**
 * Aviso no topo da ficha (item 92): dominios que imitam os da empresa, com o
 * motivo e onde apareceram. Texto puro.
 */
export function LookalikeWarning({ hits }: { hits?: LookalikeHit[] }) {
  if (!hits?.length) return null;
  return (
    <HpsmMessage kind="warning">
      <span className="dl-lookalike">
        <strong>{t('lookalikeTitle')}</strong>
        <ul>
          {hits.map((h) => (
            <li key={h.domain}>
              <span className="dl-mono">{h.domain}</span> {t('similarTo')}{' '}
              <span className="dl-mono">{h.companyDomain}</span> ({lookalikeWhy(h)}) —{' '}
              {h.sources.map((s) => LOOKALIKE_SOURCE[s] ?? s).join(', ')}
            </li>
          ))}
        </ul>
      </span>
    </HpsmMessage>
  );
}
