import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Priority, Verdict } from '../api/types';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { PriorityTag, StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { intlLocale, localized } from '../i18n';
import { t } from '../i18n/misc';

interface CompareEntry {
  id: string;
  title: string;
  type: 'FILE' | 'URL';
  status: EntryStatus;
  verdict: Verdict;
  priority: Priority;
  createdAt: string;
  owner: { id: string; displayName: string };
  originalFilename: string | null;
  fileSize: number | null;
  mimeType: string | null;
  sha256: string | null;
  url: string | null;
  urlDomain: string | null;
  detectedType: string | null;
  entropy: number | null;
  entropyLevel: 'low' | 'normal' | 'high' | null;
  stringsTotal: number | null;
  pe: {
    machine: string;
    isDll: boolean;
    subsystem: string;
    compiledAt: string | null;
    packer: string | null;
    /** Item 7.1: ausentes em analise antiga. */
    imphash?: string | null;
    richHash?: string | null;
    signer?: string | null;
  } | null;
}

interface SetDiff {
  common: string[];
  onlyA: string[];
  onlyB: string[];
}

type ListKey =
  | 'iocs'
  | 'yara'
  | 'attack'
  | 'urls'
  | 'ips'
  | 'emails'
  | 'paths'
  | 'registry'
  | 'suspicious'
  | 'imports'
  | 'suspiciousImports'
  | 'sections';

interface CompareResult {
  a: CompareEntry;
  b: CompareEntry;
  sameContent: boolean;
  lists: Record<ListKey, SetDiff>;
}

/** Listas na ordem da tela (as vazias dos dois lados nao aparecem). */
const LISTS: { key: ListKey; title: string }[] = localized(() => [
  { key: 'iocs', title: 'IOCs' },
  { key: 'yara', title: t('lYara') },
  { key: 'attack', title: t('lAttack') },
  { key: 'urls', title: t('lUrls') },
  { key: 'ips', title: t('lIps') },
  { key: 'emails', title: t('lEmails') },
  { key: 'paths', title: t('lPaths') },
  { key: 'registry', title: t('lRegistry') },
  { key: 'suspicious', title: t('lSuspicious') },
  { key: 'imports', title: t('lImports') },
  { key: 'suspiciousImports', title: t('lSuspImports') },
  { key: 'sections', title: t('lSections') },
]);

const ENTROPY_LABEL = { low: 'baixa', normal: 'normal', high: 'alta' } as const;

function fmtSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** IOC "KIND:valor" -> "valor" com o tipo discreto. */
function itemText(key: ListKey, value: string): ReactNode {
  if (key !== 'iocs') return value;
  const i = value.indexOf(':');
  return (
    <>
      <span className="dl-compare__kind">{value.slice(0, i)}</span> {value.slice(i + 1)}
    </>
  );
}

/**
 * Comparar duas amostras (item 58; analistas): campos lado a lado, com o que
 * difere destacado, e para cada lista o que e so de A, comum e so de B.
 * Chega pelo "Comparar com..." da ficha ou marcando duas na lista.
 */
export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const query = useQuery({
    queryKey: ['compare', a, b],
    queryFn: () =>
      api.get<CompareResult>(
        `/entries/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
      ),
    enabled: Boolean(a && b),
    // 400/403/404 sao definitivos: o erro aparece na hora.
    retry: false,
  });
  const d = query.data;

  const swap = () => setParams({ a: b, b: a }, { replace: true });

  // `key`: valor comparado (vazio dos dois lados = linha escondida); `always`: sempre aparece.
  const rows: {
    label: string;
    render: (e: CompareEntry) => ReactNode;
    key: (e: CompareEntry) => string;
    always?: boolean;
  }[] = [
    {
      label: t('sample'),
      render: (e) => (
        <Link className="dl-link" to={`/entries/${e.id}`}>
          {e.title}
        </Link>
      ),
      key: () => '',
      always: true,
    },
    { label: t('type'), render: (e) => <TypeTag type={e.type} />, key: (e) => e.type },
    {
      label: t('realType'),
      render: (e) => e.detectedType ?? '—',
      key: (e) => e.detectedType ?? '',
    },
    {
      label: t('file'),
      render: (e) => e.originalFilename ?? '—',
      key: (e) => e.originalFilename ?? '',
    },
    { label: t('size'), render: (e) => fmtSize(e.fileSize), key: (e) => String(e.fileSize ?? '') },
    {
      label: 'SHA-256',
      render: (e) => <span className="dl-mono">{e.sha256 ?? '—'}</span>,
      key: (e) => e.sha256 ?? '',
    },
    {
      label: t('entropy'),
      render: (e) =>
        e.entropy === null
          ? '—'
          : `${e.entropy.toFixed(2)}${e.entropyLevel ? ` (${ENTROPY_LABEL[e.entropyLevel]})` : ''}`,
      key: (e) => (e.entropy === null ? '' : e.entropy.toFixed(2)),
    },
    {
      label: 'Strings',
      render: (e) => e.stringsTotal ?? '—',
      key: (e) => String(e.stringsTotal ?? ''),
    },
    {
      label: 'PE',
      render: (e) =>
        e.pe
          ? `${e.pe.machine} · ${e.pe.isDll ? 'DLL' : 'EXE'} · ${e.pe.subsystem}${e.pe.packer ? ` · ${e.pe.packer}` : ''}`
          : '—',
      key: (e) => (e.pe ? `${e.pe.machine}|${e.pe.isDll}|${e.pe.subsystem}|${e.pe.packer}` : ''),
    },
    {
      label: 'Imphash',
      render: (e) => <span className="dl-mono">{e.pe?.imphash ?? '—'}</span>,
      key: (e) => e.pe?.imphash ?? '',
    },
    {
      label: 'Rich header',
      render: (e) => <span className="dl-mono">{e.pe?.richHash ?? '—'}</span>,
      key: (e) => e.pe?.richHash ?? '',
    },
    {
      label: t('signedBy'),
      render: (e) => e.pe?.signer ?? '—',
      key: (e) => e.pe?.signer ?? '',
    },
    {
      label: t('compiledAt'),
      render: (e) =>
        e.pe?.compiledAt ? new Date(e.pe.compiledAt).toLocaleString(intlLocale()) : '—',
      key: (e) => e.pe?.compiledAt ?? '',
    },
    {
      label: 'URL',
      render: (e) => <span className="dl-mono">{e.url ?? '—'}</span>,
      key: (e) => e.url ?? '',
    },
    {
      label: t('verdict'),
      render: (e) => <VerdictTag verdict={e.verdict} />,
      key: (e) => e.verdict,
    },
    { label: t('status'), render: (e) => <StatusTag status={e.status} />, key: (e) => e.status },
    {
      label: t('priority'),
      render: (e) => <PriorityTag priority={e.priority} />,
      key: (e) => e.priority,
    },
    { label: t('submittedBy'), render: (e) => e.owner.displayName, key: (e) => e.owner.id },
    {
      label: t('submittedOn'),
      render: (e) => new Date(e.createdAt).toLocaleString(intlLocale()),
      key: () => '',
      always: true,
    },
  ];
  // Linhas sem valor dos dois lados (ex.: PE em duas URLs) nao aparecem.
  const shownRows = d ? rows.filter((r) => r.always || r.key(d.a) || r.key(d.b)) : [];
  const lists = d
    ? LISTS.filter(({ key }) => {
        const l = d.lists[key];
        return l.common.length + l.onlyA.length + l.onlyB.length > 0;
      })
    : [];

  return (
    <>
      <HpsmToolbar label={t('compareActions')}>
        <HpsmToolbarButton label={t('swapSides')} icon={IconRefresh} disabled={!d} onClick={swap} />
      </HpsmToolbar>
      <PageHeader
        title={t('compareTitle')}
        subtitle={d ? `A: ${d.a.title} × B: ${d.b.title}` : t('twoSides')}
      />
      {(!a || !b) && <HpsmMessage kind="info">{t('compareHint')}</HpsmMessage>}
      {query.isLoading && <HpsmLoading text={t('comparing')} />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {d?.sameContent && <HpsmMessage kind="info">{t('sameContent')}</HpsmMessage>}
      {d && (
        <>
          <HpsmSection title={t('sideBySide')}>
            <TableContainer>
              <Table size="xs" aria-label={t('fieldsAria')} className="dl-compare">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">{t('field')}</TableHeader>
                    <TableHeader scope="col">A</TableHeader>
                    <TableHeader scope="col">B</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shownRows.map((r) => {
                    const differs = r.key(d.a) !== r.key(d.b);
                    return (
                      <TableRow key={r.label} className={differs ? 'is-diff' : undefined}>
                        <TableCell>
                          {r.label}
                          {differs && <span className="dl-compare__differs"> {t('differs')}</span>}
                        </TableCell>
                        <TableCell>{r.render(d.a)}</TableCell>
                        <TableCell>{r.render(d.b)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </HpsmSection>

          {lists.length === 0 && <HpsmMessage kind="info">{t('nothingToCompare')}</HpsmMessage>}
          <FunctionsDiff a={a} b={b} />
          {lists.map(({ key, title }) => {
            const l = d.lists[key];
            const column = (label: string, items: string[], tone: string) => (
              <div className={`dl-compare-list__col dl-compare-list__col--${tone}`}>
                <h3 className="dl-compare-list__head">
                  {label} ({items.length})
                </h3>
                {items.length === 0 ? (
                  <p className="dl-static-empty">—</p>
                ) : (
                  <ul>
                    {items.map((item) => (
                      <li
                        key={item}
                        className={key === 'attack' || key === 'yara' ? undefined : 'dl-mono'}
                      >
                        {itemText(key, item)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
            return (
              <HpsmSection key={key} title={t('inCommon', { title, n: l.common.length })}>
                <div className="dl-compare-list" data-list={key}>
                  {column(t('onlyA'), l.onlyA, 'a')}
                  {column(t('common'), l.common, 'common')}
                  {column(t('onlyB'), l.onlyB, 'b')}
                </div>
              </HpsmSection>
            );
          })}
        </>
      )}
    </>
  );
}

interface FunctionsDiffResult {
  similarity: number | null;
  confidence: number | null;
  matched: number;
  equal: number;
  changed: number;
  onlyA: number | null;
  onlyB: number | null;
  truncated: boolean;
  onlyAList: { entry: string; name: string }[];
  onlyBList: { entry: string; name: string }[];
  functions: {
    address1: string;
    name1: string;
    address2: string;
    name2: string;
    similarity: number;
    confidence: number;
    entry1: string | null;
    entry2: string | null;
  }[];
}

/** O pseudo-C de uma funcao de uma amostra (o indice do Ghidra dela). */
function FunctionCode({ entryId, entry }: { entryId: string; entry: string | null }) {
  const query = useQuery({
    queryKey: ['ghidra-fn', entryId, entry],
    queryFn: () =>
      api.get<{ c: string | null }>(
        `/entries/${entryId}/ghidra/functions/${encodeURIComponent(entry!)}`,
      ),
    enabled: Boolean(entry),
    staleTime: Infinity,
  });
  if (!entry) return <p className="dl-static-empty">{t('fnNoCode')}</p>;
  if (query.isError)
    return <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>;
  return <pre className="dl-doc-macros__code">{query.data?.c ?? t('fnLoading')}</pre>;
}

/**
 * As funcoes pelo BinDiff (item 24): iguais, alteradas e so de um lado; a alterada abre o pseudo-C
 * dos dois lados. So aparece com as duas amostras analisadas pelo Ghidra.
 */
function FunctionsDiff({ a, b }: { a: string; b: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['compare-functions', a, b],
    queryFn: () =>
      api.get<FunctionsDiffResult>(
        `/entries/compare/functions?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
      ),
    retry: false,
    staleTime: Infinity,
  });
  if (query.isLoading) return <HpsmLoading text={t('fnLoading')} />;
  if (query.isError) {
    return (
      <HpsmSection title={t('fnTitle')}>
        <HpsmMessage kind="info">{(query.error as Error).message}</HpsmMessage>
      </HpsmSection>
    );
  }
  const d = query.data!;
  const changed = d.functions.filter((f) => f.similarity < 0.999);
  return (
    <HpsmSection title={t('fnTitle')}>
      <p>
        {t('fnSummary', {
          similarity: d.similarity === null ? '—' : Math.round(d.similarity * 100),
          equal: d.equal,
          changed: d.changed,
          onlyA: d.onlyA ?? '—',
          onlyB: d.onlyB ?? '—',
        })}
      </p>
      {changed.length > 0 && (
        <table className="dl-import__table">
          <thead>
            <tr>
              <th>{t('fnInA')}</th>
              <th>{t('fnInB')}</th>
              <th>{t('fnSimilarity')}</th>
            </tr>
          </thead>
          <tbody>
            {changed.slice(0, 200).map((f, i) => (
              <tr key={`${f.address1}-${f.address2}`}>
                <td className="dl-mono">
                  <button
                    type="button"
                    className="dl-link-button"
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {f.name1} ({f.address1})
                  </button>
                </td>
                <td className="dl-mono">
                  {f.name2} ({f.address2})
                </td>
                <td>{Math.round(f.similarity * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(d.onlyAList.length > 0 || d.onlyBList.length > 0) && (
        <div className="dl-compare-list">
          {(
            [
              ['a', t('onlyA'), d.onlyAList],
              ['b', t('onlyB'), d.onlyBList],
            ] as const
          ).map(([side, label, list]) => (
            <div key={side} className={`dl-compare-list__col dl-compare-list__col--${side}`}>
              <h3 className="dl-compare-list__head">
                {label} ({list.length})
              </h3>
              <ul>
                {list.slice(0, 200).map((f) => (
                  <li key={f.entry} className="dl-mono">
                    {f.name} ({f.entry})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {open !== null && changed[open] && (
        <div className="dl-compare-list">
          <div className="dl-compare-list__col dl-compare-list__col--a">
            <h3 className="dl-compare-list__head">A · {changed[open].name1}</h3>
            <FunctionCode entryId={a} entry={changed[open].entry1} />
          </div>
          <div className="dl-compare-list__col dl-compare-list__col--b">
            <h3 className="dl-compare-list__head">B · {changed[open].name2}</h3>
            <FunctionCode entryId={b} entry={changed[open].entry2} />
          </div>
        </div>
      )}
    </HpsmSection>
  );
}
