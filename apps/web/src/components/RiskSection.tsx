import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { RiskInfo } from '../api/types';
import { localized } from '../i18n';
import { t } from '../i18n/analysis';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusText, verdictLabel } from './tags';

const LEVEL: Record<RiskInfo['risk']['level'], { label: string; tone: StatusTone }> = localized(
  () => ({
    high: { label: t('riskHigh'), tone: 'red' },
    medium: { label: t('riskMedium'), tone: 'orange' },
    low: { label: t('riskLow'), tone: 'gray' },
  }),
);

/** Peso com sinal: +35 soma, −10 atenua. */
export const riskWeight = (weight: number) => (weight > 0 ? `+${weight}` : `−${Math.abs(weight)}`);

/**
 * Secao "Pontuacao de risco" da aba Detalhes (item 7.5), so para analistas: a nota de 0 a 100
 * que a API monta com o que as analises ja encontraram, cada motivo com o peso que teve. E uma
 * sugestao para a triagem; o veredito continua sendo de quem analisa.
 */
export function RiskSection({ entryId }: { entryId: string }) {
  const query = useQuery({
    queryKey: ['risk', entryId],
    queryFn: () => api.get<RiskInfo>(`/entries/${entryId}/risk`),
    staleTime: 5000,
    // Enquanto alguma analise roda, a nota pode subir.
    refetchInterval: (q) => (q.state.data?.risk.pending.length ? 5000 : false),
  });
  const risk = query.data?.risk;
  if (!risk) return null;
  const level = LEVEL[risk.level];
  return (
    <HpsmSection title={t('riskTitle')}>
      <HpsmForm columns={2}>
        <HpsmField label={t('score')}>
          <HpsmReadonly>
            <StatusText tone={level.tone}>
              {t('scoreOf', { score: risk.score, level: level.label })}
            </StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label={t('suggestion')}>
          <HpsmReadonly>
            {risk.suggestedVerdict
              ? t('suggested', { verdict: verdictLabel(risk.suggestedVerdict) })
              : t('noSuggestion')}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
      {risk.pending.length > 0 && (
        <p className="dl-risk__note">{t('stillRunning', { list: risk.pending.join(', ') })}</p>
      )}
      {risk.reasons.length > 0 ? (
        <table className="dl-risk__reasons" aria-label={t('riskReasonsAria')}>
          <thead>
            <tr>
              <th scope="col">{t('weight')}</th>
              <th scope="col">{t('source')}</th>
              <th scope="col">{t('reason')}</th>
            </tr>
          </thead>
          <tbody>
            {risk.reasons.map((reason, index) => (
              <tr key={index}>
                <td className={reason.weight > 0 ? 'dl-risk__plus' : 'dl-risk__minus'}>
                  {riskWeight(reason.weight)}
                </td>
                <td>{reason.source}</td>
                <td>{reason.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="dl-risk__note">{t('noRisk')}</p>
      )}
    </HpsmSection>
  );
}
