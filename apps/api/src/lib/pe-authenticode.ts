import { createHash, verify, X509Certificate } from 'node:crypto';

import type { PeImage } from './pe-analysis';

/**
 * Assinatura Authenticode do PE (item 7.1): quem assinou, a cadeia que veio no arquivo, o
 * carimbo de tempo, e duas conferencias que valem sem internet:
 *  - o hash do arquivo bate com o que foi assinado (nao mudou depois de assinado);
 *  - a assinatura confere com a chave do certificado.
 * A cadeia NAO e conferida contra as raizes do Windows (a API nao as tem): "valida" aqui quer
 * dizer integra, nao confiavel. O DER e lido com teto de tamanho e sem recursao aberta.
 */

/** Tabela de certificados maior que isto nao e lida. */
const MAX_TABLE = 1024 * 1024;
const MAX_CERTS = 32;

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  spcIndirectData: '1.3.6.1.4.1.311.2.1.4',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  counterSignature: '1.2.840.113549.1.9.6',
  spcOpusInfo: '1.3.6.1.4.1.311.2.1.12',
  rfc3161: '1.3.6.1.4.1.311.3.3.1',
  nested: '1.3.6.1.4.1.311.2.4.1',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
};
const DIGESTS: Record<string, string> = {
  '1.2.840.113549.2.5': 'md5',
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

export interface CertSummary {
  subject: string;
  issuer: string;
  serial: string;
  validFrom: string;
  validTo: string;
  /** Impressao digital SHA-1 (a que o Windows mostra) e SHA-256, em hexa minusculo. */
  sha1: string;
  sha256: string;
}

export interface SignatureInfo {
  digestAlgorithm: string | null;
  /** O hash do arquivo e o assinado sao iguais (null: algoritmo desconhecido). */
  digestMatches: boolean | null;
  /** Atributos e assinatura conferem com a chave do certificado de quem assinou. */
  signatureValid: boolean;
  /** Nome e endereco do programa declarados por quem assinou. */
  programName: string | null;
  programUrl: string | null;
  signer: CertSummary | null;
  /** De quem assinou ate onde a cadeia que veio no arquivo chega. */
  chain: CertSummary[];
  selfSigned: boolean;
  /** Carimbo de tempo (contra-assinatura ou RFC 3161); nao conferido. */
  timestamp: string | null;
  /** Assinaturas aninhadas (ex.: SHA-1 e SHA-256 no mesmo arquivo). */
  nested: number;
  /** Assinatura presente mas ilegivel. */
  error?: string;
}

interface Node {
  tag: number;
  start: number;
  content: number;
  end: number;
}

function read(buf: Buffer, off: number, limit: number): Node | null {
  if (off + 2 > limit) return null;
  const tag = buf[off];
  if ((tag & 0x1f) === 0x1f) return null;
  let len = buf[off + 1];
  let p = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    // Sem comprimento indefinido (BER) nem maior que 4 bytes.
    if (n === 0 || n > 4 || p + n > limit) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
  }
  if (p + len > limit) return null;
  return { tag, start: off, content: p, end: p + len };
}

function kids(buf: Buffer, node: Node | null, max = 256): Node[] {
  const out: Node[] = [];
  if (!node) return out;
  let p = node.content;
  while (p < node.end && out.length < max) {
    const child = read(buf, p, node.end);
    if (!child) break;
    out.push(child);
    p = child.end;
  }
  return out;
}

function oid(buf: Buffer, node: Node | undefined): string | null {
  if (!node || node.tag !== 0x06 || node.end - node.content > 64) return null;
  const parts: number[] = [];
  let v = 0;
  for (let i = node.content; i < node.end; i++) {
    v = v * 128 + (buf[i] & 0x7f);
    if (!(buf[i] & 0x80)) {
      if (!parts.length) parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80);
      else parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

function time(buf: Buffer, node: Node | undefined): string | null {
  if (!node || (node.tag !== 0x17 && node.tag !== 0x18)) return null;
  const s = buf.toString('latin1', node.content, node.end);
  const m =
    node.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(s);
  if (!m) return null;
  const year = node.tag === 0x17 ? (+m[1] < 50 ? 2000 : 1900) + +m[1] : +m[1];
  const d = new Date(Date.UTC(year, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const raw = (buf: Buffer, n: Node) => buf.subarray(n.start, n.end);
const body = (buf: Buffer, n: Node) => buf.subarray(n.content, n.end);

/** Atributos (SET de SEQUENCE { OID, SET valores }) indexados pelo OID. */
function attributes(buf: Buffer, set: Node | undefined): Map<string, Node[]> {
  const out = new Map<string, Node[]>();
  for (const attr of kids(buf, set ?? null, 64)) {
    const [type, values] = kids(buf, attr, 2);
    const id = oid(buf, type);
    if (id) out.set(id, kids(buf, values ?? null, 16));
  }
  return out;
}

/** SpcString do SpcSpOpusInfo: Unicode ([0], BMPString big-endian) ou ASCII ([1]). */
function spcString(buf: Buffer, node: Node | undefined): string | null {
  if (!node) return null;
  if (node.tag === 0x81) return buf.toString('latin1', node.content, node.end).slice(0, 256);
  if (node.tag !== 0x80 || (node.end - node.content) % 2) return null;
  const b = Buffer.from(body(buf, node));
  b.swap16();
  return b.toString('utf16le').slice(0, 256);
}

function summarize(cert: X509Certificate): CertSummary {
  const cn = (dn: string) => /(?:^|\n)CN=([^\n]+)/.exec(dn)?.[1] ?? dn.replace(/\n/g, ', ');
  const hex = (fp: string) => fp.replace(/:/g, '').toLowerCase();
  return {
    subject: cn(cert.subject),
    issuer: cn(cert.issuer),
    serial: cert.serialNumber.toUpperCase(),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
    sha1: hex(cert.fingerprint),
    sha256: hex(cert.fingerprint256),
  };
}

/** Emissor (Name em DER) e numero de serie do certificado, para achar quem assinou. */
function issuerAndSerial(der: Buffer): { issuer: Buffer; serial: Buffer } | null {
  const cert = read(der, 0, der.length);
  const tbs = kids(der, cert, 1)[0];
  const fields = kids(der, tbs ?? null, 8);
  const start = fields[0]?.tag === 0xa0 ? 1 : 0;
  const serial = fields[start];
  const issuer = fields[start + 2];
  if (!serial || serial.tag !== 0x02 || !issuer) return null;
  return { issuer: raw(der, issuer), serial: body(der, serial) };
}

/** Hash Authenticode: o arquivo sem o checksum, sem a entrada da tabela e sem a tabela. */
function imageHash(pe: PeImage, algorithm: string, certAt: number, certSize: number): Buffer {
  const { buf } = pe;
  const entry = pe.dirEntryOffset(4);
  const h = createHash(algorithm);
  h.update(buf.subarray(0, pe.checksumOffset));
  h.update(buf.subarray(pe.checksumOffset + 4, entry));
  h.update(buf.subarray(entry + 8, certAt));
  h.update(buf.subarray(certAt + certSize));
  return h.digest();
}

/**
 * Authentihash (plans/analise-estatica-ampliada, item 2): o SHA-256 do Authenticode, que nao muda
 * com a assinatura (nem com quem assinou). Liga a mesma compilacao assinada por certificados
 * diferentes, e e o hash que o LOLDrivers e o VirusTotal publicam.
 */
export function authentihash(pe: PeImage): string {
  const cert = pe.dir(4);
  const inFile = cert && cert.rva < pe.buf.length && cert.rva + cert.size <= pe.buf.length;
  return inFile
    ? imageHash(pe, 'sha256', cert.rva, cert.size).toString('hex')
    : imageHash(pe, 'sha256', pe.buf.length, 0).toString('hex');
}

/** Carimbo de tempo: contra-assinatura antiga (signingTime) ou RFC 3161 (genTime do TSTInfo). */
function timestampOf(buf: Buffer, unsigned: Map<string, Node[]>): string | null {
  const counter = unsigned.get(OID.counterSignature)?.[0];
  if (counter) {
    const fields = kids(buf, counter, 8);
    const attrs = attributes(
      buf,
      fields.find((f) => f.tag === 0xa0),
    );
    const t = time(buf, attrs.get(OID.signingTime)?.[0]);
    if (t) return t;
  }
  const token = unsigned.get(OID.rfc3161)?.[0];
  if (token) {
    const [, wrapped] = kids(buf, token, 2);
    const signed = kids(buf, wrapped ?? null, 1)[0];
    const encap = kids(buf, signed ?? null, 8).find(
      (n) => n.tag === 0x30 && oid(buf, kids(buf, n, 1)[0]) === OID.tstInfo,
    );
    const [, explicit] = kids(buf, encap ?? null, 2);
    const octets = kids(buf, explicit ?? null, 1)[0];
    const tst = octets?.tag === 0x04 ? kids(buf, octets, 1)[0] : undefined;
    // TSTInfo: version, policy, messageImprint, serialNumber, genTime...
    const genTime = kids(buf, tst ?? null, 8).find((n) => n.tag === 0x18);
    return time(buf, genTime);
  }
  return null;
}

export function analyzeAuthenticode(pe: PeImage): SignatureInfo | null {
  const dir = pe.dir(4);
  if (!dir) return null;
  const { buf } = pe;
  // A tabela da assinatura e o unico diretorio com posicao no arquivo, nao RVA.
  const certAt = dir.rva;
  const certSize = dir.size;
  if (certAt + 8 > buf.length) return null;
  const broken = (error: string): SignatureInfo => ({
    digestAlgorithm: null,
    digestMatches: null,
    signatureValid: false,
    programName: null,
    programUrl: null,
    signer: null,
    chain: [],
    selfSigned: false,
    timestamp: null,
    nested: 0,
    error,
  });
  if (certSize > MAX_TABLE) return broken('Tabela de assinatura grande demais para ler.');
  if (certAt + certSize > buf.length)
    return broken('A tabela de assinatura passa do fim do arquivo.');
  const length = buf.readUInt32LE(certAt);
  const type = buf.readUInt16LE(certAt + 6);
  if (type !== 0x0002 || length < 8 || length > certSize) {
    return broken('A tabela de assinatura não traz uma assinatura PKCS#7.');
  }
  const limit = certAt + length;
  try {
    const contentInfo = read(buf, certAt + 8, limit);
    const [type, explicit] = kids(buf, contentInfo, 2);
    if (oid(buf, type) !== OID.signedData) return broken('Assinatura em formato desconhecido.');
    const signedData = kids(buf, explicit ?? null, 1)[0];
    const fields = kids(buf, signedData ?? null, 8);
    // version, digestAlgorithms, contentInfo, [0] certificados, [1] CRLs, signerInfos
    const encap = fields[2];
    const [encapType, encapExplicit] = kids(buf, encap ?? null, 2);
    if (oid(buf, encapType) !== OID.spcIndirectData)
      return broken('A assinatura não é Authenticode.');
    const spc = kids(buf, encapExplicit ?? null, 1)[0];
    const [, digestInfo] = kids(buf, spc ?? null, 2);
    const [algId, digest] = kids(buf, digestInfo ?? null, 2);
    const digestAlgorithm = DIGESTS[oid(buf, kids(buf, algId ?? null, 1)[0]) ?? ''] ?? null;
    if (!spc || !digest || digest.tag !== 0x04)
      return broken('A assinatura não traz o hash do arquivo.');
    const signed = body(buf, digest);
    const digestMatches = digestAlgorithm
      ? imageHash(pe, digestAlgorithm, certAt, certSize).equals(signed)
      : null;

    const certNodes = kids(buf, fields.find((f) => f.tag === 0xa0) ?? null, MAX_CERTS);
    const certs: { x509: X509Certificate; der: Buffer }[] = [];
    for (const node of certNodes) {
      try {
        const der = Buffer.from(raw(buf, node));
        certs.push({ x509: new X509Certificate(der), der });
      } catch {
        /* certificado ilegivel: os outros seguem */
      }
    }

    const signerInfos = fields[fields.length - 1];
    const signerInfo = signerInfos?.tag === 0x31 ? kids(buf, signerInfos, 1)[0] : undefined;
    const si = kids(buf, signerInfo ?? null, 8);
    const ias = kids(buf, si[1] ?? null, 2);
    const signerIssuer = ias[0] ? raw(buf, ias[0]) : null;
    const signerSerial = ias[1] ? body(buf, ias[1]) : null;
    const signerDigest = DIGESTS[oid(buf, kids(buf, si[2] ?? null, 1)[0]) ?? ''] ?? null;
    const authAttrs = si.find((n) => n.tag === 0xa0);
    const afterAttrs = authAttrs ? si.indexOf(authAttrs) + 1 : 3;
    const encrypted = si[afterAttrs + 1];
    const unauth = attributes(
      buf,
      si.find((n) => n.tag === 0xa1),
    );

    const signerCert =
      certs.find((c) => {
        const id = issuerAndSerial(c.der);
        return (
          id &&
          signerIssuer &&
          signerSerial &&
          id.issuer.equals(signerIssuer) &&
          id.serial.equals(signerSerial)
        );
      })?.x509 ?? null;

    let signatureValid = false;
    if (signerCert && signerDigest && encrypted?.tag === 0x04) {
      let data: Buffer;
      let attrsOk = true;
      if (authAttrs) {
        // O messageDigest assinado e o hash do conteudo do SpcIndirectDataContent (sem tag e tamanho).
        const attrs = attributes(buf, authAttrs);
        const md = attrs.get(OID.messageDigest)?.[0];
        const expected = createHash(signerDigest).update(body(buf, spc)).digest();
        attrsOk = Boolean(md && md.tag === 0x04 && body(buf, md).equals(expected));
        // Os atributos sao assinados como SET (0x31), nao com a tag [0] em que vem.
        data = Buffer.from(raw(buf, authAttrs));
        data[0] = 0x31;
      } else {
        data = Buffer.from(body(buf, spc));
      }
      try {
        signatureValid =
          attrsOk && verify(signerDigest, data, signerCert.publicKey, body(buf, encrypted));
      } catch {
        signatureValid = false;
      }
    }

    let programName: string | null = null;
    let programUrl: string | null = null;
    if (authAttrs) {
      const opus = attributes(buf, authAttrs).get(OID.spcOpusInfo)?.[0];
      for (const f of kids(buf, opus ?? null, 2)) {
        const inner = kids(buf, f, 1)[0];
        if (f.tag === 0xa0) programName = spcString(buf, inner);
        // SpcLink: so a forma url ([0], IA5String).
        if (f.tag === 0xa1 && inner?.tag === 0x80) {
          programUrl = buf.toString('latin1', inner.content, inner.end).slice(0, 256);
        }
      }
    }

    // Cadeia com os certificados que vieram no arquivo, de quem assinou para cima.
    const chain: X509Certificate[] = [];
    let current = signerCert;
    while (current && chain.length < 6 && !chain.includes(current)) {
      chain.push(current);
      const cert: X509Certificate = current;
      if (cert.checkIssued(cert)) break;
      current =
        certs.find(
          (c) => c.x509 !== cert && cert.checkIssued(c.x509) && cert.verify(c.x509.publicKey),
        )?.x509 ?? null;
    }
    const top = chain[chain.length - 1];
    let selfSigned = false;
    if (top && top === signerCert && top.checkIssued(top)) {
      try {
        selfSigned = top.verify(top.publicKey);
      } catch {
        selfSigned = false;
      }
    }

    return {
      digestAlgorithm,
      digestMatches,
      signatureValid,
      programName,
      programUrl,
      signer: signerCert ? summarize(signerCert) : null,
      chain: chain.map(summarize),
      selfSigned,
      timestamp: timestampOf(buf, unauth),
      nested: unauth.get(OID.nested)?.length ?? 0,
      ...(signerCert ? {} : { error: 'O certificado de quem assinou não veio no arquivo.' }),
    };
  } catch {
    return broken('Assinatura malformada.');
  }
}
