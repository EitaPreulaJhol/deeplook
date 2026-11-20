import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { api } from '../api/client';
import { t } from '../i18n/analysis';
import { HpsmSection } from './HpsmForm';
import { HpsmMessage } from './messages';
import { StatusText } from './tags';

/** Uma string da aba unificada (item 26). */
interface TabString {
  text: string;
  source: string;
  offset: number | null;
  categories: string[];
  score: number;
}

interface StringsResult {
  total: number;
  rankedBy: 'stringsifter' | 'heuristic';
  rankReason: string | null;
  truncated: boolean;
  items: TabString[];
}

const SHOWN = 300;

/**
 * Strings unificadas (plans/analise-estatica-ampliada, item 26): do arquivo, do FLOSS e do codigo
 * descompilado, com a origem, o deslocamento e as categorias, na ordem do StringSifter. Filtro por
 * texto e por categoria, e exportacao em texto. So analistas (a rota le o conteudo do arquivo).
 */
export function StringsSection({ entryId }: { entryId: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const query = useQuery({
    queryKey: ['strings', entryId],
    queryFn: () => api.get<StringsResult>(`/entries/${entryId}/strings`),
    enabled: open,
    staleTime: Infinity,
  });
  const d = query.data;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (d?.items ?? []).filter(
      (s) =>
        (!needle || s.text.toLowerCase().includes(needle)) &&
        (!category || s.categories.includes(category)),
    );
  }, [d, filter, category]);
  const exportText = () => {
    const body = shown
      .map((s) => `${s.score}\t${s.source}\t${s.offset ?? ''}\t${s.text}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `strings-${entryId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <HpsmSection title={t('strTitle')}>
      {!open ? (
        <p className="dl-static-empty">
          {t('strIntro')}{' '}
          <button type="button" className="dl-link-button" onClick={() => setOpen(true)}>
            {t('strLoad')}
          </button>
        </p>
      ) : query.isError ? (
        <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>
      ) : !d ? (
        <p className="dl-hint-muted">{t('strLoading')}</p>
      ) : (
        <>
          <p className="dl-hint-muted">
            {t(d.rankedBy === 'stringsifter' ? 'strRankedSifter' : 'strRankedHeuristic', {
              n: d.total,
            })}
            {d.truncated && ` ${t('strTruncated')}`}
          </p>
          <div className="dl-strings__bar">
            <input
              type="search"

              aria-label={t('strFilter')}
              placeholder={t('strFilter')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select
              aria-label={t('strCategory')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{t('strAll')}</option>
              {['url', 'ip', 'email', 'path', 'registry', 'command', 'crypto', 'base64'].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
            <button type="button" className="dl-link-button" onClick={exportText}>
              {t('strExport')}
            </button>
          </div>
          <table className="dl-import__table">
            <thead>
              <tr>
                <th>{t('strScore')}</th>
                <th>{t('strSource')}</th>
                <th>{t('strOffset')}</th>
                <th>{t('strText')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, SHOWN).map((s, i) => (
                <tr key={`${s.source}-${s.offset}-${i}`}>
                  <td>{s.score.toFixed(1)}</td>
                  <td>{s.source}</td>
                  <td className="dl-mono">
                    {s.offset === null ? '—' : `0x${s.offset.toString(16)}`}
                  </td>
                  <td className="dl-mono">
                    {s.text}{' '}
                    {s.categories.map((c) => (
                      <StatusText key={c} tone="orange">
                        {c}
                      </StatusText>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > SHOWN && (
            <p className="dl-hint-muted">{t('strMore', { n: shown.length - SHOWN })}</p>
          )}
        </>
      )}
    </HpsmSection>
  );
}
