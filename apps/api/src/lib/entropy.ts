/** Entropia de Shannon (bits por byte, 0 a 8) de um trecho, com duas casas. */
export function entropy(buf: Buffer, start = 0, end = buf.length): number {
  const len = Math.max(0, end - start);
  if (!len) return 0;
  const counts = new Array<number>(256).fill(0);
  for (let i = start; i < end; i++) counts[buf[i]]++;
  let h = 0;
  for (const c of counts) {
    if (c) {
      const p = c / len;
      h -= p * Math.log2(p);
    }
  }
  return Math.round(h * 100) / 100;
}
