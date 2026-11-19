import { extractZipEntryAsync, listZip, type ZipEntry, ZipError } from './zip';

/**
 * Senhas candidatas (plans/analise-estatica-ampliada, item 9). O golpe manda o anexo cifrado (ZIP
 * com senha, Office cifrado) para o filtro de e-mail nao abrir, e a senha vai no corpo da mensagem:
 * "senha: 1234", "Password - Fatura2026". Daqui saem essas senhas, mais as de costume da area.
 */

/** As de costume (pacotes de amostras e de golpe). */
export const COMMON_PASSWORDS = ['infected', 'malware', 'virus', '1234', '12345', '123456'];
const MAX_CANDIDATES = 20;

const KEYWORDS =
  'senha|password|passwd|pass|pwd|c[oó]digo|code|clave|contrase[nñ]a|kennwort|mot\\s+de\\s+passe|pin';

/** As senhas citadas no texto, na ordem, mais as de costume. */
export function passwordCandidates(text: string | null | undefined): string[] {
  const out: string[] = [];
  const body = (text ?? '').slice(0, 200_000);
  const re = new RegExp(
    `(?:${KEYWORDS})\\s*(?:do\\s+arquivo|of\\s+the\\s+file|para\\s+abrir|to\\s+open)?(?:\\s*(?:é|e|is|:|=|-|–)){0,3}\\s*["'“”«]?([^\\s"'“”«»<>]{3,64})`,
    'gi',
  );
  for (const m of body.matchAll(re)) {
    const value = m[1].replace(/[.,;:!?)]+$/, '');
    if (value.length >= 3 && !/^(?:é|is|the|do|da|de|para|abrir)$/i.test(value)) out.push(value);
  }
  return [...new Set([...out, ...COMMON_PASSWORDS])].slice(0, MAX_CANDIDATES);
}

const MAX_FILES = 50;

/**
 * Abre um ZIP cifrado com a primeira senha candidata que servir. Devolve a senha e os arquivos (ate
 * `maxSize` cada e MAX_FILES no total), ou null se nao e ZIP cifrado ou nenhuma senha serve.
 */
export async function openEncryptedZip(
  buf: Buffer,
  candidates: string[],
  maxSize: number,
): Promise<{ password: string; files: { name: string; data: Buffer }[] } | null> {
  let entries: ZipEntry[];
  try {
    entries = listZip(buf).filter((e) => !e.dir);
  } catch {
    return null;
  }
  const encrypted = entries.filter((e) => e.encrypted);
  if (!encrypted.length) return null;
  const probe = encrypted.find((e) => e.size <= maxSize) ?? encrypted[0];
  for (const password of candidates) {
    try {
      await extractZipEntryAsync(buf, probe, password, maxSize);
    } catch (err) {
      // Senha errada que passa no byte de conferencia cai no CRC ou no tamanho: tenta a proxima.
      if (err instanceof ZipError && (err.code === 'BAD_PASSWORD' || err.code === 'CORRUPT')) {
        continue;
      }
      return null;
    }
    const files: { name: string; data: Buffer }[] = [];
    for (const e of entries.slice(0, MAX_FILES)) {
      if (e.size > maxSize) continue;
      try {
        files.push({ name: e.name, data: await extractZipEntryAsync(buf, e, password, maxSize) });
      } catch {
        // Entrada corrompida ou com outra senha: fica de fora.
      }
    }
    return { password, files };
  }
  return null;
}
