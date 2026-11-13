import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { AntivirusInfo, AntivirusScan } from '../api/types';
import { intlLocale } from '../i18n';
import { HpsmField, HpsmForm, HpsmReadonly, HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import type { StatusTone } from './tags';
import { StatusText } from './tags';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** Situacao da varredura: escaneando, limpo, infectado (assinatura) ou falha. */
export function antivirusState(scan: AntivirusScan): { label: string; tone: StatusTone } {
  if (scan.status === 'PENDING') return { label: 'Escaneando...', tone: 'blue' };
  if (scan.status === 'CLEAN') return { label: 'Limpo', tone: 'green' };
  if (scan.status === 'INFECTED') return { label: `Infectado: ${scan.signature}`, tone: 'red' };
  return { label: `Falha: ${scan.error ?? 'erro desconhecido'}`, tone: 'orange' };
}

/**
 * Ultima varredura do ClamAV (GET /api/entries/:id/antivirus). Atualiza a cada
 * 2,5 s enquanto escaneia; o resumo do topo e a secao dividem a consulta.
 */
export function useAntivirus(entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['antivirus', entryId],
    queryFn: () => api.get<AntivirusInfo>(`/entries/${entryId}/antivirus`),
    enabled,
    staleTime: 2000,
    refetchInterval: (q) => (q.state.data?.pending ? 2500 : false),
  });
}

/** Secao "Antivirus (ClamAV)" da aba Detalhes (so arquivos; escondida sem ClamAV). */
export function AntivirusSection({
  entryId,
  canTriage,
  purged,
}: {
  entryId: string;
  canTriage: boolean;
  purged: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useAntivirus(entryId, true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const info = query.data;
  if (!info?.enabled) return null;
  const scan = info.scan;

  const rescan = async () => {
    setError(null);
    setAsking(true);
    try {
      await api.post(`/entries/${entryId}/antivirus`, {});
      await queryClient.invalidateQueries({ queryKey: ['antivirus', entryId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const busy = info.pending;
  const state = scan
    ? antivirusState(scan)
    : busy
      ? { label: 'Na fila...', tone: 'blue' as const }
      : { label: 'Não escaneado (enviado antes do antivírus)', tone: 'gray' as const };
  return (
    <HpsmSection title="Antivírus (ClamAV)">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      <HpsmForm columns={2}>
        <HpsmField label="Situação" wide>
          <HpsmReadonly>
            <StatusText tone={state.tone}>{state.label}</StatusText>
            {canTriage && !purged && (
              <>
                {' '}
                <button
                  type="button"
                  className="dl-link-button"
                  disabled={asking || busy}
                  onClick={() => void rescan()}
                >
                  {busy ? 'Escaneando...' : scan ? 'Escanear de novo' : 'Escanear agora'}
                </button>
              </>
            )}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Motor">
          <HpsmReadonly>{scan?.engine ?? '—'}</HpsmReadonly>
        </HpsmField>
        <HpsmField label="Base de assinaturas">
          <HpsmReadonly>
            {scan?.dbVersion
              ? `${scan.dbVersion}${scan.dbDate ? ` · ${fmtDate(scan.dbDate)}` : ''}`
              : '—'}
          </HpsmReadonly>
        </HpsmField>
        <HpsmField label="Escaneado em">
          <HpsmReadonly>{scan && !busy ? fmtDate(scan.scannedAt) : '—'}</HpsmReadonly>
        </HpsmField>
      </HpsmForm>
    </HpsmSection>
  );
}
