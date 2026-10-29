/**
 * Decodificador (item 85): passos encadeados sobre bytes, todos no navegador.
 * O resultado e sempre mostrado como texto ou hex, nunca como HTML.
 */

export type StepId =
  | 'base64'
  | 'hex'
  | 'url'
  | 'psenc'
  | 'utf16'
  | 'xor'
  | 'inflate'
  | 'rot13'
  | 'reverse'
  | 'charcodes';

export interface Step {
  id: StepId;
  /** Chave do XOR (texto ou hex com 0x). */
  param?: string;
}

export const STEPS: Record<StepId, { label: string; param?: string }> = {
  base64: { label: 'Base64' },
  hex: { label: 'Hex' },
  url: { label: 'URL (%xx)' },
  psenc: { label: 'PowerShell -EncodedCommand' },
  utf16: { label: 'UTF-16LE → texto' },
  xor: { label: 'XOR', param: 'Chave (texto ou 0x41 0x42…)' },
  inflate: { label: 'Descompactar (gzip/zlib/deflate)' },
  rot13: { label: 'ROT13' },
  reverse: { label: 'Inverter' },
  charcodes: { label: 'Códigos de caractere (72,101,…)' },
};

/** Entrada maxima (bytes). */
export const DECODER_MAX = 1024 * 1024;

export class DecodeError extends Error {}

const latin1 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
};
const fromLatin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const utf8 = new TextEncoder();
const textOf = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

function base64(bytes: Uint8Array): Uint8Array {
  const clean = latin1(bytes).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length === 0) {
    throw new DecodeError('não é Base64 (caracteres fora de A–Z, a–z, 0–9, +, /)');
  }
  const padded = clean.padEnd(Math.ceil(clean.length / 4) * 4, '=');
  try {
    return fromLatin1(atob(padded));
  } catch {
    throw new DecodeError('Base64 com tamanho inválido');
  }
}

function hex(bytes: Uint8Array): Uint8Array {
  const clean = latin1(bytes)
    .replace(/0x|\\x|[\s,;:]/gi, '')
    .toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length === 0)
    throw new DecodeError('não é hex (0–9, a–f)');
  if (clean.length % 2) throw new DecodeError('hex com número ímpar de dígitos');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function url(bytes: Uint8Array): Uint8Array {
  const text = latin1(bytes).replace(/\+/g, ' ');
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const m = text.slice(i).match(/^%u([0-9a-f]{4})|^%([0-9a-f]{2})/i);
    if (m?.[1]) {
      out.push(...utf8.encode(String.fromCharCode(parseInt(m[1], 16))));
      i += 5;
    } else if (m?.[2]) {
      out.push(parseInt(m[2], 16));
      i += 2;
    } else {
      out.push(text.charCodeAt(i) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const utf16 = (bytes: Uint8Array) =>
  utf8.encode(new TextDecoder('utf-16le').decode(bytes.length % 2 ? bytes.subarray(0, -1) : bytes));

function xor(bytes: Uint8Array, param = ''): Uint8Array {
  const raw = param.trim();
  if (!raw) throw new DecodeError('informe a chave do XOR');
  const key = /^(0x[0-9a-f]{1,2}[\s,]*)+$/i.test(raw)
    ? Uint8Array.from(raw.match(/0x([0-9a-f]{1,2})/gi)!.map((h) => parseInt(h.slice(2), 16)))
    : utf8.encode(raw);
  return bytes.map((b, i) => b ^ key[i % key.length]);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  for (const format of ['gzip', 'deflate', 'deflate-raw'] as CompressionFormat[]) {
    try {
      const stream = new Blob([new Uint8Array(bytes)])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      const out = new Uint8Array(await new Response(stream).arrayBuffer());
      if (out.length) return out;
    } catch {
      /* proximo formato */
    }
  }
  throw new DecodeError('não é gzip, zlib nem deflate');
}

const rot13 = (bytes: Uint8Array) =>
  bytes.map((b) =>
    b >= 65 && b <= 90
      ? ((b - 65 + 13) % 26) + 65
      : b >= 97 && b <= 122
        ? ((b - 97 + 13) % 26) + 97
        : b,
  );

function charcodes(bytes: Uint8Array): Uint8Array {
  const parts = latin1(bytes).match(/0x[0-9a-f]+|\d+/gi);
  if (!parts?.length) throw new DecodeError('nenhum número encontrado');
  return utf8.encode(String.fromCharCode(...parts.map((p) => Number(p))));
}

/** Aplica os passos em ordem; para no primeiro que falhar (com o motivo). */
export async function runSteps(
  input: string,
  steps: Step[],
): Promise<{ bytes: Uint8Array; error?: { index: number; message: string } }> {
  let bytes: Uint8Array = utf8.encode(input);
  if (bytes.length > DECODER_MAX) {
    return { bytes: bytes.subarray(0, 0), error: { index: -1, message: 'texto maior que 1 MB' } };
  }
  for (const [index, step] of steps.entries()) {
    try {
      switch (step.id) {
        case 'base64':
          bytes = base64(bytes);
          break;
        case 'hex':
          bytes = hex(bytes);
          break;
        case 'url':
          bytes = url(bytes);
          break;
        case 'psenc':
          bytes = utf16(base64(bytes));
          break;
        case 'utf16':
          bytes = utf16(bytes);
          break;
        case 'xor':
          bytes = xor(bytes, step.param);
          break;
        case 'inflate':
          bytes = await inflate(bytes);
          break;
        case 'rot13':
          bytes = rot13(bytes);
          break;
        case 'reverse':
          bytes = utf8.encode([...textOf(bytes)].reverse().join(''));
          break;
        case 'charcodes':
          bytes = charcodes(bytes);
          break;
      }
    } catch (err) {
      return {
        bytes,
        error: { index, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
  return { bytes };
}

/** Sugere o proximo passo pelo jeito do texto atual (ou null). */
export function suggestStep(bytes: Uint8Array): StepId | null {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'inflate';
  const text = latin1(bytes.subarray(0, 4096)).trim();
  if (!text) return null;
  let zeros = 0;
  for (let i = 1; i < Math.min(bytes.length, 400); i += 2) if (bytes[i] === 0) zeros++;
  if (zeros > Math.min(bytes.length, 400) / 4) return 'utf16';
  if (
    /^(?:0x)?[0-9a-f\s]+$/i.test(text) &&
    text.replace(/\s|0x/gi, '').length % 2 === 0 &&
    text.length >= 8
  ) {
    return 'hex';
  }
  if (/^(?:\d{2,3}\s*,\s*){3,}\d{2,3}$/.test(text)) return 'charcodes';
  if (/%[0-9a-f]{2}/i.test(text) && !/\s/.test(text)) return 'url';
  if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(text.replace(/\s+/g, ''))) return 'base64';
  return null;
}

/** Texto do resultado (UTF-8; bytes invalidos viram �). */
export const resultText = (bytes: Uint8Array) => textOf(bytes);

/** Hex com deslocamento, 16 bytes por linha (ate `limit` bytes). */
export function hexDump(bytes: Uint8Array, limit = 4096): string {
  const lines: string[] = [];
  for (let off = 0; off < Math.min(bytes.length, limit); off += 16) {
    const row = bytes.subarray(off, off + 16);
    const hexes = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const chars = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hexes.padEnd(47)}  ${chars}`);
  }
  return lines.join('\n');
}
