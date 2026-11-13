import { Select, SelectItem } from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api/client';
import type { ReportStatus, Verdict } from '../api/types';
import { intlLocale, localized } from '../i18n';
import { t as tr } from '../i18n/entry';
import { HpsmField, HpsmForm } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';
import { verdictLabel } from './tags';
import { lineDiff } from './textDiff';

export interface ReportVersion {
  number: number;
  current: boolean;
  author: { id: string; displayName: string } | null;
  at: string;
  status: ReportStatus;
  summary: string;
  findings: string | null;
  iocs: string | null;
  verdict: Verdict;
  attackTechniques: string[];
}

const STATUS_LABEL: Record<ReportStatus, string> = localized(() => ({
  DRAFT: tr('rsDraftLower'),
  IN_REVIEW: tr('rsInReviewLower'),
  PUBLISHED: tr('rsPublishedLower'),
}));

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale());
}

/** "Versão 2 (atual) — Bruno Lima, 24/10/2026 10:00 · publicado". */
export function versionLabel(v: ReportVersion): string {
  return tr('versionLabel', {
    n: v.number,
    current: v.current ? ` ${tr('currentParen')}` : '',
    author: v.author?.displayName ?? tr('removedUser'),
    date: fmtDate(v.at),
    status: STATUS_LABEL[v.status],
  });
}

/** Diferenca de um campo de texto: linhas removidas (−) e adicionadas (+). */
function TextDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string | null;
  after: string | null;
}) {
  if ((before ?? '') === (after ?? '')) return null;
  const lines = lineDiff(before, after);
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  return (
    <HpsmField label={label} wide top>
      <div className="dl-diff" role="group" aria-label={tr('diffAria', { label, added, removed })}>
        <div className="dl-diff__count">
          <span className="dl-diff__count-add">+{added}</span>{' '}
          <span className="dl-diff__count-del">−{removed}</span>
        </div>
        <pre className="dl-diff__body">
          {lines.map((line, i) => (
            <div key={i} className={`dl-diff__line dl-diff__line--${line.kind}`}>
              <span className="dl-diff__sign" aria-hidden="true">
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
              </span>
              {line.kind !== 'same' && (
                <span className="cds--visually-hidden">
                  {line.kind === 'add' ? 'adicionada: ' : 'removida: '}
                </span>
              )}
              {line.text || ' '}
            </div>
          ))}
        </pre>
      </div>
    </HpsmField>
  );
}

/**
 * Versoes do relatorio (item 75): escolhe duas versoes e mostra o que mudou
 * (linhas adicionadas e removidas, veredito e tecnicas ATT&CK), com quem e quando.
 */
export function ReportVersions({ reportId }: { reportId: string }) {
  const query = useQuery({
    queryKey: ['report', reportId, 'versions'],
    queryFn: () => api.get<{ versions: ReportVersion[] }>(`/reports/${reportId}/versions`),
  });
  const versions = query.data?.versions ?? [];
  // Padrao: a anterior contra a atual.
  const [fromN, setFromN] = useState<number | null>(null);
  const [toN, setToN] = useState<number | null>(null);

  if (query.isLoading) return <HpsmLoading text={tr('loadingVersions')} />;
  if (query.isError) {
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  }
  if (versions.length < 2) {
    return <HpsmMessage kind="info">{tr('neverEdited')}</HpsmMessage>;
  }
  const last = versions.length;
  const from = versions[(fromN ?? last - 1) - 1];
  const to = versions[(toN ?? last) - 1];
  const addedTech = to.attackTechniques.filter((t) => !from.attackTechniques.includes(t));
  const removedTech = from.attackTechniques.filter((t) => !to.attackTechniques.includes(t));
  const same =
    from.summary === to.summary &&
    (from.findings ?? '') === (to.findings ?? '') &&
    (from.iocs ?? '') === (to.iocs ?? '') &&
    from.verdict === to.verdict &&
    !addedTech.length &&
    !removedTech.length;

  const picker = (id: string, label: string, value: number, onChange: (n: number) => void) => (
    <HpsmField label={label} htmlFor={id} wide>
      <Select
        id={id}
        labelText={label}
        hideLabel
        size="sm"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {versions.map((v) => (
          <SelectItem key={v.number} value={String(v.number)} text={versionLabel(v)} />
        ))}
      </Select>
    </HpsmField>
  );

  return (
    <div className="dl-versions">
      <HpsmForm>
        {picker(`versions-from-${reportId}`, tr('compare'), from.number, setFromN)}
        {picker(`versions-to-${reportId}`, 'com', to.number, setToN)}
      </HpsmForm>
      {same ? (
        <HpsmMessage kind="info">{tr('sameContent')}</HpsmMessage>
      ) : (
        <HpsmForm>
          {from.verdict !== to.verdict && (
            <HpsmField label={tr('colVerdict')} wide>
              <span className="dl-diff__inline">
                <span className="dl-diff__inline-del">{verdictLabel(from.verdict)}</span> →{' '}
                <span className="dl-diff__inline-add">{verdictLabel(to.verdict)}</span>
              </span>
            </HpsmField>
          )}
          <TextDiff label={tr('summary')} before={from.summary} after={to.summary} />
          <TextDiff label={tr('findings')} before={from.findings} after={to.findings} />
          <TextDiff label="IOCs" before={from.iocs} after={to.iocs} />
          {(addedTech.length > 0 || removedTech.length > 0) && (
            <HpsmField label="ATT&CK" wide>
              <span className="dl-diff__inline">
                {addedTech.length > 0 && (
                  <span className="dl-diff__inline-add">+ {addedTech.join(', ')}</span>
                )}
                {addedTech.length > 0 && removedTech.length > 0 && ' '}
                {removedTech.length > 0 && (
                  <span className="dl-diff__inline-del">− {removedTech.join(', ')}</span>
                )}
              </span>
            </HpsmField>
          )}
        </HpsmForm>
      )}
    </div>
  );
}
