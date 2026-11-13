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
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import type { EntryStatus, Priority, Verdict } from '../api/types';
import { HpsmSection } from '../components/HpsmForm';
import { HpsmToolbar, HpsmToolbarButton } from '../components/HpsmToolbar';
import { IconRefresh } from '../components/icons';
import { HpsmLoading, HpsmMessage } from '../components/messages';
import { PageHeader } from '../components/PageHeader';
import { PriorityTag, StatusTag, TypeTag, VerdictTag } from '../components/tags';
import { intlLocale } from '../i18n';

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
const LISTS: { key: ListKey; title: string }[] = [
  { key: 'iocs', title: 'IOCs' },
  { key: 'yara', title: 'Regras YARA' },
  { key: 'attack', title: 'Técnicas ATT&CK' },
  { key: 'urls', title: 'URLs nas strings' },
  { key: 'ips', title: 'IPs nas strings' },
  { key: 'emails', title: 'E-mails nas strings' },
  { key: 'paths', title: 'Caminhos' },
  { key: 'registry', title: 'Chaves de registro' },
  { key: 'suspicious', title: 'Strings suspeitas' },
  { key: 'imports', title: 'DLLs importadas' },
  { key: 'suspiciousImports', title: 'Funções importadas suspeitas' },
  { key: 'sections', title: 'Seções do PE' },
];

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
      label: 'Amostra',
      render: (e) => (
        <Link className="dl-link" to={`/entries/${e.id}`}>
          {e.title}
        </Link>
      ),
      key: () => '',
      always: true,
    },
    { label: 'Tipo', render: (e) => <TypeTag type={e.type} />, key: (e) => e.type },
    { label: 'Tipo real', render: (e) => e.detectedType ?? '—', key: (e) => e.detectedType ?? '' },
    {
      label: 'Arquivo',
      render: (e) => e.originalFilename ?? '—',
      key: (e) => e.originalFilename ?? '',
    },
    { label: 'Tamanho', render: (e) => fmtSize(e.fileSize), key: (e) => String(e.fileSize ?? '') },
    {
      label: 'SHA-256',
      render: (e) => <span className="dl-mono">{e.sha256 ?? '—'}</span>,
      key: (e) => e.sha256 ?? '',
    },
    {
      label: 'Entropia',
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
      label: 'Assinado por',
      render: (e) => e.pe?.signer ?? '—',
      key: (e) => e.pe?.signer ?? '',
    },
    {
      label: 'Compilado em',
      render: (e) =>
        e.pe?.compiledAt ? new Date(e.pe.compiledAt).toLocaleString(intlLocale()) : '—',
      key: (e) => e.pe?.compiledAt ?? '',
    },
    {
      label: 'URL',
      render: (e) => <span className="dl-mono">{e.url ?? '—'}</span>,
      key: (e) => e.url ?? '',
    },
    { label: 'Veredito', render: (e) => <VerdictTag verdict={e.verdict} />, key: (e) => e.verdict },
    { label: 'Status', render: (e) => <StatusTag status={e.status} />, key: (e) => e.status },
    {
      label: 'Prioridade',
      render: (e) => <PriorityTag priority={e.priority} />,
      key: (e) => e.priority,
    },
    { label: 'Enviada por', render: (e) => e.owner.displayName, key: (e) => e.owner.id },
    {
      label: 'Enviada em',
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
      <HpsmToolbar label="Ações da comparação">
        <HpsmToolbarButton
          label="Trocar os lados"
          icon={IconRefresh}
          disabled={!d}
          onClick={swap}
        />
      </HpsmToolbar>
      <PageHeader
        title="Comparar amostras"
        subtitle={d ? `A: ${d.a.title} × B: ${d.b.title}` : 'Duas amostras lado a lado.'}
      />
      {(!a || !b) && (
        <HpsmMessage kind="info">
          Escolha as amostras pelo "Comparar com…" da ficha (menu Mais) ou marque duas na lista.
        </HpsmMessage>
      )}
      {query.isLoading && <HpsmLoading text="Comparando..." />}
      {query.isError && <HpsmMessage kind="error">{(query.error as Error).message}</HpsmMessage>}
      {d?.sameContent && (
        <HpsmMessage kind="info">
          As duas têm o mesmo conteúdo (SHA-256 igual): uma pode ser duplicata da outra.
        </HpsmMessage>
      )}
      {d && (
        <>
          <HpsmSection title="Lado a lado">
            <TableContainer>
              <Table size="xs" aria-label="Campos lado a lado" className="dl-compare">
                <TableHead>
                  <TableRow>
                    <TableHeader scope="col">Campo</TableHeader>
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
                          {differs && <span className="dl-compare__differs"> (difere)</span>}
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

          {lists.length === 0 && (
            <HpsmMessage kind="info">
              Nenhuma das duas tem strings, IOCs, imports, regras YARA ou técnicas ATT&CK para
              comparar.
            </HpsmMessage>
          )}
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
              <HpsmSection
                key={key}
                title={`${title}: ${l.common.length} em comum`}
                className="dl-mt-lg"
              >
                <div className="dl-compare-list" data-list={key}>
                  {column('Só em A', l.onlyA, 'a')}
                  {column('Em comum', l.common, 'common')}
                  {column('Só em B', l.onlyB, 'b')}
                </div>
              </HpsmSection>
            );
          })}
        </>
      )}
    </>
  );
}
