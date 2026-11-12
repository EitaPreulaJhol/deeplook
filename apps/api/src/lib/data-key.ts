import crypto from 'node:crypto';

import { env } from '../env';

/**
 * Chave de dados (revisao de novembro, item 1.1): cifra o que fica guardado no banco e precisa
 * voltar a ser lido (hoje, o segredo do 2FA).
 *
 * Antes, a chave saia do SESSION_SECRET, que tambem assina os cookies e o CAPTCHA: troca-lo
 * (o certo depois de uma suspeita de vazamento de sessao) quebrava o 2FA de todas as contas.
 * Com DATA_KEY no .env, o dado cifrado passa a depender so dela, e o SESSION_SECRET pode
 * mudar a vontade.
 *
 * Formatos guardados:
 *   v1:iv:tag:dado            chave derivada do SESSION_SECRET (antigo; segue legivel)
 *   v2:idDaChave:iv:tag:dado  chave derivada do DATA_KEY; o id diz qual chave cifrou
 *
 * Rotacao do proprio DATA_KEY: ponha a chave nova em DATA_KEY e a antiga em DATA_KEY_PREVIOUS.
 * Na subida, `rekey` recifra com a nova tudo o que ainda estiver sob a antiga (ou em v1); depois
 * disso o DATA_KEY_PREVIOUS pode sair do .env.
 */

export type DataKeys = {
  /** SESSION_SECRET: so para ler o formato v1. */
  sessionSecret: string;
  /** DATA_KEY: vazio = modo antigo (cifra em v1). */
  dataKey: string;
  /** DATA_KEY_PREVIOUS: so para ler, durante uma rotacao. */
  previous: string;
};

export const envKeys = (): DataKeys => ({
  sessionSecret: env.SESSION_SECRET,
  dataKey: env.DATA_KEY,
  previous: env.DATA_KEY_PREVIOUS,
});

const legacyKey = (sessionSecret: string) =>
  crypto.createHash('sha256').update(`deeplook-2fa:${sessionSecret}`).digest();

/** Chave AES de 32 bytes a partir do DATA_KEY (HKDF, com um rotulo por versao do formato). */
const derive = (dataKey: string) =>
  Buffer.from(crypto.hkdfSync('sha256', dataKey, 'deeplook', 'deeplook-data-key:v2', 32));

/** Id curto da chave: diz qual DATA_KEY cifrou, sem revelar nada dela. */
export const keyId = (dataKey: string) =>
  crypto.createHash('sha256').update(`deeplook-data-key-id:${dataKey}`).digest('hex').slice(0, 8);

function seal(key: Buffer, plain: string): [string, string, string] {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')];
}

function open(key: Buffer, iv: string, tag: string, data: string): string {
  // Sem authTagLength, o Node aceita tag truncada (4 a 15 bytes), mais facil de forjar.
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), {
    authTagLength: 16,
  });
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Cifra com o DATA_KEY (v2); sem ele, com a chave do SESSION_SECRET (v1), como antes. */
export function sealSecret(plain: string, keys: DataKeys = envKeys()): string {
  if (!keys.dataKey) return ['v1', ...seal(legacyKey(keys.sessionSecret), plain)].join(':');
  return ['v2', keyId(keys.dataKey), ...seal(derive(keys.dataKey), plain)].join(':');
}

/** Decifra v1 ou v2; lanca se a chave que cifrou nao esta mais no ambiente. */
export function openSecret(stored: string, keys: DataKeys = envKeys()): string {
  const parts = stored.split(':');
  if (parts[0] === 'v1' && parts.length === 4) {
    return open(legacyKey(keys.sessionSecret), parts[1], parts[2], parts[3]);
  }
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, id, iv, tag, data] = parts;
    const key = [keys.dataKey, keys.previous].find((k) => k && keyId(k) === id);
    if (!key) throw new Error('a chave de dados que cifrou este valor não está no ambiente');
    return open(derive(key), iv, tag, data);
  }
  throw new Error('formato de segredo desconhecido');
}

/** O valor esta sob outra chave que nao o DATA_KEY atual (v1, ou v2 de uma chave anterior)? */
export function needsRekey(stored: string, keys: DataKeys = envKeys()): boolean {
  if (!keys.dataKey) return false;
  const parts = stored.split(':');
  return !(parts[0] === 'v2' && parts[1] === keyId(keys.dataKey));
}

/**
 * Recifra o valor com o DATA_KEY atual. Devolve null se ja esta em dia ou se nao ha DATA_KEY;
 * lanca se nao der para ler (SESSION_SECRET ja trocado, ou chave anterior ausente).
 */
export function rekey(stored: string, keys: DataKeys = envKeys()): string | null {
  if (!needsRekey(stored, keys)) return null;
  return sealSecret(openSecret(stored, keys), keys);
}
