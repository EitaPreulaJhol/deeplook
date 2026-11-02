/**
 * Imagens de disco (item 84): ISO 9660 (com nomes longos do Joliet), FAT12/16/32
 * (imagem crua ou VHD fixo, com ou sem MBR). Lista os arquivos e permite
 * extrair cada um. So le bytes, com limites; nada e montado nem executado.
 */

export interface DiskFile {
  path: string;
  size: number;
  hidden: boolean;
  /** Onde estao os bytes (para extrair). */
  extent: { kind: 'iso'; offset: number } | { kind: 'fat'; cluster: number };
}

export interface DiskImageInfo {
  format: 'iso9660' | 'fat' | 'vhd-fat' | 'unsupported';
  /** Formato reconhecido mas nao listado (NTFS, VHDX, VHD dinamico, UDF puro). */
  note: string | null;
  label: string | null;
  files: DiskFile[];
  /** Mais arquivos do que o limite (a lista foi cortada). */
  truncated: boolean;
  alerts: string[];
}

const MAX_FILES = 500;
const MAX_DEPTH = 16;
/** Bytes de diretorio lidos por imagem; a profundidade sozinha ainda deixa crescer. */
const MAX_DIR_BYTES = 64 * 1024 * 1024;
const SECTOR = 2048;
const RISKY = /\.(exe|dll|scr|com|pif|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|lnk|msi|cpl|jar)$/i;

// ------------------------------------------------------------------ ISO 9660

function readIso(buf: Buffer): DiskImageInfo | null {
  if (buf.length < 0x8800 || buf.toString('latin1', 0x8001, 0x8006) !== 'CD001') return null;
  // Descritores a partir do setor 16: primario (1) e Joliet (2 com %/@ ou %/C ou %/E).
  let primary = -1;
  let joliet = -1;
  for (let s = 16; s < 64; s++) {
    const off = s * SECTOR;
    if (off + SECTOR > buf.length || buf.toString('latin1', off + 1, off + 6) !== 'CD001') break;
    const type = buf[off];
    if (type === 1 && primary < 0) primary = off;
    if (
      type === 2 &&
      buf[off + 88] === 0x25 &&
      buf[off + 89] === 0x2f &&
      [0x40, 0x43, 0x45].includes(buf[off + 90])
    ) {
      joliet = off;
    }
    if (type === 255) break;
  }
  const pvd = joliet >= 0 ? joliet : primary;
  if (pvd < 0) return null;
  const unicode = joliet >= 0;
  // Joliet guarda em UTF-16 big-endian.
  const label = (
    unicode
      ? Buffer.from(buf.subarray(pvd + 40, pvd + 72))
          .swap16()
          .toString('utf16le')
      : buf.toString('latin1', pvd + 40, pvd + 72)
  )
    .replaceAll('\u0000', '')
    .trim();
  const files: DiskFile[] = [];
  let truncated = false;
  const visited = new Set<number>();
  let dirBytes = 0;

  const name = (rec: number, len: number) => {
    const raw = buf.subarray(rec + 33, rec + 33 + len);
    let n = unicode ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
    n = n.replace(/;\d+$/, '').replace(/\.$/, '');
    return n;
  };

  const walk = (lba: number, size: number, prefix: string, depth: number) => {
    if (depth > MAX_DEPTH || visited.has(lba)) return;
    visited.add(lba);
    const start = lba * SECTOR;
    const end = Math.min(start + size, buf.length);
    dirBytes += Math.max(0, end - start);
    if (dirBytes > MAX_DIR_BYTES) {
      truncated = true;
      return;
    }
    let p = start;
    while (p < end) {
      const len = buf[p];
      if (len === 0) {
        // Registros nao cruzam setores: pula para o proximo.
        p = (Math.floor(p / SECTOR) + 1) * SECTOR;
        continue;
      }
      if (p + len > end || len < 34) break;
      const extent = buf.readUInt32LE(p + 2);
      const dataLen = buf.readUInt32LE(p + 10);
      const flags = buf[p + 25];
      const nameLen = buf[p + 32];
      const first = buf[p + 33];
      if (!(nameLen === 1 && (first === 0 || first === 1))) {
        const n = name(p, nameLen);
        const path = prefix ? `${prefix}/${n}` : n;
        if (flags & 0x02) walk(extent, dataLen, path, depth + 1);
        else if (files.length < MAX_FILES) {
          files.push({
            path,
            size: dataLen,
            hidden: (flags & 0x01) !== 0,
            extent: { kind: 'iso', offset: extent * SECTOR },
          });
        } else truncated = true;
      }
      p += len;
    }
  };
  const root = pvd + 156;
  walk(buf.readUInt32LE(root + 2), buf.readUInt32LE(root + 10), '', 0);
  return { format: 'iso9660', note: null, label: label || null, files, truncated, alerts: [] };
}

// ------------------------------------------------------------------ FAT

interface Fat {
  base: number;
  bytesPerSector: number;
  sectorsPerCluster: number;
  fatOffset: number;
  fatType: 12 | 16 | 32;
  rootOffset: number;
  rootEntries: number;
  rootCluster: number;
  dataOffset: number;
  label: string | null;
}

function fatAt(buf: Buffer, base: number): Fat | null {
  if (base + 512 > buf.length || buf[base + 510] !== 0x55 || buf[base + 511] !== 0xaa) return null;
  const bps = buf.readUInt16LE(base + 11);
  const spc = buf[base + 13];
  const reserved = buf.readUInt16LE(base + 14);
  const fats = buf[base + 16];
  const rootEntries = buf.readUInt16LE(base + 17);
  const total16 = buf.readUInt16LE(base + 19);
  const fatSize16 = buf.readUInt16LE(base + 22);
  const total32 = buf.readUInt32LE(base + 32);
  if (![512, 1024, 2048, 4096].includes(bps) || !spc || spc & (spc - 1) || !reserved || !fats)
    return null;
  const fatSize = fatSize16 || buf.readUInt32LE(base + 36);
  const total = total16 || total32;
  const rootSectors = Math.ceil((rootEntries * 32) / bps);
  const dataSectors = total - (reserved + fats * fatSize + rootSectors);
  const clusters = Math.floor(dataSectors / spc);
  const fatType: Fat['fatType'] = clusters < 4085 ? 12 : clusters < 65525 ? 16 : 32;
  const fatOffset = base + reserved * bps;
  const rootOffset = fatOffset + fats * fatSize * bps;
  const labelOff = fatType === 32 ? base + 71 : base + 43;
  const label = buf.toString('latin1', labelOff, labelOff + 11).trim();
  return {
    base,
    bytesPerSector: bps,
    sectorsPerCluster: spc,
    fatOffset,
    fatType,
    rootOffset,
    rootEntries,
    rootCluster: fatType === 32 ? buf.readUInt32LE(base + 44) : 0,
    dataOffset: rootOffset + rootSectors * bps,
    label: label && label !== 'NO NAME' ? label : null,
  };
}

function nextCluster(buf: Buffer, fat: Fat, cluster: number): number {
  if (fat.fatType === 12) {
    const off = fat.fatOffset + Math.floor(cluster * 1.5);
    if (off + 2 > buf.length) return -1;
    const v = buf.readUInt16LE(off);
    const next = cluster & 1 ? v >> 4 : v & 0xfff;
    return next >= 0xff8 ? -1 : next;
  }
  if (fat.fatType === 16) {
    const off = fat.fatOffset + cluster * 2;
    if (off + 2 > buf.length) return -1;
    const next = buf.readUInt16LE(off);
    return next >= 0xfff8 ? -1 : next;
  }
  const off = fat.fatOffset + cluster * 4;
  if (off + 4 > buf.length) return -1;
  const next = buf.readUInt32LE(off) & 0x0fffffff;
  return next >= 0x0ffffff8 ? -1 : next;
}

const clusterOffset = (fat: Fat, cluster: number) =>
  fat.dataOffset + (cluster - 2) * fat.sectorsPerCluster * fat.bytesPerSector;
const clusterSize = (fat: Fat) => fat.sectorsPerCluster * fat.bytesPerSector;

/** Bytes de uma cadeia de clusters (ate `limit`). */
function chain(buf: Buffer, fat: Fat, start: number, limit: number): Buffer {
  const parts: Buffer[] = [];
  let total = 0;
  let cluster = start;
  const seen = new Set<number>();
  while (cluster >= 2 && total < limit && !seen.has(cluster)) {
    seen.add(cluster);
    const off = clusterOffset(fat, cluster);
    if (off < 0 || off >= buf.length) break;
    const part = buf.subarray(off, Math.min(off + clusterSize(fat), buf.length));
    parts.push(part);
    total += part.length;
    cluster = nextCluster(buf, fat, cluster);
  }
  return Buffer.concat(parts).subarray(0, limit);
}

function readFat(buf: Buffer, fat: Fat): { files: DiskFile[]; truncated: boolean } {
  const files: DiskFile[] = [];
  let truncated = false;
  // Cada diretorio uma vez: subpastas apontando para o mesmo cluster multiplicam o trabalho.
  const visited = new Set<number>();
  let dirBytes = 0;

  const entries = (dir: Buffer, prefix: string, depth: number) => {
    let lfn: string[] = [];
    for (let p = 0; p + 32 <= dir.length; p += 32) {
      const first = dir[p];
      if (first === 0) break;
      if (first === 0xe5) {
        lfn = [];
        continue;
      }
      const attr = dir[p + 11];
      if (attr === 0x0f) {
        // Nome longo (VFAT): pedacos de 13 caracteres, do ultimo para o primeiro.
        const part = Buffer.concat([
          dir.subarray(p + 1, p + 11),
          dir.subarray(p + 14, p + 26),
          dir.subarray(p + 28, p + 32),
        ])
          .toString('utf16le')
          .replace(/\0[\s\S]*$/, '')
          .replace(/￿/g, '');
        lfn.unshift(part);
        continue;
      }
      if (attr & 0x08) {
        lfn = [];
        continue; // rotulo do volume
      }
      const short = dir.toString('latin1', p, p + 8).trim();
      const ext = dir.toString('latin1', p + 8, p + 11).trim();
      const n = lfn.length ? lfn.join('') : ext ? `${short}.${ext}` : short;
      lfn = [];
      if (n === '.' || n === '..') continue;
      const cluster =
        (fat.fatType === 32 ? dir.readUInt16LE(p + 20) << 16 : 0) | dir.readUInt16LE(p + 26);
      const size = dir.readUInt32LE(p + 28);
      const path = prefix ? `${prefix}/${n}` : n;
      if (attr & 0x10) {
        if (depth < MAX_DEPTH && cluster >= 2 && !visited.has(cluster)) {
          visited.add(cluster);
          const sub = chain(buf, fat, cluster, 4 * 1024 * 1024);
          dirBytes += sub.length;
          if (dirBytes > MAX_DIR_BYTES) truncated = true;
          else entries(sub, path, depth + 1);
        }
      } else if (files.length < MAX_FILES) {
        files.push({ path, size, hidden: (attr & 0x02) !== 0, extent: { kind: 'fat', cluster } });
      } else truncated = true;
    }
  };
  const root =
    fat.fatType === 32
      ? chain(buf, fat, fat.rootCluster, 4 * 1024 * 1024)
      : buf.subarray(fat.rootOffset, Math.min(fat.rootOffset + fat.rootEntries * 32, buf.length));
  entries(root, '', 0);
  return { files, truncated };
}

/** Particao FAT: sem MBR (volume direto) ou a primeira particao FAT do MBR. */
function findFat(buf: Buffer, end: number): Fat | null {
  const direct = fatAt(buf, 0);
  if (direct) return direct;
  if (buf[510] !== 0x55 || buf[511] !== 0xaa) return null;
  for (let i = 0; i < 4; i++) {
    const entry = 446 + i * 16;
    const type = buf[entry + 4];
    const lba = buf.readUInt32LE(entry + 8);
    if ([0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e].includes(type) && lba * 512 < end) {
      const fat = fatAt(buf, lba * 512);
      if (fat) return fat;
    }
  }
  return null;
}

// ------------------------------------------------------------------ deteccao

function unsupported(note: string): DiskImageInfo {
  return { format: 'unsupported', note, label: null, files: [], truncated: false, alerts: [] };
}

/** Analisa a imagem; null se nao for imagem de disco reconhecida. */
export function analyzeDiskImage(buf: Buffer): DiskImageInfo | null {
  try {
    const iso = readIso(buf);
    if (iso) return finish(iso);
    if (buf.length >= 8 && buf.toString('latin1', 0, 8) === 'vhdxfile') {
      return unsupported('VHDX: o conteúdo não é listado.');
    }
    // VHD: rodape "conectix" no fim (fixo) ou copia no inicio (dinamico).
    const footer = buf.length >= 512 ? buf.length - 512 : -1;
    const isVhd = footer >= 0 && buf.toString('latin1', footer, footer + 8) === 'conectix';
    if (isVhd || (buf.length >= 8 && buf.toString('latin1', 0, 8) === 'conectix')) {
      const diskType = isVhd ? buf.readUInt32BE(footer + 60) : 3;
      if (diskType !== 2)
        return unsupported('VHD dinâmico ou diferencial: o conteúdo não é listado.');
      const fat = findFat(buf, footer);
      if (!fat) {
        const ntfs = buf.indexOf('NTFS    ', 0, 'latin1');
        return unsupported(
          ntfs >= 0 && ntfs < 1024 * 1024
            ? 'VHD com NTFS: o conteúdo não é listado.'
            : 'VHD sem partição FAT reconhecida.',
        );
      }
      const { files, truncated } = readFat(buf, fat);
      return finish({
        format: 'vhd-fat',
        note: null,
        label: fat.label,
        files,
        truncated,
        alerts: [],
      });
    }
    const fat = findFat(buf, buf.length);
    if (fat) {
      const { files, truncated } = readFat(buf, fat);
      return finish({ format: 'fat', note: null, label: fat.label, files, truncated, alerts: [] });
    }
    if (buf.length > 0x8006 && /BEA01|NSR0[23]/.test(buf.toString('latin1', 0x8000, 0x9800))) {
      return unsupported('UDF sem ISO 9660: o conteúdo não é listado.');
    }
    return null;
  } catch {
    return null;
  }
}

function finish(info: DiskImageInfo): DiskImageInfo {
  const risky = info.files.filter((f) => RISKY.test(f.path));
  const hiddenRisky = risky.filter((f) => f.hidden);
  if (risky.length) {
    info.alerts.push(
      `${risky.length} arquivo(s) executável(is) ou de script dentro da imagem (ex.: ${risky
        .slice(0, 3)
        .map((f) => f.path)
        .join(', ')}).`,
    );
  }
  if (hiddenRisky.length) info.alerts.push(`${hiddenRisky.length} deles oculto(s).`);
  if (info.files.some((f) => /\.lnk$/i.test(f.path)) && info.files.some((f) => f.hidden)) {
    info.alerts.push(
      'Atalho (.lnk) visível com arquivos ocultos: padrão comum de entrega de malware.',
    );
  }
  return info;
}

/** Bytes de um arquivo da imagem (ate `limit`); null se fora do arquivo. */
export function extractDiskFile(buf: Buffer, file: DiskFile, limit: number): Buffer | null {
  const size = Math.min(file.size, limit);
  if (file.extent.kind === 'iso') {
    const { offset } = file.extent;
    if (offset + size > buf.length) return null;
    return Buffer.from(buf.subarray(offset, offset + size));
  }
  const footer =
    buf.length >= 512 && buf.toString('latin1', buf.length - 512, buf.length - 504) === 'conectix';
  const fat = findFat(buf, footer ? buf.length - 512 : buf.length);
  if (!fat) return null;
  if (file.size === 0) return Buffer.alloc(0);
  const data = chain(buf, fat, file.extent.cluster, size);
  return data.length === size ? data : null;
}
