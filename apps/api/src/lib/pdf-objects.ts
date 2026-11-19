import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

/**
 * Leitor dos objetos de um PDF (plans/analise-estatica-ampliada, item 8): o dicionario e o stream
 * de cada objeto (`n g obj ... endobj`), os objetos comprimidos em ObjStm, os streams FlateDecode
 * decodificados e, no PDF cifrado com a senha de usuario vazia (o caso comum de malware: abre sem
 * pedir senha, mas a leitura comum ve so bytes cifrados), tudo decifrado (RC4 e AES-128 nas
 * revisoes 2 a 4; AES-256 na 6). Daqui saem o JavaScript e os arquivos embutidos.
 *
 * O arquivo e hostil: teto de objetos, de bytes decodificados e de tamanho de string; nada lanca.
 */

const MAX_OBJECTS = 20_000;
const MAX_STREAM = 16 * 1024 * 1024;
const MAX_DECODED_TOTAL = 64 * 1024 * 1024;
const MAX_STRING = 1024 * 1024;
const MAX_EMBEDDED = 40;
const MAX_SCRIPTS = 50;
const MAX_OBJSTM = 2000;

export interface PdfObject {
  num: number;
  gen: number;
  /** O dicionario (ou o valor) do objeto, com as strings ja decifradas. */
  dict: string;
  /** O stream decodificado (FlateDecode ou sem filtro), quando ha e coube no teto. */
  data: Buffer | null;
  /** Saiu de dentro de um ObjStm. */
  compressed: boolean;
}

export interface PdfEncryption {
  /** V e R do dicionario /Encrypt e o metodo. */
  version: number;
  revision: number;
  method: 'RC4' | 'AES-128' | 'AES-256' | 'desconhecido';
  /** Decifrado com a senha de usuario vazia. */
  decrypted: boolean;
}

export interface PdfRead {
  objects: PdfObject[];
  encryption: PdfEncryption | null;
  /** Texto para as regras: o arquivo e os streams decodificados, como a analise ja fazia. */
  text: string;
  scripts: string[];
  embedded: { name: string; data: Buffer; object: number }[];
}

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();

/** String literal do PDF em bytes (escapes, octal, continuacao de linha). */
export function literalBytes(text: string, from: number): { bytes: Buffer; end: number } {
  const out: number[] = [];
  let depth = 0;
  let i = from;
  for (; i < text.length && out.length < MAX_STRING; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) {
      const n = text[++i];
      if (n === undefined) break;
      const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      if (n in map) out.push(map[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(text[i + 1] ?? '')) oct += text[++i];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === '\r') {
        if (text[i + 1] === '\n') i++;
      } else if (n !== '\n') out.push(n.charCodeAt(0) & 0xff);
      continue;
    }
    if (c === 0x28) {
      if (depth++ === 0) continue;
    } else if (c === 0x29) {
      if (--depth === 0) break;
    }
    if (depth > 0) out.push(c & 0xff);
  }
  return { bytes: Buffer.from(out), end: i };
}

const hexBytes = (hex: string) => {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  return Buffer.from(clean.length % 2 ? `${clean}0` : clean, 'hex');
};

/** O valor de string de uma chave do dicionario (literal ou hexadecimal), em bytes. */
export function dictString(dict: string, key: string): Buffer | null {
  const m = new RegExp(`/${key}\\s*([(<])`).exec(dict);
  if (!m) return null;
  const at = m.index + m[0].length - 1;
  if (m[1] === '(') return literalBytes(dict, at).bytes;
  if (dict[at + 1] === '<') return null;
  const end = dict.indexOf('>', at);
  return end > at ? hexBytes(dict.slice(at + 1, end)) : null;
}

const dictNumber = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(-?\\d+)`).exec(dict);
  return m ? Number(m[1]) : null;
};

/** Texto latin1 de bytes decodificados (UTF-16BE com BOM vira texto). */
export function pdfTextString(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('latin1');
}

interface Cipher {
  method: PdfEncryption['method'];
  /** Decifra o stream ou a string do objeto. */
  decrypt: (data: Buffer, num: number, gen: number) => Buffer;
}

function aesDecrypt(key: Buffer, data: Buffer): Buffer {
  if (data.length < 32 || data.length % 16) return Buffer.alloc(0);
  try {
    const d = createDecipheriv(
      key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc',
      key,
      data.subarray(0, 16),
    );
    return Buffer.concat([d.update(data.subarray(16)), d.final()]);
  } catch {
    return Buffer.alloc(0);
  }
}

/** Algoritmo 2.B da ISO 32000-2 (revisao 6): o hash iterado da senha. */
function hash2B(password: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = createHash('sha256')
    .update(Buffer.concat([password, salt, udata]))
    .digest();
  for (let i = 0; ; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([password, k, udata])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    c.setAutoPadding(false);
    const e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3])
      .update(e)
      .digest();
    if (i >= 63 && e[e.length - 1] <= i - 31) break;
    if (i > 2000) break;
  }
  return k.subarray(0, 32);
}

/** A chave do arquivo com a senha de usuario vazia; null se a senha nao e vazia ou o metodo e outro. */
function userKey(enc: string, id0: Buffer): { cipher: Cipher | null; info: PdfEncryption } {
  const v = dictNumber(enc, 'V') ?? 0;
  const r = dictNumber(enc, 'R') ?? 0;
  const o = dictString(enc, 'O') ?? Buffer.alloc(0);
  const u = dictString(enc, 'U') ?? Buffer.alloc(0);
  const p = dictNumber(enc, 'P') ?? 0;
  const cfm = /\/CFM\s*\/(\w+)/.exec(enc)?.[1] ?? null;
  const method: PdfEncryption['method'] =
    r >= 5 ? 'AES-256' : cfm === 'AESV2' ? 'AES-128' : v >= 1 && v <= 4 ? 'RC4' : 'desconhecido';
  const info: PdfEncryption = { version: v, revision: r, method, decrypted: false };
  if (!/\/Filter\s*\/Standard\b/.test(enc)) return { cipher: null, info };

  if (r === 6 || r === 5) {
    const ue = dictString(enc, 'UE');
    if (u.length < 48 || !ue || ue.length < 32) return { cipher: null, info };
    const empty = Buffer.alloc(0);
    const check =
      r === 6
        ? hash2B(empty, u.subarray(32, 40), empty)
        : createHash('sha256').update(u.subarray(32, 40)).digest();
    if (!check.equals(u.subarray(0, 32))) return { cipher: null, info };
    const inter =
      r === 6
        ? hash2B(empty, u.subarray(40, 48), empty)
        : createHash('sha256').update(u.subarray(40, 48)).digest();
    const d = createDecipheriv('aes-256-cbc', inter, Buffer.alloc(16));
    d.setAutoPadding(false);
    const key = Buffer.concat([d.update(ue.subarray(0, 32)), d.final()]);
    info.decrypted = true;
    return { cipher: { method, decrypt: (data) => aesDecrypt(key, data) }, info };
  }

  if (r < 2 || r > 4) return { cipher: null, info };
  // /Length do dicionario em bits; o do filtro de cifra (/CF) vem em bytes.
  const lengths = [...enc.matchAll(/\/Length\s+(\d+)/g)].map((x) => Number(x[1]));
  const bits = Math.max(40, ...lengths.map((v) => (v <= 32 ? v * 8 : v)));
  const length = r === 2 ? 5 : Math.min(16, Math.max(5, bits / 8));
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p | 0);
  const meta =
    r === 4 && /\/EncryptMetadata\s+false/.test(enc) ? Buffer.from([0xff, 0xff, 0xff, 0xff]) : null;
  let key = md5(PAD, o.subarray(0, 32), pBytes, id0, ...(meta ? [meta] : []));
  if (r >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, length));
  key = key.subarray(0, length);
  // Confere a senha vazia contra o /U.
  let ok: boolean;
  if (r === 2) ok = rc4(key, PAD).equals(u.subarray(0, 32));
  else {
    let x = rc4(key, md5(PAD, id0));
    for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
    ok = x.equals(u.subarray(0, 16));
  }
  if (!ok) return { cipher: null, info };
  info.decrypted = true;
  const aes = method === 'AES-128';
  const objectKey = (num: number, gen: number) => {
    const n = Buffer.from([
      num & 0xff,
      (num >> 8) & 0xff,
      (num >> 16) & 0xff,
      gen & 0xff,
      (gen >> 8) & 0xff,
    ]);
    return md5(key, n, ...(aes ? [Buffer.from('sAlT')] : [])).subarray(0, Math.min(16, length + 5));
  };
  return {
    cipher: {
      method,
      decrypt: (data, num, gen) =>
        aes ? aesDecrypt(objectKey(num, gen), data) : rc4(objectKey(num, gen), data),
    },
    info,
  };
}

/** Troca as strings do dicionario pelas decifradas (literal com escapes, para as regras lerem). */
function decryptStrings(dict: string, decrypt: (b: Buffer) => Buffer): string {
  let out = '';
  for (let i = 0; i < dict.length; i++) {
    const c = dict[i];
    if (c === '(') {
      const { bytes, end } = literalBytes(dict, i);
      out += `(${decrypt(bytes)
        .toString('latin1')
        .replace(/[\\()]/g, (x) => `\\${x}`)})`;
      i = end;
    } else if (c === '<' && dict[i + 1] !== '<') {
      const end = dict.indexOf('>', i);
      if (end < 0) {
        out += dict.slice(i);
        break;
      }
      out += `<${decrypt(hexBytes(dict.slice(i + 1, end))).toString('hex')}>`;
      i = end;
    } else if (c === '<' && dict[i + 1] === '<') {
      out += '<<';
      i++;
    } else out += c;
  }
  return out;
}

/** Nomes com #hh decodificados (/J#61vaScript -> /JavaScript). */
export function decodeNames(text: string): string {
  return text.replace(/\/[^\s/<>[\]()]+/g, (name) =>
    name.includes('#')
      ? name.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
      : name,
  );
}

export function readPdf(buf: Buffer): PdfRead {
  const raw = buf.toString('latin1');
  const objects: PdfObject[] = [];
  let decodedTotal = 0;
  const decode = (dict: string, bytes: Buffer): Buffer | null => {
    if (decodedTotal >= MAX_DECODED_TOTAL) return null;
    const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? '';
    const names = filters.match(/\/\w+/g) ?? [];
    let data = bytes;
    for (const f of names) {
      if (f === '/FlateDecode' || f === '/Fl') {
        try {
          data = inflateSync(data, { maxOutputLength: MAX_STREAM });
        } catch {
          return null;
        }
      } else if (f === '/ASCIIHexDecode' || f === '/AHx') {
        data = hexBytes(data.toString('latin1').replace(/>.*$/s, ''));
      } else return null;
    }
    decodedTotal += data.length;
    return data;
  };

  // A criptografia: /Encrypt no trailer (direto ou referencia) e o primeiro /ID.
  let encryption: PdfEncryption | null = null;
  let cipher: Cipher | null = null;
  let encryptNum = -1;
  const encRef = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(raw);
  const encDirect = encRef ? null : /\/Encrypt\s*<</.exec(raw);
  if (encRef || encDirect) {
    let encDict = '';
    if (encRef) {
      encryptNum = Number(encRef[1]);
      const at = new RegExp(`(?:^|[\\r\\n\\s])${encRef[1]}\\s+${encRef[2]}\\s+obj\\b`).exec(raw);
      if (at) encDict = raw.slice(at.index, raw.indexOf('endobj', at.index) + 1 || undefined);
    } else if (encDirect) {
      encDict = raw.slice(encDirect.index, encDirect.index + 4000);
    }
    const id0 = /\/ID\s*\[\s*<([0-9a-fA-F\s]*)>/.exec(raw);
    const derived = userKey(encDict, id0 ? hexBytes(id0[1]) : Buffer.alloc(0));
    encryption = derived.info;
    cipher = derived.cipher;
  }

  const re = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && objects.length < MAX_OBJECTS) {
    const num = Number(m[1]);
    const gen = Number(m[2]);
    const start = m.index + m[0].length;
    const endobj = raw.indexOf('endobj', start);
    const streamAt = raw.indexOf('stream', start);
    const hasStream = streamAt >= 0 && (endobj < 0 || streamAt < endobj);
    let dict = raw.slice(start, hasStream ? streamAt : endobj < 0 ? raw.length : endobj);
    let data: Buffer | null = null;
    let next = endobj < 0 ? raw.length : endobj;
    if (hasStream) {
      let begin = streamAt + 6;
      if (raw[begin] === '\r') begin++;
      if (raw[begin] === '\n') begin++;
      const length = dictNumber(dict, 'Length');
      let end = raw.indexOf('endstream', begin);
      if (
        length !== null &&
        length >= 0 &&
        begin + length <= buf.length &&
        !/\/Length\s+\d+\s+\d+\s+R/.test(dict)
      ) {
        end = begin + length;
      }
      if (end < 0) end = buf.length;
      let bytes = buf.subarray(begin, Math.min(end, begin + MAX_STREAM));
      if (cipher && num !== encryptNum) bytes = cipher.decrypt(Buffer.from(bytes), num, gen);
      data = decode(decodeNames(dict), bytes);
      const after = raw.indexOf('endobj', end);
      next = after < 0 ? raw.length : after;
    }
    if (cipher && num !== encryptNum) {
      dict = decryptStrings(dict, (b) => cipher!.decrypt(b, num, gen));
    }
    objects.push({ num, gen, dict: decodeNames(dict), data, compressed: false });
    re.lastIndex = Math.max(re.lastIndex, next);
  }

  // Objetos dentro dos ObjStm (as strings deles nao sao cifradas a parte: o stream ja foi).
  for (const o of [...objects]) {
    if (!o.data || !/\/Type\s*\/ObjStm\b/.test(o.dict) || objects.length >= MAX_OBJECTS) continue;
    const n = Math.min(dictNumber(o.dict, 'N') ?? 0, MAX_OBJSTM);
    const first = dictNumber(o.dict, 'First') ?? 0;
    const text = o.data.toString('latin1');
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n && 2 * i + 1 < header.length; i++) {
      const at = first + header[2 * i + 1];
      const until = 2 * i + 3 < header.length ? first + header[2 * i + 3] : text.length;
      if (!Number.isFinite(at) || at < first || at > text.length) break;
      objects.push({
        num: header[2 * i],
        gen: 0,
        dict: decodeNames(text.slice(at, Math.max(at, until))),
        data: null,
        compressed: true,
      });
    }
  }

  const byNum = new Map<number, PdfObject>();
  for (const o of objects) if (!byNum.has(o.num) || o.data) byNum.set(o.num, o);

  // JavaScript: /JS com string (literal ou hex) ou referencia a um stream. Cifrado sem a senha
  // vazia, o conteudo e so bytes cifrados: nao ha o que extrair.
  const opaque = Boolean(encryption && !encryption.decrypted);
  const scripts: string[] = [];
  for (const o of opaque ? [] : objects) {
    if (scripts.length >= MAX_SCRIPTS) break;
    const js = /\/JS\s*(\(|<(?!<)|(\d+)\s+(\d+)\s+R)/.exec(o.dict);
    if (!js) continue;
    let code: string | null;
    if (js[2]) {
      const target = byNum.get(Number(js[2]));
      code = target?.data ? pdfTextString(target.data) : null;
    } else {
      const bytes = dictString(o.dict, 'JS');
      code = bytes ? pdfTextString(bytes) : null;
    }
    if (code?.trim()) scripts.push(code.slice(0, MAX_STRING));
  }

  // Arquivos embutidos: o stream /EmbeddedFile, com o nome da especificacao que aponta para ele.
  const names = new Map<number, string>();
  for (const o of objects) {
    const ef = /\/EF\s*<<[^>]*?\/(?:UF|F)\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    if (!ef) continue;
    const name = dictString(o.dict, 'UF') ?? dictString(o.dict, 'F');
    if (name) names.set(Number(ef[1]), pdfTextString(name));
  }
  const embedded: PdfRead['embedded'] = [];
  for (const o of opaque ? [] : objects) {
    if (embedded.length >= MAX_EMBEDDED) break;
    if (!o.data || (!/\/Type\s*\/EmbeddedFile\b/.test(o.dict) && !names.has(o.num))) continue;
    embedded.push({ name: names.get(o.num) ?? `anexo-${o.num}.bin`, data: o.data, object: o.num });
  }

  // O texto das regras: o arquivo (com as strings decifradas, se for o caso) e os streams.
  const parts = cipher ? objects.filter((o) => !o.compressed).map((o) => o.dict) : [raw];
  for (const o of objects) {
    if (o.compressed) parts.push(o.dict);
    else if (o.data && !/\/Type\s*\/EmbeddedFile\b/.test(o.dict))
      parts.push(o.data.toString('latin1'));
  }
  return { objects, encryption, text: decodeNames(parts.join('\n')), scripts, embedded };
}
