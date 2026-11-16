"""Dump de memoria de um processo do sandbox (plans/novas-analises, item 3).

  python memdump.py <arquivo>      (minidump, cru ou com gzip)

Le o minidump (MiniDumpWriteDump com a memoria inteira e as informacoes das regioes) e procura o
que o malfind do Volatility procura, no dump de um processo so:

  - memoria privada executavel (codigo que nao veio de um arquivo do disco);
  - PE dentro dela (desempacotado ou injetado): recortado e realinhado para o formato de arquivo
    (cada secao com o tamanho e o deslocamento da memoria), para virar amostra filha;
  - trechos executaveis sem cabecalho, com a entropia e os primeiros bytes (shellcode).

Em cada regiao suspeita rodam as regras YARA do CAPE e o extrator da familia (config.py). Tambem
sai a lista de URLs da memoria privada. Nada e executado.
"""

import base64
import gzip
import hashlib
import json
import math
import os
import re
import struct
import sys
import tempfile

from config import extract_configs, load

MAX_INPUT = int(os.environ.get("EXTRACT_MEMDUMP_MAX_MB", "512")) * 1024 * 1024
MAX_REGION = 64 * 1024 * 1024
MAX_REGIONS = 200
MAX_CARVED = 20
MAX_CARVED_BYTES = 48 * 1024 * 1024
MAX_URLS = 300
MEM_COMMIT = 0x1000
MEM_PRIVATE = 0x20000
MEM_IMAGE = 0x1000000
EXECUTE = {0x10: "X", 0x20: "RX", 0x40: "RWX", 0x80: "WCX"}
URL_RE = re.compile(rb"https?://[\x21-\x7e]{4,300}")
WURL_RE = re.compile(rb"h\x00t\x00t\x00p\x00s?\x00:\x00/\x00/\x00(?:[\x21-\x7e]\x00){4,300}")


def num(value):
    """Os campos do minidump podem vir como enum ou como numero."""
    if value is None:
        return 0
    if hasattr(value, "value"):
        return int(value.value)
    return int(value)


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return round(-sum(c / n * math.log2(c / n) for c in counts if c), 2)


def realign(data):
    """PE mapeado em memoria -> formato de arquivo: cada secao fica onde a memoria a tem."""
    try:
        e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
        if data[e_lfanew : e_lfanew + 4] != b"PE\0\0":
            return None
        sections = struct.unpack_from("<H", data, e_lfanew + 6)[0]
        opt_size = struct.unpack_from("<H", data, e_lfanew + 20)[0]
        table = e_lfanew + 24 + opt_size
        out = bytearray(data)
        end = 0
        for i in range(min(sections, 96)):
            off = table + i * 40
            vsize, va = struct.unpack_from("<II", out, off + 8)
            size = max(vsize, struct.unpack_from("<I", out, off + 16)[0])
            # SizeOfRawData e PointerToRawData = o que a memoria tem.
            struct.pack_into("<II", out, off + 16, size, va)
            end = max(end, va + size)
        return bytes(out[: max(end, 0x400)])
    except struct.error:
        return None


def pe_offset(data):
    """Onde comeca um PE na regiao: no inicio (MZ) ou com o MZ apagado (so o "PE\\0\\0")."""
    if data[:2] == b"MZ":
        return 0
    # Cabecalho DOS apagado (tecnica comum): procura o PE\0\0 nos primeiros 4 KB, com um e_lfanew
    # plausivel no inicio.
    head = data[:4096]
    pos = head.find(b"PE\0\0")
    if 0x40 <= pos < 0x400 and struct.unpack_from("<I", data, 0x3C)[0] == pos:
        return 0
    return None


def main():
    path = sys.argv[1]
    with open(path, "rb") as f:
        magic = f.read(2)
    work = path
    if magic == b"\x1f\x8b":
        fd, work = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".dmp")
        total = 0
        with gzip.open(path, "rb") as src, os.fdopen(fd, "wb") as dst:
            while True:
                chunk = src.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_INPUT:
                    print(json.dumps({"ok": False, "error": f"dump acima de {MAX_INPUT // (1 << 20)} MB"}))
                    return
                dst.write(chunk)
        os.remove(path)

    from minidump.minidumpfile import MinidumpFile

    try:
        mf = MinidumpFile.parse(work)
    except Exception as exc:  # noqa: BLE001 - nao e minidump
        print(json.dumps({"ok": False, "error": f"não é um minidump legível: {str(exc)[:200]}"}))
        return

    segments = []
    if mf.memory_segments_64:
        for s in mf.memory_segments_64.memory_segments:
            segments.append((s.start_virtual_address, s.size, s.start_file_address))
    elif mf.memory_segments:
        for s in mf.memory_segments.memory_segments:
            segments.append((s.start_virtual_address, s.size, s.start_file_address))
    segments.sort()
    fh = open(work, "rb")

    def read(addr, size):
        """Os bytes de [addr, addr+size) que o dump tem (zeros onde nao tem)."""
        out = bytearray(size)
        for start, length, foff in segments:
            if start + length <= addr or start >= addr + size:
                continue
            lo = max(addr, start)
            hi = min(addr + size, start + length)
            fh.seek(foff + (lo - start))
            out[lo - addr : hi - addr] = fh.read(hi - lo)
        return bytes(out)

    modules = []
    if mf.modules:
        for m in mf.modules.modules:
            modules.append({"name": str(m.name)[:300], "base": m.baseaddress, "size": m.size})

    load()  # regras e extratores, uma vez
    regions = []
    carved = []
    carved_bytes = 0
    urls = []
    seen_urls = set()
    infos = mf.memory_info.infos if mf.memory_info else []
    private_exec = 0
    scanned = 0
    for info in infos:
        state = num(info.State)
        mtype = num(info.Type)
        protect = num(info.Protect) & 0xFF
        if state != MEM_COMMIT:
            continue
        base = num(info.BaseAddress)
        size = num(info.RegionSize)
        if mtype == MEM_PRIVATE and size <= MAX_REGION:
            data = read(base, size)
            scanned += 1
            for rx, wide in ((URL_RE, False), (WURL_RE, True)):
                for m in rx.findall(data):
                    url = (m.decode("utf-16-le", "replace") if wide else m.decode("latin1")).rstrip(".,;\"'")
                    if url not in seen_urls and len(urls) < MAX_URLS:
                        seen_urls.add(url)
                        urls.append(url)
        if mtype != MEM_PRIVATE or protect not in EXECUTE:
            continue
        private_exec += 1
        if len(regions) >= MAX_REGIONS or size > MAX_REGION:
            continue
        data = read(base, size)
        if not data.strip(b"\0"):
            continue
        at = pe_offset(data)
        kind = "pe" if at is not None else "code"
        item = {
            "base": hex(base),
            "size": size,
            "protect": EXECUTE[protect],
            "allocationProtect": EXECUTE.get(num(info.AllocationProtect) & 0xFF, hex(num(info.AllocationProtect))),
            "kind": kind,
            "entropy": entropy(data[:65536]),
            "head": data[:32].hex(),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        found = extract_configs(data)
        if found["matches"] or found["configs"] or found["errors"]:
            item.update(found)
        if kind == "pe":
            pe = realign(data[at:])
            if pe and len(carved) < MAX_CARVED and carved_bytes + len(pe) <= MAX_CARVED_BYTES:
                carved_bytes += len(pe)
                sha = hashlib.sha256(pe).hexdigest()
                item["carved"] = sha
                carved.append({"base": hex(base), "sha256": sha, "size": len(pe), "data": base64.b64encode(pe).decode()})
        regions.append(item)
    fh.close()

    arch = None
    if mf.sysinfo is not None:
        arch = str(getattr(mf.sysinfo, "ProcessorArchitecture", "") or "")[:40] or None
    out = {
        "ok": True,
        "arch": arch,
        "modules": len(modules),
        "mainModule": modules[0]["name"] if modules else None,
        "regionsTotal": len(infos),
        "privateScanned": scanned,
        "privateExecutable": private_exec,
        "regions": regions,
        "carved": carved,
        "urls": urls,
    }
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
