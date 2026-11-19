import { Cfb } from './doc-analysis';
import { type EmailInfo, type ParsedEmail, parseEmail } from './eml';

/**
 * E-mail do Outlook (.msg; plans/analise-estatica-ampliada, item 10). Relato de phishing de
 * empresa costuma chegar assim (o "Encaminhar como anexo" do Outlook), nao como .eml. O .msg e um
 * OLE: cada propriedade MAPI e um stream `__substg1.0_PPPPTTTT` (id e tipo), e cada anexo um
 * armazenamento `__attach_version1.0_#n`, com os bytes em 0x3701 ou, quando o anexo e outro e-mail,
 * um armazenamento com as propriedades dele.
 *
 * Os cabecalhos de transporte (0x007D) sao o e-mail original: montados com o corpo num RFC 822,
 * passam pelo mesmo leitor do .eml (remetente, SPF/DKIM/DMARC, saltos, links). Sem eles (mensagem
 * salva de rascunho), os campos vem das propriedades.
 */

const MAX_ATTACHMENTS = 50;
const MAX_DEPTH = 3;

/** Reconhecido pelo stream de propriedades e pelo nome dos streams MAPI. */
export function isMsg(buf: Buffer): boolean {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0) return false;
  try {
    return new Cfb(buf).paths().some((p) => p.path === '__properties_version1.0');
  } catch {
    return false;
  }
}

interface Props {
  string(id: number): string | null;
  binary(id: number): Buffer | null;
}

function propsOf(cfb: Cfb, prefix: string): Props {
  const streams = new Map<string, number>();
  for (const p of cfb.paths()) {
    if (!p.path.startsWith(prefix)) continue;
    const rest = p.path.slice(prefix.length);
    if (/^__substg1\.0_[0-9A-F]{8}$/i.test(rest))
      streams.set(rest.slice(12).toUpperCase(), p.index);
  }
  const read = (key: string) => {
    const at = streams.get(key);
    return at === undefined ? null : cfb.read(cfb.entries[at]);
  };
  const hex = (id: number) => id.toString(16).toUpperCase().padStart(4, '0');
  return {
    string(id) {
      const unicode = read(`${hex(id)}001F`);
      if (unicode) return unicode.toString('utf16le').replace(/\0+$/, '');
      const ansi = read(`${hex(id)}001E`);
      return ansi ? ansi.toString('latin1').replace(/\0+$/, '') : null;
    },
    binary: (id) => read(`${hex(id)}0102`),
  };
}

interface MsgFile {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** Os anexos de uma mensagem (ou de uma mensagem anexada, a partir de `prefix`). */
function attachmentsOf(cfb: Cfb, prefix: string, depth: number, out: MsgFile[], nested: string[]) {
  const storages = cfb.paths().filter((p) => {
    const rest = p.path.slice(prefix.length);
    return p.path.startsWith(prefix) && /^__attach_version1\.0_#[0-9A-F]{8}$/i.test(rest);
  });
  for (const s of storages) {
    if (out.length >= MAX_ATTACHMENTS) break;
    const base = `${s.path}/`;
    const props = propsOf(cfb, base);
    const name =
      props.string(0x3707) ?? props.string(0x3704) ?? props.string(0x3001) ?? 'anexo.bin';
    const data = props.binary(0x3701);
    if (data) {
      out.push({
        filename: name,
        mimeType: props.string(0x370e) ?? 'application/octet-stream',
        content: data,
      });
      continue;
    }
    // Anexo que e outro e-mail: os anexos dele tambem viram amostras (ate 3 niveis).
    const inner = `${base}__substg1.0_3701000D/`;
    if (depth < MAX_DEPTH && cfb.paths().some((p) => p.path.startsWith(inner))) {
      nested.push(propsOf(cfb, inner).string(0x0037) ?? name);
      attachmentsOf(cfb, inner, depth + 1, out, nested);
    }
  }
}

/** Le o .msg no mesmo formato do .eml (EmailInfo e os anexos). */
export async function parseMsg(buffer: Buffer, maxAttachmentBytes: number): Promise<ParsedEmail> {
  const cfb = new Cfb(buffer);
  const props = propsOf(cfb, '');
  const headers = props.string(0x007d);
  const body = props.string(0x1000) ?? '';
  const html = props.binary(0x1013)?.toString('utf8') ?? props.string(0x1013) ?? null;
  const subject = props.string(0x0037);
  const fromAddr = props.string(0x5d01) ?? props.string(0x0c1f) ?? props.string(0x0065);
  const fromName = props.string(0x0c1a) ?? props.string(0x0042);
  // O RFC 822 so com cabecalhos e texto: os anexos vem do OLE, nao do MIME.
  const head =
    headers?.trim() ??
    [
      fromAddr && `From: ${fromName ? `"${fromName}" ` : ''}<${fromAddr}>`,
      props.string(0x0e04) && `To: ${props.string(0x0e04)}`,
      props.string(0x0e03) && `Cc: ${props.string(0x0e03)}`,
      subject && `Subject: ${subject}`,
    ]
      .filter(Boolean)
      .join('\r\n');
  // Sem os Content-* do original (com as linhas dobradas deles): o corpo daqui e outro.
  const kept: string[] = [];
  let dropping = false;
  for (const line of head.split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      if (!dropping) kept.push(line);
      continue;
    }
    dropping = /^content-(?:type|transfer-encoding|disposition):/i.test(line);
    if (!dropping) kept.push(line);
  }
  const cleanHead = kept.join('\r\n');
  const mime = html
    ? `${cleanHead}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="dl-msg"\r\n\r\n--dl-msg\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--dl-msg\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--dl-msg--\r\n`
    : `${cleanHead}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
  const parsed = await parseEmail(Buffer.from(mime, 'utf8'), maxAttachmentBytes);
  const info: EmailInfo = { ...parsed.info, subject: parsed.info.subject ?? subject };

  const files: MsgFile[] = [];
  const nested: string[] = [];
  attachmentsOf(cfb, '', 0, files, nested);
  info.attachments = [];
  const accepted: MsgFile[] = [];
  for (const f of files) {
    const item: EmailInfo['attachments'][number] = {
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.content.length,
    };
    if (f.content.length > maxAttachmentBytes) item.skipped = 'maior que o limite de upload';
    else accepted.push(f);
    info.attachments.push(item);
  }
  return { info: { ...info, ...(nested.length ? { forwarded: nested } : {}) }, files: accepted };
}
