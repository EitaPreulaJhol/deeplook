import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { RiskInfo } from '../api/types';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import type { StatusTone } from './tags';
import { StatusText, verdictLabel } from './tags';

const LEVEL: Record<RiskInfo['risk']['level'], { label: string; tone: StatusTone }> = {
  high: { label: 'Alto', tone: 'red' },
  medium: { label: 'Médio', tone: 'orange' },
  low: { label: 'Baixo', tone: 'gray' },
};

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
    <HpsmSection title="Pontuação de risco">
      <HpsmForm columns={2}>
        <HpsmField label="Nota">
          <HpsmReadonly>
            <StatusText tone={level.tone}>
              {risk.score} de 100 · {level.label}
            </StatusText>
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Sugestão">
          <HpsmReadonly>
            {risk.suggestedVerdict
              ? `${verdictLabel(risk.suggestedVerdict)} (sugestão; o veredito é seu)`
              : 'Sem sugestão'}
          </HpsmReadonly>
        </HpsmField>
      </HpsmForm>
      {risk.pending.length > 0 && (
        <p className="dl-risk__note">
          Ainda em andamento: {risk.pending.join(', ')}. A nota pode subir quando terminar.
        </p>
      )}
      {risk.reasons.length > 0 ? (
        <table className="dl-risk__reasons" aria-label="Motivos da pontuação de risco">
          <thead>
            <tr>
              <th scope="col">Peso</th>
              <th scope="col">Origem</th>
              <th scope="col">Motivo</th>
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
        <p className="dl-risk__note">
          Nenhuma análise encontrou sinal de risco. Isso não quer dizer que a amostra é segura: só
          que nada foi detectado.
        </p>
      )}
    </HpsmSection>
  );
}
