/** Tipo real do arquivo pela assinatura dos primeiros bytes (nunca pela extensao). */

export interface DetectedType {
  id: string;
  label: string;
  /** Extensoes esperadas para este conteudo. */
  extensions: string[];
  /** Executavel/script: disfarcado com outra extensao e um forte indicio. */
  executable: boolean;
}

export const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
export const ascii = (buf: Buffer, text: string, offset = 0) =>
  buf.length >= offset + text.length &&
  buf.toString('latin1', offset, offset + text.length) === text;

export const EXE_EXTS = ['exe', 'dll', 'sys', 'scr', 'cpl', 'ocx', 'drv', 'efi', 'com'];

export function detectType(buf: Buffer): DetectedType | null {
  const t = (id: string, label: string, extensions: string[], executable = false) => ({
    id,
    label,
    extensions,
    executable,
  });
  if (startsWith(buf, [0x4d, 0x5a])) return t('pe', 'Executável do Windows (PE)', EXE_EXTS, true);
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]))
    return t('elf', 'Executável Linux (ELF)', ['', 'elf', 'so', 'bin', 'o'], true);
  if (
    startsWith(buf, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(buf, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(buf, [0xce, 0xfa, 0xed, 0xfe])
  ) {
    return t('macho', 'Executável macOS (Mach-O)', ['', 'dylib', 'bundle', 'app'], true);
  }
  if (ascii(buf, '%PDF-')) return t('pdf', 'Documento PDF', ['pdf']);
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP: Office moderno e Java se reconhecem pelos nomes internos (sem descompactar).
    const head = buf.toString('latin1', 0, Math.min(buf.length, 64 * 1024));
    if (head.includes('word/'))
      return t('docx', 'Documento Word (OOXML)', ['docx', 'docm', 'dotx', 'dotm']);
    if (head.includes('xl/'))
      return t('xlsx', 'Planilha Excel (OOXML)', ['xlsx', 'xlsm', 'xltx', 'xltm']);
    if (head.includes('ppt/'))
      return t('pptx', 'Apresentação PowerPoint (OOXML)', ['pptx', 'pptm', 'potx']);
    if (head.includes('META-INF/MANIFEST.MF')) return t('jar', 'Pacote Java (JAR)', ['jar'], true);
    if (head.includes('AndroidManifest.xml'))
      return t('apk', 'Aplicativo Android (APK)', ['apk'], true);
    return t('zip', 'Arquivo ZIP', ['zip']);
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return t('ole', 'Documento Office antigo / MSI (OLE)', [
      'doc',
      'xls',
      'ppt',
      'msi',
      'msg',
      'dot',
      'xlt',
    ]);
  }
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return t('7z', 'Arquivo 7-Zip', ['7z']);
  if (ascii(buf, 'Rar!')) return t('rar', 'Arquivo RAR', ['rar']);
  if (startsWith(buf, [0x1f, 0x8b])) return t('gzip', 'Arquivo GZIP', ['gz', 'tgz']);
  if (ascii(buf, 'MSCF')) return t('cab', 'Arquivo CAB', ['cab']);
  if (ascii(buf, 'ITSF')) return t('chm', 'Ajuda compilada (CHM)', ['chm'], true);
  if (startsWith(buf, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) {
    return t('lnk', 'Atalho do Windows (LNK)', ['lnk'], true);
  }
  if (ascii(buf, 'CD001', 0x8001)) return t('iso', 'Imagem de disco (ISO)', ['iso', 'img']);
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return t('png', 'Imagem PNG', ['png']);
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return t('jpeg', 'Imagem JPEG', ['jpg', 'jpeg']);
  if (ascii(buf, 'GIF8')) return t('gif', 'Imagem GIF', ['gif']);
  if (ascii(buf, '{\\rtf')) return t('rtf', 'Documento RTF', ['rtf', 'doc']);
  if (ascii(buf, '#!'))
    return t('script', 'Script com interpretador (#!)', ['sh', 'py', 'pl', 'rb', ''], true);
  const text = buf.toString('latin1', 0, Math.min(buf.length, 512)).trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html')) {
    return t('html', 'Página HTML', ['html', 'htm', 'hta', 'xhtml']);
  }
  return null;
}
