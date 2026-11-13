import { Theme } from '@carbon/react';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconPrint } from '../components/icons';
import { ManagementReport, periodLabel } from '../components/ManagementReport';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { intlLocale } from '../i18n';
import { useManagement, useManagementPeriod } from './ManagementPage';

/**
 * Relatorio gerencial para impressao (item 77), fora da casca e no visual da
 * ficha impressa. Com `?auto=1` abre a caixa de impressao ao carregar.
 */
export function ManagementPrintPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { from, to, qs } = useManagementPeriod();
  const query = useManagement(qs);
  const printedAt = useRef(new Date().toLocaleString(intlLocale()));

  useEffect(() => {
    document.title = `Relatório gerencial — ${periodLabel(from, to)}`;
  }, [from, to]);

  const printed = useRef(false);
  useEffect(() => {
    if (!query.data || printed.current || searchParams.get('auto') !== '1') return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [query.data, searchParams]);

  return (
    <Theme theme="g10">
      <div className="dl-print dl-print--management">
        <div className="dl-print__toolbar">
          <HpsmToolbar label="Ações do relatório">
            <HpsmToolbarButton
              label="Imprimir"
              icon={IconPrint}
              disabled={!query.data}
              onClick={() => window.print()}
            />
            <HpsmToolbarButton label="Fechar" onClick={() => window.close()} />
          </HpsmToolbar>
        </div>
        <header className="dl-print__head">
          <img src="/icons/magnifier.svg" alt="" className="dl-print__logo" />
          <div>
            <div className="dl-print__brand">DeepLook — Relatório gerencial</div>
            <h1 className="dl-print__title">{periodLabel(from, to)}</h1>
          </div>
          <div className="dl-print__meta">
            Impresso por {user?.displayName ?? '—'}
            <br />
            em {printedAt.current}
          </div>
        </header>
        {query.isLoading && <HpsmLoading text="Calculando o relatório..." />}
        {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
        {query.data && <ManagementReport data={query.data} />}
        <footer className="dl-print__foot">
          Concluídas: amostras que chegaram a Concluído no período, sem duplicatas. Tempo até
          concluir: do envio à conclusão. Fuso: {query.data?.period.tz ?? '—'}.
        </footer>
      </div>
    </Theme>
  );
}
