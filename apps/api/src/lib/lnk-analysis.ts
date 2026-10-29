/**
 * Atalho do Windows (.lnk, MS-SHLLINK) (item 84): destino, argumentos (onde o
 * comando costuma se esconder), diretorio, icone, como a janela abre, maquina e
 * MAC de quem criou e as datas. So le bytes, com limites; malformado = null.
 */

export interface LnkInfo {
  target: string | null;
  arguments: string | null;
  workingDir: string | null;
  relativePath: string | null;
  description: string | null;
  iconLocation: string | null;
  /** Como a janela abre: normal, maximizada ou minimizada (comum para esconder). */
  window: 'normal' | 'maximized' | 'minimized';
  /** Variavel de ambiente do destino (%COMSPEC%...), quando houver. */
  envTarget: string | null;
  /** Nome NetBIOS da maquina onde o atalho foi criado (TrackerDataBlock). */
  machine: string | null;
  /** MAC da maquina de origem (do GUID do objeto, versao 1). */
  mac: string | null;
  created: string | null;
  modified: string | null;
  accessed: string | null;
  targetSize: number | null;
  /** Alertas: argumentos longos, PowerShell/cmd/mshta, janela minimizada... */
  alerts: string[];
}

const HEADER_SIZE = 0x4c;
const LNK_CLSID = '0114020000000000c000000000000046';
const MAX_STRING = 32_768;

/** E um .lnk? (tamanho do cabecalho e CLSID). */
export function isLnk(buf: Buffer): boolean {
  return (
    buf.length >= HEADER_SIZE &&
    buf.readUInt32LE(0) === HEADER_SIZE &&
    buf.subarray(4, 20).toString('hex') === LNK_CLSID
  );
}

/** FILETIME (100 ns desde 1601) -> ISO; 0 = sem data. */
function filetime(buf: Buffer, off: number): string | null {
  const low = buf.readUInt32LE(off);
  const high = buf.readUInt32LE(off + 4);
  if (!low && !high) return null;
  const ms = (high * 2 ** 32 + low) / 10_000 - 11_644_473_600_000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) && ms > 0 ? date.toISOString() : null;
}

/** Texto terminado em zero (ANSI ou UTF-16). */
function cString(buf: Buffer, off: number, unicode: boolean, max = 1024): string {
  if (off < 0 || off >= buf.length) return '';
  if (unicode) {
    let end = off;
    while (end + 1 < buf.length && end - off < max * 2 && (buf[end] || buf[end + 1])) end += 2;
    return buf.toString('utf16le', off, end);
  }
  let end = off;
  while (end < buf.length && end - off < max && buf[end]) end++;
  return buf.toString('latin1', off, end);
}

/** Primeira sequencia UTF-16LE legivel (3+ caracteres) terminada em zero, em [start, end). */
function utf16Run(buf: Buffer, start: number, end: number): string | null {
  for (const align of [0, 1]) {
    let runStart = -1;
    for (let i = start + align; i + 1 < end; i += 2) {
      const code = buf.readUInt16LE(i);
      if (code >= 0x20 && code !== 0xffff && !(code >= 0xd800 && code <= 0xdfff)) {
        if (runStart < 0) runStart = i;
      } else {
        if (code === 0 && runStart >= 0 && (i - runStart) / 2 >= 3) {
          return buf.toString('utf16le', runStart, i);
        }
        runStart = -1;
      }
    }
  }
  return null;
}

/** Caminho montado pela lista de itens do Shell (IDList), quando nao ha LinkInfo. */
function idListPath(buf: Buffer, start: number, size: number): string | null {
  const parts: string[] = [];
  let p = start;
  const end = start + size;
  while (p + 2 <= end) {
    const len = buf.readUInt16LE(p);
    if (len < 2 || p + len > end) break;
    const type = buf[p + 2];
    if (type === 0x2f && len >= 5) {
      // Volume: "C:\".
      parts.push(buf.toString('latin1', p + 3, p + 6).replace(/\0.*$/, ''));
    } else if ((type & 0x70) === 0x30 && len > 14) {
      // Arquivo/pasta: nome curto em ANSI depois de 14 bytes; o longo (UTF-16)
      // fica na extensao BEEF0004, quando existe.
      let name = cString(buf, p + 14, false, 260);
      const sig = buf.indexOf(Buffer.from([0x04, 0x00, 0xef, 0xbe]), p + 14);
      if (sig > 0 && sig < p + len) {
        // Os campos antes do nome mudam com a versao da extensao: o nome longo e a
        // primeira sequencia UTF-16 legivel (3+ caracteres) terminada em zero.
        const longName = utf16Run(buf, sig + 4, p + len);
        if (longName) name = longName;
      }
      if (name) parts.push(name);
    }
    p += len;
  }
  if (!parts.length) return null;
  return parts.join('\\').replace(/\\\\+/g, '\\');
}

/** Le o .lnk; null se nao for um atalho valido. */
export function analyzeLnk(buf: Buffer): LnkInfo | null {
  if (!isLnk(buf)) return null;
  try {
    const flags = buf.readUInt32LE(0x14);
    const unicode = (flags & 0x80) !== 0;
    const showCommand = buf.readUInt32LE(0x3c);
    let p = HEADER_SIZE;
    let target: string | null = null;

    // LinkTargetIDList.
    if (flags & 0x01) {
      const size = buf.readUInt16LE(p);
      target = idListPath(buf, p + 2, size);
      p += 2 + size;
    }
    // LinkInfo: caminho local (ou de rede) do destino.
    if (flags & 0x02) {
      const size = buf.readUInt32LE(p);
      const headerSize = buf.readUInt32LE(p + 4);
      const infoFlags = buf.readUInt32LE(p + 8);
      if (infoFlags & 0x1) {
        const base = cString(buf, p + buf.readUInt32LE(p + 16), false, 260);
        const suffix = cString(buf, p + buf.readUInt32LE(p + 24), false, 260);
        if (headerSize >= 0x24) {
          const ubase = cString(buf, p + buf.readUInt32LE(p + 28), true, 260);
          const usuffix = cString(buf, p + buf.readUInt32LE(p + 32), true, 260);
          if (ubase) target = ubase + usuffix;
        }
        if (base && (!target || !target.includes(':'))) target = base + suffix;
      }
      p += size;
    }
    // StringData: nome, caminho relativo, diretorio, argumentos, icone.
    const strings: (string | null)[] = [];
    for (const bit of [0x04, 0x08, 0x10, 0x20, 0x40]) {
      if (!(flags & bit)) {
        strings.push(null);
        continue;
      }
      const count = Math.min(buf.readUInt16LE(p), MAX_STRING);
      const bytes = unicode ? count * 2 : count;
      strings.push(buf.toString(unicode ? 'utf16le' : 'latin1', p + 2, p + 2 + bytes));
      p += 2 + bytes;
    }
    const [description, relativePath, workingDir, args, iconLocation] = strings;

    // ExtraData: variavel de ambiente e rastreio (maquina + MAC).
    let envTarget: string | null = null;
    let machine: string | null = null;
    let mac: string | null = null;
    while (p + 8 <= buf.length) {
      const size = buf.readUInt32LE(p);
      if (size < 4) break;
      const sig = buf.readUInt32LE(p + 4);
      if (sig === 0xa0000001 && size >= 0x314) {
        envTarget = cString(buf, p + 0x10c, true, 260) || cString(buf, p + 8, false, 260) || null;
      } else if (sig === 0xa0000003 && size >= 0x60) {
        machine = cString(buf, p + 16, false, 16) || null;
        // Droid (2o GUID): os 6 ultimos bytes de um UUID v1 sao o MAC.
        const droid = buf.subarray(p + 32, p + 48);
        if (droid[7] >> 4 === 1) {
          mac = [...droid.subarray(10, 16)].map((b) => b.toString(16).padStart(2, '0')).join(':');
        }
      }
      p += size;
    }

    const window = showCommand === 3 ? 'maximized' : showCommand === 7 ? 'minimized' : 'normal';
    const finalTarget = target || envTarget || relativePath || null;
    const alerts: string[] = [];
    const command = `${finalTarget ?? ''} ${args ?? ''}`.toLowerCase();
    if (
      /powershell|pwsh|cmd\.exe|mshta|wscript|cscript|rundll32|regsvr32|certutil|bitsadmin|msiexec|conhost/.test(
        command,
      )
    ) {
      alerts.push('Abre um interpretador de comandos ou binário do sistema usado em ataques.');
    }
    if ((args?.length ?? 0) > 200)
      alerts.push(`Argumentos longos (${args!.length} caracteres): comando escondido.`);
    if (args && /^\s{20,}/.test(args))
      alerts.push(
        'Argumentos começam com muitos espaços (escondem o comando na janela de propriedades).',
      );
    if (/https?:\/\//i.test(args ?? '')) alerts.push('Argumentos com endereço da internet.');
    if (window === 'minimized') alerts.push('Abre minimizado (a vítima não vê a janela).');
    if (
      iconLocation &&
      finalTarget &&
      !iconLocation.toLowerCase().includes(finalTarget.toLowerCase().split('\\').pop() ?? '')
    ) {
      if (/\.(pdf|docx?|xlsx?|jpg|png)|shell32|imageres/i.test(iconLocation)) {
        alerts.push('Ícone de outro tipo de arquivo (disfarça o atalho como documento).');
      }
    }

    return {
      target: finalTarget,
      arguments: args,
      workingDir,
      relativePath,
      description,
      iconLocation,
      window,
      envTarget,
      machine,
      mac,
      created: filetime(buf, 0x1c),
      accessed: filetime(buf, 0x24),
      modified: filetime(buf, 0x2c),
      targetSize: buf.readUInt32LE(0x34) || null,
      alerts,
    };
  } catch {
    return null;
  }
}
