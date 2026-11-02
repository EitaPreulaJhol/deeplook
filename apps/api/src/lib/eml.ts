import PostalMime, { type Address, type Email } from 'postal-mime';

/**
 * E-mail suspeito (.eml, item 54): le cabecalhos, autenticacao, caminho dos
 * servidores, links e o corpo como TEXTO. O HTML nunca e renderizado (vira
 * texto aqui) e os anexos viram amostras filhas (routes/entries.ts).
 */

/** Limites para e-mail de atacante (cabecalhos enormes, mil anexos, aninhamento). */
const MAX_ATTACHMENTS = 20;
const MAX_LINKS = 100;
const MAX_BODY_CHARS = 20_000;
const MAX_RECEIVED = 30;
const MAX_RECIPIENTS = 50;
/**
 * Teto de delimitadores de parte MIME antes de entregar ao postal-mime, cujo
 * tratamento de partes cresce superlinearmente: uma mensagem com dezenas de
 * milhares de partes travaria a thread por dezenas de segundos. O corte em 1000
 * e folgado (o limite util de anexos e MAX_ATTACHMENTS = 20) e barra o abuso.
 */
const MAX_MIME_PARTS = 1000;

/** O Postgres recusa \u0000 em JSON (viraria 500): tira o NUL de nomes e textos. */
function stripNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k.replaceAll('\u0000', ''), stripNul(v)]),
    ) as T;
  }
  return value;
}

/**
 * Conta delimitadores de parte MIME (linhas iniciadas por "--") como teto superior
 * do numero de partes, numa unica passada linear sobre os bytes (sem alocar a string
 * inteira), antes da analise cara. Para na contagem assim que passa o teto.
 */
function countMimeParts(buffer: Buffer, cap: number): number {
  let count = buffer.length >= 2 && buffer[0] === 0x2d && buffer[1] === 0x2d ? 1 : 0;
  for (let i = 0; i + 2 < buffer.length && count <= cap; i++) {
    // "\n--": inicio de uma fronteira MIME.
    if (buffer[i] === 0x0a && buffer[i + 1] === 0x2d && buffer[i + 2] === 0x2d) count++;
  }
  return count;
}

export interface EmailParty {
  name: string | null;
  address: string | null;
}

export interface EmailInfo {
  version: 1;
  subject: string | null;
  from: EmailParty | null;
  sender: EmailParty | null;
  replyTo: EmailParty[];
  to: EmailParty[];
  cc: EmailParty[];
  date: string | null;
  messageId: string | null;
  returnPath: string | null;
  /** SPF/DKIM/DMARC do Authentication-Results do servidor que recebeu (null = ausente). */
  auth: { spf: string | null; dkim: string | null; dmarc: string | null };
  /** Saltos (Received), do primeiro servidor ao ultimo. */
  received: { from: string | null; by: string | null; date: string | null }[];
  links: string[];
  body: string;
  bodyTruncated: boolean;
  /** Anexos encontrados (os que viraram amostra ganham `entryId` depois). */
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    entryId?: string;
    skipped?: string;
  }[];
}

export interface ParsedEmail {
  info: EmailInfo;
  files: { filename: string; mimeType: string; content: Buffer }[];
}

/** .eml pelo nome ou pelo tipo declarado. */
export function isEmailFile(filename: string, mimetype: string | null | undefined): boolean {
  return /\.eml$/i.test(filename) || mimetype === 'message/rfc822';
}

function party(address: Address | undefined): EmailParty | null {
  if (!address) return null;
  if ('group' in address && address.group) {
    return { name: address.name || null, address: address.group[0]?.address ?? null };
  }
  return { name: address.name || null, address: address.address ?? null };
}

function parties(list: Address[] | undefined): EmailParty[] {
  const out: EmailParty[] = [];
  for (const a of list ?? []) {
    if ('group' in a && a.group)
      out.push(...a.group.map((m) => ({ name: m.name || null, address: m.address })));
    else out.push({ name: a.name || null, address: a.address ?? null });
  }
  return out.slice(0, MAX_RECIPIENTS);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
/** Letras acentuadas comuns em phishing em portugues (&aacute;, &Ccedil;...). */
const ACCENTS: Record<string, string> = {
  acute: '́',
  grave: '̀',
  tilde: '̃',
  circ: '̂',
  uml: '̈',
  cedil: '̧',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    const accent = /^([a-z])(acute|grave|tilde|circ|uml|cedil)$/i.exec(code);
    if (accent) return (accent[1] + ACCENTS[accent[2].toLowerCase()]).normalize('NFC');
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Tira os blocos script/style/head (abertura ate o fechamento do mesmo nome). Em
 * tempo linear: a regex com `[\s\S]*?<\/\1>` varria ate o fim a cada abertura sem
 * fechamento, e milhares delas num .eml travavam a API.
 */
function dropSkipBlocks(html: string): string {
  const open = /<(script|style|head)\b/gi;
  // Tipo sem fechamento daqui em diante: nao adianta procurar de novo.
  const unclosed = new Set<string>();
  let out = '';
  let copied = 0;
  let gt = -1;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const name = m[1].toLowerCase();
    if (unclosed.has(name)) continue;
    // Fim da abertura: o primeiro '>' depois dela (reaproveitado se ainda vale).
    if (gt < m.index) gt = html.indexOf('>', m.index);
    if (gt < 0) break;
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    close.lastIndex = gt + 1;
    if (!close.exec(html)) {
      unclosed.add(name);
      continue;
    }
    out += `${html.slice(copied, m.index)} `;
    copied = close.lastIndex;
    open.lastIndex = copied;
  }
  return out + html.slice(copied);
}

/** Troca cada tag `<...>` por um espaco; um '<' sem '>' depois fica como texto. */
function stripTags(html: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) break;
    const gt = html.indexOf('>', lt + 1);
    if (gt < 0) break;
    out += `${html.slice(pos, lt)} `;
    pos = gt + 1;
  }
  return out + html.slice(pos);
}

/** HTML -> texto (sem executar nada): tira script/style, quebra blocos, remove tags. */
export function htmlToText(html: string): string {
  return decodeEntities(
    stripTags(
      dropSkipBlocks(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n'),
    ),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Links http(s) do texto e dos href do HTML, sem repetir. */
export function extractLinks(text: string, html: string | undefined): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    // Corte linear da pontuacao final: o /[...]+$/ reavalia cada inicio de uma
    // sequencia longa (quadratico) e travava a thread (item: DoS no .eml).
    let url = decodeEntities(raw).trim();
    let end = url.length;
    while (end > 0 && '.,;:!?)]'.includes(url[end - 1])) end--;
    url = url.slice(0, end);
    if (/^https?:\/\/[^\s/]+/i.test(url) && url.length <= 2000) found.add(url);
  };
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    if (found.size >= MAX_LINKS) break;
    add(m[0]);
  }
  if (html) {
    for (const m of html.matchAll(/\bhref\s*=\s*["']?([^"'\s>]+)/gi)) {
      if (found.size >= MAX_LINKS) break;
      add(m[1]);
    }
  }
  return [...found];
}

/** Resultado de um mecanismo no Authentication-Results (ex.: "spf=pass"). */
function authResult(value: string, mechanism: string): string | null {
  const m = new RegExp(`(?:^|[;\\s])${mechanism}\\s*=\\s*([a-z]+)`, 'i').exec(value);
  return m ? m[1].toLowerCase() : null;
}

function parseReceived(value: string) {
  const clean = value.replace(/\s+/g, ' ').trim();
  const from = /\bfrom\s+(.+?)(?=\s+(?:by|with|id|for)\b|;|$)/i.exec(clean)?.[1] ?? null;
  const by = /\bby\s+(.+?)(?=\s+(?:with|id|for|via)\b|;|$)/i.exec(clean)?.[1] ?? null;
  const rawDate = clean.includes(';') ? clean.slice(clean.lastIndexOf(';') + 1).trim() : null;
  const date =
    rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
  return { from: from?.slice(0, 300) ?? null, by: by?.slice(0, 300) ?? null, date };
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(content instanceof ArrayBuffer ? new Uint8Array(content) : content);
}

/** Le o .eml; lanca se o conteudo nao for um e-mail. */
export async function parseEmail(buffer: Buffer, maxAttachmentBytes: number): Promise<ParsedEmail> {
  // Barra a mensagem com milhares de partes ANTES de montar a arvore: o parser
  // cresce superlinearmente e travaria a thread unica (item: DoS no .eml).
  if (countMimeParts(buffer, MAX_MIME_PARTS) > MAX_MIME_PARTS) {
    throw new Error(`e-mail com mais de ${MAX_MIME_PARTS} partes MIME`);
  }
  const email: Email = await PostalMime.parse(buffer, {
    attachmentEncoding: 'arraybuffer',
    // E-mail encaminhado como anexo continua anexo (vira outra amostra .eml).
    forceRfc822Attachments: true,
    maxNestingDepth: 50,
    maxHeadersSize: 512 * 1024,
  });
  const typical = ['from', 'to', 'subject', 'date', 'received', 'message-id'];
  if (!email.headers.some((h) => typical.includes(h.key))) {
    throw new Error('o arquivo não parece um e-mail');
  }

  const header = (key: string) => email.headers.filter((h) => h.key === key).map((h) => h.value);
  // O primeiro Authentication-Results e o do servidor que entregou a mensagem.
  const auth = header('authentication-results')[0] ?? '';
  const text = email.text?.trim() || (email.html ? htmlToText(email.html) : '');

  const files: ParsedEmail['files'] = [];
  const attachments: EmailInfo['attachments'] = [];
  for (const [i, a] of email.attachments.entries()) {
    const content = toBuffer(a.content);
    const filename = (
      a.filename || `anexo-${i + 1}${a.mimeType === 'message/rfc822' ? '.eml' : ''}`
    ).slice(0, 200);
    const item: EmailInfo['attachments'][number] = {
      filename,
      mimeType: a.mimeType,
      size: content.length,
    };
    attachments.push(item);
    if (attachments.length > MAX_ATTACHMENTS) item.skipped = `limite de ${MAX_ATTACHMENTS} anexos`;
    else if (content.length === 0) item.skipped = 'anexo vazio';
    else if (content.length > maxAttachmentBytes) item.skipped = 'maior que o limite de upload';
    else files.push({ filename, mimeType: a.mimeType || 'application/octet-stream', content });
  }

  const body = text.slice(0, MAX_BODY_CHARS);
  const info: EmailInfo = {
    version: 1,
    subject: email.subject?.slice(0, 500) ?? null,
    from: party(email.from),
    sender: party(email.sender),
    replyTo: parties(email.replyTo),
    to: parties(email.to),
    cc: parties(email.cc),
    date:
      email.date && !Number.isNaN(Date.parse(email.date))
        ? new Date(email.date).toISOString()
        : null,
    messageId: email.messageId?.slice(0, 500) ?? null,
    returnPath: email.returnPath?.slice(0, 500) ?? null,
    auth: {
      spf: authResult(auth, 'spf'),
      dkim: authResult(auth, 'dkim'),
      dmarc: authResult(auth, 'dmarc'),
    },
    received: header('received').slice(0, MAX_RECEIVED).map(parseReceived).reverse(),
    links: extractLinks(text, email.html),
    body,
    bodyTruncated: text.length > MAX_BODY_CHARS,
    attachments: attachments.slice(0, MAX_ATTACHMENTS + 30),
  };
  // O corpo e os cabecalhos vem do arquivo: um NUL no texto faria o Postgres
  // recusar o JSON (500) e deixar amostra pela metade (item: upload .eml com NUL).
  return { info: stripNul(info), files };
}
