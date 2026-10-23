import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IocKind } from '../api/types';
import { HpsmSection } from './HpsmForm';
import { IOC_KIND_LABELS, iocHref } from './iocs';
import { HpsmLoading, HpsmMessage } from './messages';

interface Watch {
  kind: IocKind;
  value: string;
  createdAt: string;
}

/**
 * Minha Conta > Indicadores (item 60): indicadores que a pessoa segue. Quando
 * um deles aparece numa amostra nova ou num relatorio publicado, chega um aviso
 * na Caixa de entrada.
 */
export function WatchesTab() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const query = useQuery({
    queryKey: ['me', 'watches'],
    queryFn: () => api.get<{ watches: Watch[] }>('/me/watches'),
  });
  const watches = query.data?.watches ?? [];

  const unwatch = async (w: Watch) => {
    setNotice(null);
    try {
      await api.del(`/iocs/${w.kind.toLowerCase()}/${encodeURIComponent(w.value)}/watch`);
      await queryClient.invalidateQueries({ queryKey: ['me', 'watches'] });
      await queryClient.invalidateQueries({ queryKey: ['ioc'] });
      setNotice({ ok: true, text: `Você deixou de seguir ${w.value}.` });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <>
      {notice && (
        <HpsmMessage key={notice.text} kind={notice.ok ? 'success' : 'error'}>
          {notice.text}
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text="Carregando indicadores..." />}
      <HpsmSection title={`Indicadores que sigo (${watches.length})`}>
        <p className="dl-static-empty">
          Você recebe um aviso na Caixa de entrada quando um destes indicadores aparece numa amostra
          nova ou num relatório publicado. Para seguir outro, abra a ficha dele (pelo "Ir para:" ou
          pelos IOCs de uma amostra) e clique em Seguir.
        </p>
        {watches.length > 0 && (
          <TableContainer>
            <Table size="xs" aria-label="Indicadores que sigo">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Tipo</TableHeader>
                  <TableHeader scope="col">Indicador</TableHeader>
                  <TableHeader scope="col">Seguindo desde</TableHeader>
                  <TableHeader scope="col">Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {watches.map((w) => (
                  <TableRow key={`${w.kind}:${w.value}`}>
                    <TableCell>{IOC_KIND_LABELS[w.kind]}</TableCell>
                    <TableCell>
                      <Link className="dl-link dl-mono" to={iocHref(w.kind, w.value)}>
                        {w.value}
                      </Link>
                    </TableCell>
                    <TableCell>{new Date(w.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="dl-link-button"
                        onClick={() => void unwatch(w)}
                      >
                        Deixar de seguir
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </HpsmSection>
    </>
  );
}
