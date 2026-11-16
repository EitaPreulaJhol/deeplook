import { readFileSync } from 'node:fs';

/**
 * Minidump sintetico (formato MDMP do MiniDumpWriteDump), para os testes do dump de memoria
 * (plans/novas-analises, item 3): SystemInfo (x64), lista de modulos vazia, as informacoes das
 * regioes (MemoryInfoList) e a memoria (Memory64List). Tres regioes:
 *
 *   - 0x10000: privada RWX com um PE mapeado (o PE de teste, cada secao no endereco virtual dela);
 *   - 0x30000: privada RX com "shellcode" (sem cabecalho) e uma URL;
 *   - 0x400000: imagem (MEM_IMAGE), que nao entra na busca.
 */

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

/** O PE do arquivo no layout da memoria: cabecalhos no inicio e cada secao no VirtualAddress. */
export function mapPe(file: Buffer): Buffer {
  const lfanew = file.readUInt32LE(0x3c);
  const sections = file.readUInt16LE(lfanew + 6);
  const optSize = file.readUInt16LE(lfanew + 20);
  const sizeOfImage = file.readUInt32LE(lfanew + 24 + 56);
  const sizeOfHeaders = file.readUInt32LE(lfanew + 24 + 60);
  const out = Buffer.alloc(Math.ceil(sizeOfImage / 0x1000) * 0x1000);
  file.copy(out, 0, 0, sizeOfHeaders);
  for (let i = 0; i < sections; i++) {
    const off = lfanew + 24 + optSize + i * 40;
    const va = file.readUInt32LE(off + 12);
    const rawSize = file.readUInt32LE(off + 16);
    const rawPtr = file.readUInt32LE(off + 20);
    file.copy(out, va, rawPtr, rawPtr + rawSize);
  }
  return out;
}

export function syntheticMinidump(pePath: string): Buffer {
  const pe = mapPe(readFileSync(pePath));
  const code = Buffer.alloc(0x1000);
  // Prologo tipico de shellcode (cld; call $+0x89) e uma URL em texto.
  Buffer.from([0xfc, 0xe8, 0x89, 0x00, 0x00, 0x00, 0x60, 0x89, 0xe5, 0x31, 0xd2]).copy(code);
  Buffer.from('http://deeplook-memoria.top/beacon\0').copy(code, 0x200);
  const image = Buffer.alloc(0x1000, 0x90);
  const regions: { base: number; data: Buffer; protect: number; type: number }[] = [
    { base: 0x10000, data: pe, protect: 0x40, type: 0x20000 },
    { base: 0x30000, data: code, protect: 0x20, type: 0x20000 },
    { base: 0x400000, data: image, protect: 0x20, type: 0x1000000 },
  ];

  const sysinfo = Buffer.alloc(56);
  sysinfo.writeUInt16LE(9, 0); // PROCESSOR_ARCHITECTURE_AMD64
  sysinfo.writeUInt32LE(10, 8); // MajorVersion
  const modules = u32(0);
  const memInfo = Buffer.concat([
    u32(16),
    u32(48),
    u64(regions.length),
    ...regions.map((r) =>
      Buffer.concat([
        u64(r.base),
        u64(r.base),
        u32(r.protect),
        u32(0),
        u64(r.data.length),
        u32(0x1000), // MEM_COMMIT
        u32(r.protect),
        u32(r.type),
        u32(0),
      ]),
    ),
  ]);
  const mem64Head = 16 + regions.length * 16;

  // Cabecalho (32) + diretorio (4 x 12) + streams + memoria.
  const dirRva = 32;
  let at = dirRva + 4 * 12;
  const sysRva = at;
  at += sysinfo.length;
  const modRva = at;
  at += modules.length;
  const infoRva = at;
  at += memInfo.length;
  const mem64Rva = at;
  const dataRva = mem64Rva + mem64Head;
  const mem64 = Buffer.concat([
    u64(regions.length),
    u64(dataRva),
    ...regions.map((r) => Buffer.concat([u64(r.base), u64(r.data.length)])),
  ]);
  const header = Buffer.concat([
    Buffer.from('MDMP'),
    u32(0xa793),
    u32(4),
    u32(dirRva),
    u32(0),
    u32(0),
    u64(0),
  ]);
  const dir = Buffer.concat([
    u32(7),
    u32(sysinfo.length),
    u32(sysRva),
    u32(4),
    u32(modules.length),
    u32(modRva),
    u32(16),
    u32(memInfo.length),
    u32(infoRva),
    u32(9),
    u32(mem64.length),
    u32(mem64Rva),
  ]);
  return Buffer.concat([
    header,
    dir,
    sysinfo,
    modules,
    memInfo,
    mem64,
    ...regions.map((r) => r.data),
  ]);
}
