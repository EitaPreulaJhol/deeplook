/** Tipo real do arquivo pela assinatura dos primeiros bytes (nunca pela extensao). */

import { listZip } from './zip';

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
    startsWith(buf, [0xce, 0xfa, 0xed, 0xfe]) ||
    // Universal (fat): CAFEBABE/CAFEBABF; o CAFEBABE tambem abre um .class (ver abaixo).
    startsWith(buf, [0xca, 0xfe, 0xba, 0xbf]) ||
    (startsWith(buf, [0xca, 0xfe, 0xba, 0xbe]) && isFatMachO(buf))
  ) {
    return t('macho', 'Executável macOS (Mach-O)', ['', 'dylib', 'bundle', 'app'], true);
  }
  // .class: CAFEBABE + minor/major (major >= 45), nao um nfat_arch pequeno.
  if (startsWith(buf, [0xca, 0xfe, 0xba, 0xbe]) && buf.length >= 8)
    return t('java-class', 'Classe Java (.class)', ['class'], true);
  // CRX (extensao do Chrome): "Cr24" + versao + cabecalho, depois um ZIP.
  if (ascii(buf, 'Cr24')) return t('crx', 'Extensão do Chrome (CRX)', ['crx'], true);
  // ASAR (Electron): pickle de 4 bytes + tamanhos, depois o JSON {"files":...}.
  if (startsWith(buf, [0x04, 0x00, 0x00, 0x00]) && ascii(buf, '{"files"', 16))
    return t('asar', 'Pacote Electron (ASAR)', ['asar'], true);
  // .pyc: versao (2 bytes LE) + \r\n. Py3 usa 3000..3999; Py2.7 usa 62211.
  if (buf.length >= 16 && buf[2] === 0x0d && buf[3] === 0x0a) {
    const v = buf.readUInt16LE(0);
    if ((v >= 3000 && v < 4000) || (v >= 62000 && v < 62300))
      return t('pyc', 'Bytecode Python (.pyc)', ['pyc', 'pyo'], true);
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
    // Os mais especificos antes do JAR: um XPI/MSIX tambem pode ter META-INF/.
    const names = zipNames(buf);
    const has = (n: string) => (names ? names.has(n) : head.includes(n));
    if (has('AppxManifest.xml') || has('AppxBlockMap.xml'))
      return t('msix', 'Pacote MSIX/AppX', ['msix', 'appx', 'msixbundle', 'appxbundle'], true);
    if (
      has('install.rdf') ||
      has('META-INF/mozilla.rsa') ||
      (has('manifest.json') && head.includes('gecko'))
    )
      return t('xpi', 'Extensão do Firefox (XPI)', ['xpi'], true);
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
  // OneNote (plans/caca-e-formatos, item 4): o GUID do cabecalho do .one.
  if (startsWith(buf, [0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78]))
    return t('onenote', 'Caderno do OneNote', ['one']);
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
  // ClickOnce: manifesto XML de implantacao (.application) ou de aplicativo (.manifest).
  if (text.startsWith('<?xml') || text.startsWith('<assembly')) {
    const xml = buf.toString('latin1', 0, Math.min(buf.length, 4096)).toLowerCase();
    if (/urn:schemas-microsoft-com:asm\.v/.test(xml) && xml.includes('<deployment'))
      return t('clickonce', 'Manifesto ClickOnce', ['application', 'manifest'], true);
  }
  return null;
}

/** Mach-O universal: nfat_arch (big-endian) e pequeno; no .class o campo e minor/major (>= 45). */
function isFatMachO(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  const n = buf.readUInt32BE(4);
  return n >= 1 && n < 45;
}

/** Nomes do diretorio central; null se nao der para ler (ZIP64/corrompido), e ai vale a busca no inicio. */
function zipNames(buf: Buffer): Set<string> | null {
  try {
    return new Set(listZip(buf).map((e) => e.path));
  } catch {
    return null;
  }
}
