/**
 * Hash perceptual do print de uma pagina (revisao de novembro, item 3.4): 256 bits, um por par
 * de pixels vizinhos de uma miniatura de 17x16 em tons de cinza (dHash). Quem calcula e o
 * servico de captura; aqui so se compara.
 *
 * Duas paginas com a mesma aparencia diferem em poucos bits, mesmo com outro dominio, outro
 * logotipo pequeno ou outro texto num campo. E o que liga o mesmo kit de phishing em hospedagens
 * diferentes, onde dominio, IP e hash do HTML mudam.
 */
export const PHASH_BITS = 256;
const PHASH_HEX = /^[0-9a-f]{64}$/;

/** Aceita so o formato que o servico de captura manda; qualquer outra coisa vira null. */
export function validPhash(value: unknown): string | null {
  return typeof value === 'string' && PHASH_HEX.test(value) ? value : null;
}

const POPCOUNT = Array.from({ length: 256 }, (_, n) => {
  let bits = 0;
  for (let v = n; v; v >>= 1) bits += v & 1;
  return bits;
});

/** Bits diferentes entre dois hashes; null se algum nao for um hash. */
export function phashDistance(a: string, b: string): number | null {
  if (!PHASH_HEX.test(a) || !PHASH_HEX.test(b)) return null;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff += POPCOUNT[x[i] ^ y[i]];
  return diff;
}

/** "Parecida" em %: 100 = identica. */
export function phashSimilarity(distance: number): number {
  return Math.round((1 - distance / PHASH_BITS) * 100);
}

/**
 * Pagina quase toda de uma cor (em branco, erro do navegador, "site suspenso"): quase todos os
 * bits iguais. O hash existe, mas ligaria entre si todas as paginas vazias, entao nao e usado.
 */
export function phashIsFlat(hash: string): boolean {
  const bytes = Buffer.from(hash, 'hex');
  let ones = 0;
  for (const byte of bytes) ones += POPCOUNT[byte];
  return ones < 16 || ones > PHASH_BITS - 16;
}
