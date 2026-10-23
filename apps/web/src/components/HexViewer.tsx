import { useState } from 'react';

import { api } from '../api/client';
import { formatFileSize } from './HpsmFileDrop';
import { HpsmSection } from './HpsmForm';
import { HpsmLoading, HpsmMessage } from './messages';

const BLOCK = 4 * 1024;
const PER_LINE = 16;

/** Cabecalhos conhecidos destacados no comeco do arquivo. */
const MAGICS: { bytes: number[]; name: string }[] = [
  { bytes: [0x4d, 0x5a], name: 'MZ — executável do Windows (PE)' },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], name: 'ELF — executável Linux' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], name: 'PK — ZIP (também Office moderno, JAR, APK)' },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: '%PDF — documento PDF' },
  {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    name: 'OLE — Office antigo (doc, xls, msi)',
  },
  { bytes: [0x52, 0x61, 0x72, 0x21], name: 'Rar! — arquivo RAR' },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], name: '7z — arquivo 7-Zip' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name: 'PNG — imagem' },
  { bytes: [0xff, 0xd8, 0xff], name: 'JPEG — imagem' },
  { bytes: [0x47, 0x49, 0x46, 0x38], name: 'GIF — imagem' },
  { bytes: [0x1f, 0x8b], name: 'GZIP — arquivo compactado' },
];

interface HexChunk {
  offset: number;
  size: number;
  limit: number;
  data: string;
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');
const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

/**
 * Secao "Conteudo (hex)" da aba Analise (item 57): os primeiros 4 KB do arquivo
 * em hexadecimal + texto, "Mostrar mais" de 4 em 4 KB ate 64 KB, e o cabecalho
 * conhecido (MZ, PK, %PDF...) destacado. Nada e baixado nem executado.
 */
export function HexViewer({ entryId, purged }: { entryId: string; purged: boolean }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [meta, setMeta] = useState<{ size: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HexChunk>(
        `/entries/${entryId}/hex?offset=${offset}&length=${BLOCK}`,
      );
      const chunk = decode(res.data);
      setMeta({ size: res.size, limit: res.limit });
      setBytes((prev) => {
        if (!prev || offset === 0) return chunk;
        const merged = new Uint8Array(prev.length + chunk.length);
        merged.set(prev);
        merged.set(chunk, prev.length);
        return merged;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (purged) {
    return (
      <HpsmSection title="Conteúdo (hex)">
        <p className="dl-static-empty">
          Indisponível: o arquivo desta amostra foi expurgado pela política de retenção.
        </p>
      </HpsmSection>
    );
  }

  const magic = bytes
    ? MAGICS.find((m) => m.bytes.length <= bytes.length && m.bytes.every((b, i) => bytes[i] === b))
    : undefined;
  const magicLen = magic?.bytes.length ?? 0;
  const lines: number[] = [];
  if (bytes) for (let i = 0; i < bytes.length; i += PER_LINE) lines.push(i);
  const more = bytes && meta && bytes.length < meta.limit;

  return (
    <HpsmSection title="Conteúdo (hex)">
      {error && <HpsmMessage kind="error">{error}</HpsmMessage>}
      {!bytes ? (
        <p className="dl-static-empty">
          Mostra os primeiros bytes do arquivo em hexadecimal, sem baixar nem executar.{' '}
          <button
            type="button"
            className="dl-link-button"
            disabled={loading}
            onClick={() => void load(0)}
          >
            {loading ? 'Carregando...' : 'Mostrar conteúdo'}
          </button>
        </p>
      ) : (
        <>
          <p className="dl-hex__info">
            Exibindo {formatFileSize(bytes.length)} de {formatFileSize(meta?.size)}
            {meta && meta.size > meta.limit
              ? ` (o visualizador vai até ${formatFileSize(meta.limit)})`
              : ''}
            {magic && (
              <>
                {' '}
                · cabeçalho: <mark className="dl-hex__magic">{magic.name}</mark>
              </>
            )}
          </p>
          <pre className="dl-hex" aria-label="Conteúdo do arquivo em hexadecimal">
            {lines.map((start) => {
              const row = Array.from(bytes.subarray(start, start + PER_LINE));
              return (
                <div key={start} className="dl-hex__line">
                  <span className="dl-hex__offset">{hex(start, 8)}</span>
                  <span className="dl-hex__bytes">
                    {Array.from({ length: PER_LINE }, (_, i) => {
                      const b = row[i];
                      const cls = start + i < magicLen ? 'dl-hex__byte is-magic' : 'dl-hex__byte';
                      return (
                        <span key={i} className={cls}>
                          {b === undefined ? '  ' : hex(b, 2)}
                          {i === 7 ? '  ' : ' '}
                        </span>
                      );
                    })}
                  </span>
                  <span className="dl-hex__text">{row.map(printable).join('')}</span>
                </div>
              );
            })}
          </pre>
          {more && (
            <button
              type="button"
              className="dl-link-button"
              disabled={loading}
              onClick={() => void load(bytes.length)}
            >
              {loading ? 'Carregando...' : 'Mostrar mais 4 KB'}
            </button>
          )}
          {loading && <HpsmLoading text="Lendo o arquivo..." />}
        </>
      )}
    </HpsmSection>
  );
}
