import crypto from 'node:crypto';

import QRCode from 'qrcode';

import { env } from '../env';

/**
 * 2FA opcional (item 50): TOTP do RFC 6238 (SHA-1, 6 digitos, 30 s), o mesmo
 * dos aplicativos autenticadores. O segredo fica cifrado (AES-256-GCM com chave
 * derivada do SESSION_SECRET); codigos de recuperacao so como hash.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Passos aceitos antes/depois do atual (relogio do celular adiantado/atrasado). */
const WINDOW = 1;
export const ISSUER = 'DeepLook';
export const RECOVERY_CODES = 10;
/** Validade da etapa "codigo de verificacao" do login. */
const CHALLENGE_MS = 5 * 60 * 1000;

// ---- Base32 (RFC 4648, sem "=") ----

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('segredo inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---- HOTP / TOTP ----

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Confere o codigo na janela de +-1 passo e devolve o passo usado (para nao
 * aceitar o mesmo codigo duas vezes), ou null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const step = currentStep(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const s = step + d;
    if (lastStep !== null && s <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, s));
    if (crypto.timingSafeEqual(expected, Buffer.from(digits))) return s;
  }
  return null;
}

export function newSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function otpauthUri(email: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

/** QR code do otpauth:// em SVG (a aba 2FA mostra como imagem). */
export function qrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
}

// ---- Cifra do segredo ----

const key = () => crypto.createHash('sha256').update(`deeplook-2fa:${env.SESSION_SECRET}`).digest();

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1') throw new Error('formato de segredo desconhecido');
  // Sem authTagLength, o Node 22 aceita tag truncada (4 a 15 bytes), mais facil de forjar.
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

// ---- Codigos de recuperacao ----

/** "k7tm-q2xa" (8 caracteres sem 0/1/o/l para nao confundir). */
export function newRecoveryCodes(): string[] {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = crypto.randomBytes(8);
    const s = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha256').update(`deeplook-recovery:${normalized}`).digest('hex');
}

export const looksLikeRecoveryCode = (code: string) =>
  /^[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(code.trim()) && !/^\d+$/.test(code.replace('-', ''));

// ---- Desafio do login (etapa do codigo) ----

const sign = (payload: string) =>
  crypto
    .createHmac('sha256', `deeplook-2fa-challenge:${env.SESSION_SECRET}`)
    .update(payload)
    .digest('base64url');

/**
 * Marca da senha conferida (do hash, nunca a senha): o desafio de antes de uma troca
 * de senha nao vira sessao depois dela.
 */
export const credentialMark = (passwordHash: string) =>
  crypto
    .createHash('sha256')
    .update(`deeplook-credential:${passwordHash}`)
    .digest('base64url')
    .slice(0, 22);

/** Token assinado "userId.marca.expira.assinatura" entregue depois da senha certa. */
export function newChallenge(userId: string, passwordHash: string, now = Date.now()): string {
  const payload = `${userId}.${credentialMark(passwordHash)}.${now + CHALLENGE_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Conta e marca da senha do desafio, ou null se adulterado ou vencido. */
export function readChallenge(
  token: string,
  now = Date.now(),
): { userId: string; mark: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [userId, mark, exp, signature] = parts;
  const expected = sign(`${userId}.${mark}.${exp}`);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  return { userId, mark };
}
