import { Checkbox, Select, SelectItem, TextInput } from '@carbon/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import type {
  GhidraFunctionDetail,
  GhidraFunctionLink,
  GhidraFunctionPage,
  GhidraFunctionRow,
  GhidraSearchHit,
  GhidraSearchResult,
} from '../api/types';
import { t } from '../i18n/analysis';
import { CopyButton } from './CopyButton';
import {
  findMatches,
  HIGHLIGHT_MAX,
  linkTargets,
  searchRegExp,
  splitMarks,
  type Token,
  tokenizeC,
} from './ghidraCode';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmLoading } from './messages';
import { StatusText } from './tags';

const PAGE_SIZE = 100;
type Sort = 'priority' | 'name' | 'address' | 'size' | 'complexity';
const SORTS: Sort[] = ['priority', 'name', 'address', 'size', 'complexity'];
const SORT_LABEL = {
  priority: 'fnSortPriority',
  name: 'fnSortName',
  address: 'fnSortAddress',
  size: 'fnSortSize',
  complexity: 'fnSortComplexity',
} as const;

/** Mensagem dentro da janela: a barra de mensagens da pagina fica atras do modal (inerte). */
function Inline({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p className="dl-static-empty" role={error ? 'alert' : undefined}>
      {children}
    </p>
  );
}

const numbers = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).join('\n');

/** Nomes das marcas do CSS Custom Highlight API (estilo em hpsm.scss, ::highlight). */
const MATCH_HIGHLIGHT = 'dl-ghidra-match';
const CURRENT_HIGHLIGHT = 'dl-ghidra-match-current';

/** Faixas do DOM para posicoes do texto do <pre>, pelos nos de texto em ordem. */
function rangeMaker(root: HTMLElement) {
  const nodes: Text[] = [];
  const starts: number[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(pos);
    pos += (n as Text).length;
  }
  const at = (offset: number): [Text, number] => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return [nodes[lo]!, Math.min(offset - starts[lo]!, nodes[lo]!.length)];
  };
  return (start: number, end: number): Range | null => {
    if (!nodes.length || end > pos) return null;
    const range = new Range();
    range.setStart(...at(start));
    range.setEnd(...at(end));
    return range;
  };
}

/**
 * O pseudo-C com numeros de linha, realce e os nomes das funcoes chamadas clicaveis. Com uma busca
 * no codigo, as ocorrencias ficam marcadas e a linha aberta pela busca vem para a vista.
 */
function CodeView({
  code,
  name,
  links,
  onGo,
  pattern,
  focusLine,
}: {
  code: string;
  name: string;
  links: GhidraFunctionLink[];
  onGo: (entry: string) => void;
  pattern: RegExp | null;
  focusLine: number | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const srcRef = useRef<HTMLPreElement>(null);
  const tokens = useMemo<Token[]>(
    () => (code.length > HIGHLIGHT_MAX ? [{ kind: 'plain', text: code }] : tokenizeC(code)),
    [code],
  );
  const targets = useMemo(() => linkTargets(links), [links]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const focus = focusLine !== null && focusLine <= lineCount ? focusLine : null;
  const matches = useMemo(() => (pattern ? findMatches(code, pattern) : []), [code, pattern]);

  // Marcas sem mexer nos nos (os nomes continuam botoes): CSS Custom Highlight API. Sem ela, a
  // linha aberta pela busca segue destacada na numeracao e vem para a vista do mesmo jeito.
  useEffect(() => {
    const box = boxRef.current;
    const src = srcRef.current;
    if (!box || !src) return;
    const range = rangeMaker(src);
    const others: Range[] = [];
    const current: Range[] = [];
    for (const m of matches) {
      const r = range(m.start, m.end);
      if (r) (m.line === focus ? current : others).push(r);
    }
    const registry =
      matches.length && typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
    if (registry) {
      registry.set(MATCH_HIGHLIGHT, new Highlight(...others));
      const strong = new Highlight(...current);
      strong.priority = 1;
      registry.set(CURRENT_HIGHLIGHT, strong);
    }
    // A linha da busca a um terco da altura, e a ocorrencia dentro da largura visivel.
    const line = gutterRef.current?.querySelector('.is-focus');
    if (line) {
      const b = box.getBoundingClientRect();
      box.scrollTop += line.getBoundingClientRect().top - b.top - box.clientHeight / 3;
      const r = current[0]?.getBoundingClientRect();
      const left = b.left + (gutterRef.current?.offsetWidth ?? 0);
      if (r && (r.left < left || r.right > b.right)) box.scrollLeft += r.left - left - 32;
    }
    return () => {
      registry?.delete(MATCH_HIGHLIGHT);
      registry?.delete(CURRENT_HIGHLIGHT);
    };
  }, [matches, focus, tokens]);

  return (
    <div className="dl-ghidra-code__code" ref={boxRef}>
      <pre className="dl-ghidra-code__gutter" aria-hidden="true" ref={gutterRef}>
        {focus === null ? (
          numbers(1, lineCount)
        ) : (
          <>
            {numbers(1, focus - 1)}
            {focus > 1 && '\n'}
            <span className="is-focus">{focus}</span>
            {focus < lineCount && '\n'}
            {numbers(focus + 1, lineCount)}
          </>
        )}
      </pre>
      {/* Texto puro: os pedacos viram nos de texto, nunca HTML (o pseudo-C vem de arquivo hostil). */}
      <pre
        className="dl-ghidra-code__src"
        ref={srcRef}
        tabIndex={0}
        aria-label={t('fnCodeOf', { name })}
      >
        {tokens.map((token, i) => {
          const target = token.kind === 'name' ? targets.get(token.text) : undefined;
          if (target) {
            return (
              <button
                key={i}
                type="button"
                className="dl-ghidra-code__link"
                title={t('fnGoTo', { name: token.text })}
                onClick={() => onGo(target)}
              >
                {token.text}
              </button>
            );
          }
          if (token.kind === 'plain' || token.kind === 'name') {
            return <Fragment key={i}>{token.text}</Fragment>;
          }
          return (
            <span key={i} className={`dl-c-${token.kind}`}>
              {token.text}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/** Chamadores ou chamadas: os que estao na lista viram botoes; os de fora, so o endereco. */
function LinkList({
  label,
  links,
  total,
  onGo,
}: {
  label: string;
  links: GhidraFunctionLink[];
  total: number;
  onGo: (entry: string) => void;
}) {
  if (!links.length) return null;
  return (
    <p className="dl-ghidra-code__links">
      <span className="dl-ghidra-code__links-label">{label}:</span>{' '}
      {links.map((link, i) => (
        <Fragment key={link.entry}>
          {i > 0 && ', '}
          {link.name ? (
            <button type="button" className="dl-link-button" onClick={() => onGo(link.entry)}>
              {link.name}
            </button>
          ) : (
            <code>{link.entry}</code>
          )}
        </Fragment>
      ))}
      {total > links.length && <> {t('fnMore', { n: total - links.length })}</>}
    </p>
  );
}

function FunctionView({
  fn,
  onGo,
  pattern,
  focusLine,
}: {
  fn: GhidraFunctionDetail;
  onGo: (entry: string) => void;
  pattern: RegExp | null;
  focusLine: number | null;
}) {
  return (
    <>
      <div className="dl-ghidra-code__meta">
        <p>
          {t('fnMeta', {
            size: formatFileSize(fn.size),
            complexity: fn.complexity >= 0 ? fn.complexity : '—',
          })}
          {fn.isEntryPoint && <> · {t('entryPointLower')}</>}
          {fn.library && <> · {t('fnLibrary')}</>}
          {fn.sensitive.length > 0 && (
            <>
              {' · '}
              <StatusText tone="orange">{t('calls', { apis: fn.sensitive.join(', ') })}</StatusText>
            </>
          )}
        </p>
        {fn.apis.length > 0 && (
          <p className="dl-ghidra-code__apis">{t('fnApis', { list: fn.apis.join(', ') })}</p>
        )}
        <LinkList label={t('fnCallers')} links={fn.callers} total={fn.callerCount} onGo={onGo} />
        <LinkList label={t('fnCallees')} links={fn.callees} total={fn.calleeCount} onGo={onGo} />
      </div>
      {fn.c !== null ? (
        <>
          <div className="dl-ghidra-fn__tools">
            <CopyButton value={fn.c} label={t('pseudoCOf', { name: fn.name })} />
            {fn.truncated && <span className="dl-hint-muted"> {t('fnCut')}</span>}
          </div>
          <CodeView
            code={fn.c}
            name={fn.name}
            links={fn.callees}
            onGo={onGo}
            pattern={pattern}
            focusLine={focusLine}
          />
        </>
      ) : (
        <Inline>
          {fn.skipped === 'deadline'
            ? t('fnSkippedDeadline')
            : fn.skipped === 'cap'
              ? t('fnSkippedCap')
              : t('decompileFailed', { error: fn.error ?? t('noReason') })}
        </Inline>
      )}
    </>
  );
}

/** Trecho de uma linha achada, com as ocorrencias em <mark> (texto puro, nunca HTML). */
function Snippet({ text, marks }: { text: string; marks: [number, number][] }) {
  return (
    <code className="dl-ghidra-code__hit-text">
      {splitMarks(text, marks).map((part, i) =>
        part.mark ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </code>
  );
}

/** Resultado da busca no codigo: por funcao, as linhas achadas; cada linha abre a funcao nela. */
function SearchHits({
  hits,
  current,
  onOpen,
}: {
  hits: GhidraSearchHit[];
  current: { entry: string; line: number } | null;
  onOpen: (entry: string, line: number) => void;
}) {
  return (
    <ul className="dl-ghidra-code__items" aria-label={t('fnCodeHits')}>
      {hits.map((hit) => (
        <li key={hit.entry} className="dl-ghidra-code__hit-fn">
          <p className="dl-ghidra-code__hit-name">
            <code>{hit.name}</code> <span className="dl-hint-muted">{hit.entry}</span>
            {hit.library && <span className="dl-hint-muted"> · {t('fnLibrary')}</span>}
          </p>
          <ul className="dl-ghidra-code__hit-lines">
            {hit.lines.map((l) => {
              const active = current?.entry === hit.entry && current.line === l.line;
              return (
                <li key={l.line}>
                  <button
                    type="button"
                    className={`dl-ghidra-code__item dl-ghidra-code__hit${active ? ' is-active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onOpen(hit.entry, l.line)}
                  >
                    <span className="dl-ghidra-code__hit-line">
                      {t('fnLine', { line: l.line })}
                    </span>{' '}
                    <Snippet text={l.text} marks={l.marks} />
                  </button>
                </li>
              );
            })}
          </ul>
          {hit.lineCount > hit.lines.length && (
            <p className="dl-ghidra-code__hit-more">
              {t('fnCodeMoreLines', { n: hit.lineCount - hit.lines.length })}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function RowFlags({ fn }: { fn: GhidraFunctionRow }) {
  return (
    <span className="dl-ghidra-code__flags">
      {fn.isEntryPoint && <span>{t('entryPointLower')}</span>}
      {fn.sensitive.length > 0 && (
        <StatusText tone="orange">{t('calls', { apis: fn.sensitive.join(', ') })}</StatusText>
      )}
      {fn.library && <span>{t('fnLibrary')}</span>}
      {!fn.hasCode && <span>{t('fnNoCode')}</span>}
    </span>
  );
}

/**
 * Janela com o pseudo-C de todas as funcoes (plans/ghidra-pseudo-c, fase 3): a lista paginada pelo
 * servidor (busca, filtros e ordem) e a funcao escolhida, com os nomes das funcoes chamadas
 * clicaveis e voltar/avancar. Dialogo nativo em modal: o navegador cuida do foco, do Esc e de
 * devolver o foco a quem abriu.
 */
export function GhidraCodeDialog({
  entryId,
  initialEntry,
  canDownload,
  onClose,
}: {
  entryId: string;
  /** Funcao aberta de inicio; sem ela, a primeira da lista. */
  initialEntry: string | null;
  canDownload: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [hideLibrary, setHideLibrary] = useState(false);
  const [sort, setSort] = useState<Sort>('priority');
  const [page, setPage] = useState(1);
  // Busca no codigo de todas as funcoes (fase 5): o que esta no campo e o que foi procurado.
  const [mode, setMode] = useState<'list' | 'code'>('list');
  const [codeText, setCodeText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [asked, setAsked] = useState<{ q: string; caseSensitive: boolean } | null>(null);
  // A linha aberta por um resultado da busca.
  const [focus, setFocus] = useState<{ entry: string; line: number } | null>(null);
  // Historico de navegacao: as funcoes vistas e onde se esta nele.
  const [nav, setNav] = useState(() => ({
    stack: initialEntry ? [initialEntry] : ([] as string[]),
    index: initialEntry ? 0 : -1,
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    searchRef.current?.focus();
  }, []);

  // A busca vai ao servidor quando a pessoa para de digitar.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const params = new URLSearchParams({ q, sort, page: String(page), pageSize: String(PAGE_SIZE) });
  if (sensitive) params.set('sensitive', 'true');
  if (hideLibrary) params.set('hideLibrary', 'true');
  const list = useQuery({
    queryKey: ['ghidra-fns', entryId, q, sensitive, hideLibrary, sort, page],
    queryFn: () => api.get<GhidraFunctionPage>(`/entries/${entryId}/ghidra/functions?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const data = list.data;
  // Sem nada escolhido, a primeira da lista (a de maior prioridade).
  const shown = nav.index >= 0 ? nav.stack[nav.index] : (data?.functions[0]?.entry ?? null);
  const detail = useQuery({
    queryKey: ['ghidra-fn', entryId, shown],
    queryFn: () =>
      api.get<GhidraFunctionDetail>(
        `/entries/${entryId}/ghidra/functions/${encodeURIComponent(shown!)}`,
      ),
    enabled: Boolean(shown),
    staleTime: Infinity,
  });

  const searchParams = new URLSearchParams({ q: asked?.q ?? '' });
  if (asked?.caseSensitive) searchParams.set('caseSensitive', 'true');
  if (hideLibrary) searchParams.set('hideLibrary', 'true');
  const codeSearch = useQuery({
    queryKey: ['ghidra-search', entryId, asked?.q, asked?.caseSensitive, hideLibrary],
    queryFn: () => api.get<GhidraSearchResult>(`/entries/${entryId}/ghidra/search?${searchParams}`),
    enabled: asked !== null,
    staleTime: 5 * 60_000,
    // 429 e 503 nao melhoram repetindo na hora.
    retry: false,
  });
  const found = codeSearch.data;
  // As ocorrencias ficam marcadas no codigo enquanto a busca estiver na tela.
  const pattern = useMemo(
    () => (mode === 'code' && asked ? searchRegExp(asked.q, asked.caseSensitive) : null),
    [mode, asked],
  );
  const codeTextOk = codeText.length >= 2 && codeText.trim().length > 0;

  const go = (entry: string) => {
    if (entry === shown) return;
    setNav((n) => {
      const base = n.index >= 0 ? n.stack.slice(0, n.index + 1) : shown ? [shown] : [];
      return { stack: [...base, entry], index: base.length };
    });
  };
  const openHit = (entry: string, line: number) => {
    go(entry);
    setFocus({ entry, line });
  };
  const canBack = nav.index > 0;
  const canForward = nav.index >= 0 && nav.index < nav.stack.length - 1;
  const pages = data ? Math.max(1, Math.ceil(data.matching / data.pageSize)) : 1;
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <dialog ref={dialogRef} className="dl-ghidra-code" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className="hpsm-modal__head">
        {t('fnWindowTitle')}
      </h2>
      <div className="dl-ghidra-code__body">
        <section className="dl-ghidra-code__list" aria-label={t('fnList')}>
          <fieldset className="dl-ghidra-code__mode">
            <legend className="cds--visually-hidden">{t('fnMode')}</legend>
            {(['list', 'code'] as const).map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name={`${titleId}-mode`}
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />{' '}
                {t(m === 'list' ? 'fnModeList' : 'fnModeCode')}
              </label>
            ))}
          </fieldset>
          {mode === 'code' ? (
            <>
              <form
                className="dl-ghidra-code__codeform"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!codeTextOk) return;
                  setAsked({ q: codeText, caseSensitive });
                  setFocus(null);
                }}
              >
                <TextInput
                  id={`${titleId}-code`}
                  type="search"
                  size="sm"
                  labelText={t('fnCodeSearch')}
                  helperText={t('fnCodeSearchHelp')}
                  value={codeText}
                  maxLength={200}
                  onChange={(e) => setCodeText(e.target.value.replace(/[\r\n]+/g, ' '))}
                />
                <Checkbox
                  id={`${titleId}-case`}
                  labelText={t('fnCaseSensitive')}
                  checked={caseSensitive}
                  onChange={(_, { checked }) => setCaseSensitive(checked)}
                />
                <Checkbox
                  id={`${titleId}-code-library`}
                  labelText={t('fnHideLibrary')}
                  checked={hideLibrary}
                  onChange={(_, { checked }) => filter(() => setHideLibrary(checked))}
                />
                <button type="submit" className="dl-btn" disabled={!codeTextOk}>
                  {t('fnCodeSearchGo')}
                </button>
              </form>
              <div className="dl-ghidra-code__count" aria-live="polite">
                {codeSearch.isFetching ? (
                  <p>{t('fnSearching')}</p>
                ) : found ? (
                  <>
                    <p>
                      {found.matchedFunctions
                        ? t('fnCodeFound', {
                            lines: found.matchedLines,
                            fns: found.matchedFunctions,
                            scanned: found.scanned,
                          })
                        : t('fnCodeNone', { scanned: found.scanned })}
                    </p>
                    {found.truncated && <p>{t('fnCodeTruncated', { n: found.results.length })}</p>}
                    {found.partial && <p>{t('fnCodePartial')}</p>}
                  </>
                ) : null}
              </div>
              {codeSearch.isError ? (
                <Inline error>{(codeSearch.error as Error).message}</Inline>
              ) : found && found.results.length > 0 ? (
                <SearchHits hits={found.results} current={focus} onOpen={openHit} />
              ) : null}
            </>
          ) : (
            <>
              <TextInput
                id={`${titleId}-q`}
                ref={searchRef}
                type="search"
                size="sm"
                labelText={t('fnSearch')}
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                id={`${titleId}-sort`}
                size="sm"
                labelText={t('fnSort')}
                value={sort}
                onChange={(e) => filter(() => setSort(e.target.value as Sort))}
              >
                {SORTS.map((s) => (
                  <SelectItem key={s} value={s} text={t(SORT_LABEL[s])} />
                ))}
              </Select>
              <Checkbox
                id={`${titleId}-sensitive`}
                labelText={t('fnOnlySensitive')}
                checked={sensitive}
                onChange={(_, { checked }) => filter(() => setSensitive(checked))}
              />
              <Checkbox
                id={`${titleId}-library`}
                labelText={t('fnHideLibrary')}
                checked={hideLibrary}
                onChange={(_, { checked }) => filter(() => setHideLibrary(checked))}
              />
              {data && (
                <div className="dl-ghidra-code__count" aria-live="polite">
                  <p>{t('fnMatching', { matching: data.matching, listed: data.listed })}</p>
                  {data.total !== null && data.total > data.listed && (
                    <p>{t('fnNotListed', { total: data.total, listed: data.listed })}</p>
                  )}
                  {data.deadlineHit && <p>{t('fnDeadlineHit')}</p>}
                  {data.capHit && <p>{t('fnCapHit')}</p>}
                </div>
              )}
              {list.isError ? (
                <Inline error>{(list.error as Error).message}</Inline>
              ) : !data ? (
                <HpsmLoading text={t('loading')} />
              ) : data.functions.length === 0 ? (
                <Inline>{t('fnNone')}</Inline>
              ) : (
                <ul className="dl-ghidra-code__items">
                  {data.functions.map((fn) => (
                    <li key={fn.entry}>
                      <button
                        type="button"
                        className={`dl-ghidra-code__item${fn.entry === shown ? ' is-active' : ''}`}
                        aria-current={fn.entry === shown ? 'true' : undefined}
                        onClick={() => go(fn.entry)}
                      >
                        <code>{fn.name}</code> <span className="dl-hint-muted">{fn.entry}</span>
                        <RowFlags fn={fn} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {pages > 1 && (
                <div className="dl-ghidra-code__pager">
                  <button
                    type="button"
                    className="dl-btn"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t('fnPrev')}
                  </button>
                  <span>{t('fnPage', { page, pages })}</span>
                  <button
                    type="button"
                    className="dl-btn"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('fnNext')}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="dl-ghidra-code__view" aria-labelledby={`${titleId}-fn`}>
          <div className="dl-ghidra-code__bar">
            <button
              type="button"
              className="dl-btn"
              disabled={!canBack}
              title={t('fnBackHelp')}
              onClick={() => setNav((n) => ({ ...n, index: n.index - 1 }))}
            >
              {t('fnBack')}
            </button>
            <button
              type="button"
              className="dl-btn"
              disabled={!canForward}
              title={t('fnForwardHelp')}
              onClick={() => setNav((n) => ({ ...n, index: n.index + 1 }))}
            >
              {t('fnForward')}
            </button>
            <h3 id={`${titleId}-fn`} className="dl-ghidra-code__name">
              {detail.data ? (
                <>
                  <code>{detail.data.name}</code>{' '}
                  <span className="dl-hint-muted">{detail.data.entry}</span>
                </>
              ) : (
                (shown ?? '')
              )}
            </h3>
          </div>
          {!shown ? (
            <Inline>{t('fnPick')}</Inline>
          ) : detail.isError ? (
            <Inline error>{(detail.error as Error).message}</Inline>
          ) : !detail.data ? (
            <HpsmLoading text={t('loading')} />
          ) : (
            <FunctionView
              fn={detail.data}
              onGo={go}
              pattern={pattern}
              focusLine={focus?.entry === detail.data.entry ? focus.line : null}
            />
          )}
        </section>
      </div>
      <div className="hpsm-modal__actions">
        {canDownload && (
          <a
            className="dl-link dl-ghidra-code__download"
            href={`/api/entries/${entryId}/ghidra/pseudo-c`}
            download
          >
            {t('downloadPseudo')}
          </a>
        )}
        <button
          type="button"
          className="dl-btn dl-btn--primary"
          onClick={() => dialogRef.current?.close()}
        >
          {t('close')}
        </button>
      </div>
    </dialog>
  );
}
