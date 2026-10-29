import type { LookalikeHit } from '../api/types';
import { HpsmMessage } from './messages';

export const LOOKALIKE_REASON: Record<LookalikeHit['reason'], string> = {
  TLD: 'outro TLD',
  HOMOGLYPH: 'letras parecidas',
  TYPO: 'erro de digitação',
  KEYWORD: 'nome com palavra a mais',
  SUBDOMAIN: 'nome no subdomínio',
};

export const LOOKALIKE_SOURCE: Record<string, string> = {
  URL: 'link enviado',
  SENDER: 'remetente',
  LINK: 'link do e-mail',
  IOC: 'indicador sugerido',
  REPORT: 'relatório',
};

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
        <strong>Domínio parecido com o da empresa — provável golpe:</strong>
        <ul>
          {hits.map((h) => (
            <li key={h.domain}>
              <span className="dl-mono">{h.domain}</span> parecido com{' '}
              <span className="dl-mono">{h.companyDomain}</span> ({lookalikeWhy(h)}) —{' '}
              {h.sources.map((s) => LOOKALIKE_SOURCE[s] ?? s).join(', ')}
            </li>
          ))}
        </ul>
      </span>
    </HpsmMessage>
  );
}
