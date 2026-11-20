import { TextInput } from '@carbon/react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { api } from '../api/client';
import { localized } from '../i18n';
import { t } from '../i18n/analysis';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';

const BLOCK = 4 * 1024;
const PER_LINE = 16;
/** Linhas de contexto antes da posicao procurada. */
const CONTEXT_LINES = 8;

/** Cabecalhos conhecidos destacados no comeco do arquivo. */
const MAGICS: { bytes: number[]; name: string }[] = localized(() => [
  { bytes: [0x4d, 0x5a], name: t('magicMz') },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], name: t('magicElf') },
  { bytes: [0x50, 0x4b, 0x03, 0x04], name: t('magicPk') },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: t('magicPdf') },
  {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    name: t('magicOle'),
  },
  { bytes: [0x52, 0x61, 0x72, 0x21], name: t('magicRar') },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], name: t('magic7z') },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: t('magicPng') },
  { bytes: [0xff, 0xd8, 0xff], name: t('magicJpeg') },
  { bytes: [0x47, 0x49, 0x46, 0x38], name: t('magicGif') },
  { bytes: [0x1f, 0x8b], name: t('magicGzip') },
]);

interface HexChunk {
  offset: number;
  size: number;
  limit: number;
  data: string;
}

type Encoding = 'utf8' | 'utf16' | 'bytes';
interface SearchResult {
  q: string;
  kind: 'text' | 'bytes';
  hits: { offset: number; length: number; encoding: Encoding }[];
  truncated: boolean;
}

/** O trecho exibido: a partir de `base`, contiguo. */
interface View {
  base: number;
  bytes: Uint8Array;
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');
const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

/** "0x1A30", "1a30h" ou "6704" (decimal) -> posicao; null se nao for numero. */
export function parseOffset(text: string): number | null {
  const v = text.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(v)) return parseInt(v.slice(2), 16);
  if (/^[0-9a-f]+h$/.test(v)) return parseInt(v.slice(0, -1), 16);
  if (/^\d+$/.test(v)) return Number(v);
  return null;
}

const ENCODING_LABEL = { utf8: 'encUtf8', utf16: 'encUtf16', bytes: 'encBytes' } as const;

/**
 * Secao "Conteudo (hex)" da aba Detalhes (item 57): o arquivo em hexadecimal + texto, de 4 em 4 KB,
 * com o cabecalho conhecido (MZ, PK, %PDF...) destacado. A busca (plans/ajustes-usabilidade, item
 * 7) procura um texto (ASCII e UTF-16, sem diferenciar maiusculas) ou bytes no arquivo inteiro, na
 * API; cada posicao achada, ou digitada em "Ir para", abre o trecho dela com os bytes destacados.
 * Nada e baixado nem executado.
 */
interface LayoutField {
  path: string;
  start: number;
  end: number;
  value: string;
}

interface Layout {
  size: number;
  read: number;
  blockSize: number;
  entropy: number[];
  marks: { kind: string; label: string; start: number; end: number }[];
  format: string | null;
  fields: LayoutField[];
}

const MAP_W = 800;
const MAP_H = 60;
const MARK_H = 14;

/**
 * Entropia por bloco do arquivo inteiro (item 27), com as secoes, o overlay, os segmentos ou os
 * arquivos do ZIP marcados embaixo. O clique abre o hex na posicao.
 */
function EntropyMap({ layout, onPick }: { layout: Layout; onPick: (offset: number) => void }) {
  const n = layout.entropy.length;
  const w = MAP_W / n;
  const x = (offset: number) => (offset / Math.max(1, layout.read)) * MAP_W;
  return (
    <figure className="dl-entropy">
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H + MARK_H}`}
        role="img"
        aria-label={t('entropyAria')}
        preserveAspectRatio="none"
      >
        {layout.entropy.map((h, i) => (
          <rect
            key={i}
            className={h >= 7.2 ? 'dl-entropy__bar is-high' : 'dl-entropy__bar'}
            x={i * w}
            y={MAP_H - (h / 8) * MAP_H}
            width={Math.max(w, 1)}
            height={(h / 8) * MAP_H}
            onClick={() => onPick(i * layout.blockSize)}
          >
            <title>{`0x${(i * layout.blockSize).toString(16)} · ${t('entropyValue', { n: h })}`}</title>
          </rect>
        ))}
        {layout.marks.map((m, i) => (
          <rect
            key={`${m.label}-${i}`}
            className={`dl-entropy__mark dl-entropy__mark--${m.kind}`}
            x={x(m.start)}
            y={MAP_H + 2}
            width={Math.max(x(m.end) - x(m.start), 1)}
            height={MARK_H - 4}
            onClick={() => onPick(m.start)}
          >
            <title>{`${m.label} · 0x${m.start.toString(16)}–0x${m.end.toString(16)}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="dl-hint-muted">{t('entropyCaption')}</figcaption>
    </figure>
  );
}

export function HexViewer({ entryId, purged }: { entryId: string; purged: boolean }) {
  const id = useId();
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mark, setMark] = useState<{ offset: number; length: number } | null>(null);
  const [kind, setKind] = useState<'text' | 'bytes'>('text');
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [gotoError, setGotoError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  // Mapa do arquivo (item 27): entropia, marcas e estrutura, lidos quando o conteudo abre.
  const [layout, setLayout] = useState<Layout | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const markRef = useRef<HTMLDivElement>(null);

  const fetchBlock = async (offset: number, length = BLOCK) => {
    const res = await api.get<HexChunk>(
      `/entries/${entryId}/hex?offset=${offset}&length=${length}`,
    );
    setSize(res.size);
    return decode(res.data);
  };

  /** Le um bloco e o poe no lugar do trecho, depois dele ou antes dele. */
  const load = async (offset: number, mode: 'replace' | 'append' | 'prepend' = 'replace') => {
    setLoading(true);
    setError(null);
    try {
      const start = mode === 'prepend' ? Math.max(0, offset - BLOCK) : offset;
      const chunk = await fetchBlock(start, mode === 'prepend' ? offset - start : BLOCK);
      setView((prev) => {
        if (!prev || mode === 'replace') return { base: start, bytes: chunk };
        const merged = new Uint8Array(prev.bytes.length + chunk.length);
        if (mode === 'append') {
          merged.set(prev.bytes);
          merged.set(chunk, prev.bytes.length);
          return { base: prev.base, bytes: merged };
        }
        merged.set(chunk);
        merged.set(prev.bytes, chunk.length);
        return { base: start, bytes: merged };
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadLayout = async () => {
    if (layout) return;
    try {
      setLayout(await api.get<Layout>(`/entries/${entryId}/layout`));
    } catch {
      // Sem o mapa, o hex funciona do mesmo jeito.
    }
  };

  /** O campo mais interno da estrutura que cobre a posicao. */
  const fieldAt = (offset: number) => {
    let best: LayoutField | null = null;
    for (const f of layout?.fields ?? []) {
      if (
        f.start <= offset &&
        offset < f.end &&
        (!best || f.end - f.start <= best.end - best.start)
      ) {
        best = f;
      }
    }
    return best;
  };

  /** Abre o trecho da posicao, com algumas linhas antes, e destaca os bytes dela. */
  const jump = async (offset: number, length = 1) => {
    setMark({ offset, length });
    const line = Math.floor(offset / PER_LINE) * PER_LINE;
    await load(Math.max(0, line - CONTEXT_LINES * PER_LINE));
  };

  // A linha destacada fica a vista dentro da caixa (so ela rola, nao a pagina).
  useEffect(() => {
    const pre = preRef.current;
    const line = markRef.current;
    if (pre && line) pre.scrollTop = Math.max(0, line.offsetTop - pre.clientHeight / 3);
  }, [view, mark]);

  const runSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, kind });
      setSearch(await api.get<SearchResult>(`/entries/${entryId}/hex/search?${params}`));
    } catch (err) {
      setSearch(null);
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const goTo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const offset = parseOffset(String(new FormData(e.currentTarget).get('offset') ?? ''));
    if (offset === null || (size !== null && offset >= size)) {
      setGotoError(offset === null ? t('gotoInvalid') : t('gotoPastEnd'));
      return;
    }
    setGotoError(null);
    void jump(offset);
  };

  if (purged) {
    return (
      <HpsmSection title={t('hexTitle')}>
        <p className="dl-static-empty">{t('hexPurged')}</p>
      </HpsmSection>
    );
  }

  const bytes = view?.bytes;
  const base = view?.base ?? 0;
  const magic =
    bytes && base === 0
      ? MAGICS.find(
          (m) => m.bytes.length <= bytes.length && m.bytes.every((b, i) => bytes[i] === b),
        )
      : undefined;
  const magicLen = magic?.bytes.length ?? 0;
  const marked = (at: number) =>
    mark !== null && at >= mark.offset && at < mark.offset + mark.length;
  const lines: number[] = [];
  if (bytes) for (let i = 0; i < bytes.length; i += PER_LINE) lines.push(i);
  const end = base + (bytes?.length ?? 0);
  const more = bytes && size !== null && end < size;

  const searchForm = (
    <search className="dl-hex__tools">
      <form
        className="dl-hex__search"
        aria-label={t('hexSearchLabel')}
        onSubmit={(e) => void runSearch(e)}
      >
        <TextInput
          id={`${id}-q`}
          name="q"
          type="search"
          size="sm"
          labelText={t('hexSearchLabel')}
          helperText={t(kind === 'text' ? 'hexSearchHelpText' : 'hexSearchHelpBytes')}
          maxLength={1024}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          required
        />
        <fieldset className="dl-hex__kind">
          <legend className="cds--visually-hidden">{t('hexSearchKind')}</legend>
          {(['text', 'bytes'] as const).map((k) => (
            <label key={k}>
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />{' '}
              {t(k === 'text' ? 'hexKindText' : 'hexKindBytes')}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="dl-btn" disabled={searching}>
          {searching ? t('hexSearching') : t('hexSearchButton')}
        </button>
      </form>
      <form className="dl-hex__goto" aria-label={t('gotoLabel')} onSubmit={goTo}>
        <TextInput
          id={`${id}-offset`}
          name="offset"
          size="sm"
          labelText={t('gotoLabel')}
          helperText={t('gotoHelp')}
          invalid={Boolean(gotoError)}
          invalidText={gotoError ?? ''}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onInput={() => setGotoError(null)}
          required
        />
        <button type="submit" className="dl-btn" disabled={loading}>
          {t('gotoButton')}
        </button>
      </form>
    </search>
  );

  return (
    <HpsmSection title={t('hexTitle')}>
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {searchForm}
      {search && (
        <div className="dl-hex__results">
          <p role="status">
            {search.hits.length === 0
              ? t('hexNoHits', { q: search.q })
              : t(search.truncated ? 'hexHitsCut' : 'hexHits', { n: search.hits.length })}
          </p>
          {search.hits.length > 0 && (
            <ol className="dl-hex__hits">
              {search.hits.map((h) => (
                <li key={`${h.offset}-${h.encoding}`}>
                  <button
                    type="button"
                    className="dl-link-button"
                    aria-current={mark?.offset === h.offset ? 'location' : undefined}
                    onClick={() => void jump(h.offset, h.length)}
                  >
                    0x{hex(h.offset, 8)}
                  </button>{' '}
                  <span className="dl-hex__enc">{t(ENCODING_LABEL[h.encoding])}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {!bytes ? (
        <p className="dl-static-empty">
          {t('hexHelp')}{' '}
          <button
            type="button"
            className="dl-link-button"
            disabled={loading}
            onClick={() => {
              void load(0);
              void loadLayout();
            }}
          >
            {loading ? t('loadingDots') : t('showContent')}
          </button>
        </p>
      ) : (
        <>
          <p className="dl-hex__info">
            {t('hexShowingRange', {
              from: hex(base, 8),
              to: hex(Math.max(base, end - 1), 8),
              n: formatFileSize(bytes.length),
              total: formatFileSize(size),
            })}
            {magic && (
              <>
                {' '}
                {t('header')} <mark className="dl-hex__magic">{magic.name}</mark>
              </>
            )}
          </p>
          {base > 0 && (
            <button
              type="button"
              className="dl-link-button"
              disabled={loading}
              onClick={() => void load(base, 'prepend')}
            >
              {t('showPrev4k')}
            </button>
          )}
          {layout && layout.entropy.length > 0 && (
            <EntropyMap layout={layout} onPick={(offset) => void jump(offset)} />
          )}
          <pre
            className="dl-hex"
            aria-label={t('hexAria')}
            ref={preRef}
            onMouseOver={(e) => {
              const off = (e.target as HTMLElement).dataset?.off;
              setHovered(off === undefined ? null : Number(off));
            }}
          >
            {lines.map((rel) => {
              const start = base + rel;
              const row = Array.from(bytes.subarray(rel, rel + PER_LINE));
              const hasMark = row.some((_, i) => marked(start + i));
              // A primeira linha do trecho destacado e a que fica a vista.
              const firstMark = hasMark && !marked(start - 1);
              return (
                <div
                  key={start}
                  className={hasMark ? 'dl-hex__line has-mark' : 'dl-hex__line'}
                  ref={firstMark ? markRef : undefined}
                >
                  <span className="dl-hex__offset">{hex(start, 8)}</span>
                  <span className="dl-hex__bytes">
                    {Array.from({ length: PER_LINE }, (_, i) => {
                      const b = row[i];
                      let cls = 'dl-hex__byte';
                      if (start + i < magicLen) cls += ' is-magic';
                      if (marked(start + i)) cls += ' is-match';
                      return (
                        <span key={i} className={cls} data-off={start + i}>
                          {b === undefined ? '  ' : hex(b, 2)}
                          {i === 7 ? '  ' : ' '}
                        </span>
                      );
                    })}
                  </span>
                  <span className="dl-hex__text">
                    {hasMark
                      ? row.map((b, i) => (
                          <span key={i} className={marked(start + i) ? 'is-match' : undefined}>
                            {printable(b)}
                          </span>
                        ))
                      : row.map(printable).join('')}
                  </span>
                </div>
              );
            })}
          </pre>
          {layout && layout.fields.length > 0 && (
            <p className="dl-hex__field" role="status">
              {(() => {
                const f = hovered === null ? null : fieldAt(hovered);
                return f
                  ? `0x${hex(hovered!, 8)} · ${f.path}${f.value ? ` = ${f.value}` : ''}`
                  : t('hexFieldHint', { format: layout.format ?? '' });
              })()}
            </p>
          )}
          {more && (
            <button
              type="button"
              className="dl-link-button"
              disabled={loading}
              onClick={() => void load(end, 'append')}
            >
              {loading ? t('loadingDots') : t('showMore4k')}
            </button>
          )}
          {loading && <HpsmLoading text={t('readingFile')} />}
        </>
      )}
    </HpsmSection>
  );
}
