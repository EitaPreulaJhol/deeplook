"""Carving e forca bruta de codificacao (plans/analise-estatica-ampliada, item 18).

Roda quando nenhum desempacotador reconheceu a amostra (e no arquivo sem tipo, sozinho):

- binwalk 3.1 (MIT) acha arquivos com assinatura conhecida dentro da amostra (PE, ELF, ZIP, 7z,
  RAR, CAB, PDF; o OLE por conta propria, que o binwalk 3 nao tem): cada um vira filha;
- XOR, ROL e ADD de 1 byte e XOR de 2 a 4 bytes: procura o stub do DOS de um PE, o cabecalho de um
  ZIP e URLs codificados. O PE e o ZIP decodificados viram filhas, com a chave no nome; as URLs vao
  para a lista `decoded` da ficha.

O texto e codificado (nao a amostra): 255 buscas em C por transformacao. A XOR de varios bytes usa
c[i] ^ c[i+n] = p[i] ^ p[i+n], que cancela a chave.
"""

import json
import os
import re
import struct

from common import UnpackError, run

NAME = "carve"
LABEL = "Carving (binwalk) e decodificação"
BINWALK = os.environ.get("BINWALK", "/usr/local/bin/binwalk")
# O que o binwalk acha e vira filha (os outros, como imagens e compressao crua, ficam de fora).
CARVE = {
    "pe": "exe",
    "elf": "elf",
    "zip": "zip",
    "7zip": "7z",
    "rar": "rar",
    "cab": "cab",
    "pdf": "pdf",
}
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
MAX_SCAN = 8 * 1024 * 1024
MAX_CARVED = 16 * 1024 * 1024
MAX_CHILDREN = 20
MAX_DECODED = 50
DOS_STUB = b"This program cannot be run in DOS mode"
URL_RE = re.compile(rb"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{4,300}")


# ------------------------------------------------------------------ transformacoes de 1 byte

def _rol(b, r):
    return ((b << r) | (b >> (8 - r))) & 0xFF


def transforms():
    """(rotulo, tabela de codificacao, tabela de decodificacao) para XOR, ROL e ADD de 1 byte."""
    for k in range(1, 256):
        enc = bytes(b ^ k for b in range(256))
        yield f"xor 0x{k:02x}", enc, enc
    for r in range(1, 8):
        enc = bytes(_rol(b, r) for b in range(256))
        dec = bytes(_rol(b, 8 - r) for b in range(256))
        yield f"rol {r}", enc, dec
    for k in range(1, 256):
        enc = bytes((b + k) & 0xFF for b in range(256))
        dec = bytes((b - k) & 0xFF for b in range(256))
        yield f"add 0x{k:02x}", enc, dec


def xor_multi(data, key, start=0):
    """XOR com a chave de n bytes, alinhada a posicao `start` do arquivo."""
    n = len(key)
    rot = start % n
    k = key[rot:] + key[:rot]
    full = (k * (len(data) // n + 1))[: len(data)]
    return (int.from_bytes(data, "little") ^ int.from_bytes(full, "little")).to_bytes(len(data), "little")


def printable(raw):
    """Bytes que ja sao texto: o XOR 0x20 so troca maiusculas por minusculas, nao esconde nada."""
    return all(32 <= c < 127 for c in raw)


# ------------------------------------------------------------------ tamanho do que achou

def pe_size(buf):
    """Tamanho do PE pelos cabecalhos (fim da ultima secao), ou None se nao for PE."""
    try:
        if buf[:2] != b"MZ":
            return None
        off = struct.unpack_from("<I", buf, 0x3C)[0]
        if off > 0x1000 or buf[off:off + 4] != b"PE\0\0":
            return None
        nsec = struct.unpack_from("<H", buf, off + 6)[0]
        opt = struct.unpack_from("<H", buf, off + 20)[0]
        table = off + 24 + opt
        end = struct.unpack_from("<I", buf, off + 24 + 60)[0]  # SizeOfHeaders
        for i in range(min(nsec, 96)):
            raw_size, raw_ptr = struct.unpack_from("<II", buf, table + 40 * i + 16)
            end = max(end, raw_ptr + raw_size)
        return end if 0 < end <= MAX_CARVED else None
    except struct.error:
        return None


def zip_size(buf):
    """Tamanho do ZIP pelo fim do diretorio central, se o cabecalho local for plausivel."""
    try:
        version, _, _, _, _, _, _, _, name_len = struct.unpack_from("<HHHHHIIIH", buf, 4)
    except struct.error:
        return None
    name = buf[30:30 + name_len]
    if version > 63 or not 0 < name_len <= 255 or not all(32 <= c < 127 for c in name):
        return None
    eocd = buf.find(b"PK\x05\x06", 30)
    if eocd < 0 or eocd + 22 > len(buf):
        return None
    comment = struct.unpack_from("<H", buf, eocd + 20)[0]
    return eocd + 22 + comment


# ------------------------------------------------------------------ binwalk

def binwalk(path, work, timeout):
    log = os.path.join(work, "binwalk.json")
    try:
        run([BINWALK, "-q", "-l", log, path], timeout, cwd=work)
        with open(log, "rb") as f:
            doc = json.load(f)
    except (UnpackError, OSError, ValueError):
        return []
    found = []
    for item in doc if isinstance(doc, list) else [doc]:
        for entry in (item.get("Analysis") or {}).get("file_map") or []:
            name = entry.get("name")
            if name in CARVE:
                found.append((int(entry.get("offset", 0)), int(entry.get("size", 0)), name))
    return found


# ------------------------------------------------------------------ o carving

def carve(path, data, outdir, timeout):
    """Devolve {"files": [(nome, caminho)], "note": str|None, "decoded": [...]}."""
    work = os.path.join(outdir, "..", "carve-work")
    os.makedirs(work, exist_ok=True)
    files, decoded, taken = [], [], []
    methods = set()

    def overlaps(start, end):
        return any(start < e and s < end for s, e in taken)

    def emit(label, kind, offset, blob):
        if len(files) >= MAX_CHILDREN or overlaps(offset, offset + len(blob)) or len(blob) < 64:
            return
        taken.append((offset, offset + len(blob)))
        tag = label.replace(" ", "-") + "_" if label else ""
        name = f"{tag}{kind}_0x{offset:x}.{CARVE.get(kind, kind)}"
        target = os.path.join(outdir, name)
        with open(target, "wb") as f:
            f.write(blob)
        files.append((name, target))
        if label:
            methods.add(label)

    # 1. binwalk (o que esta em claro). A propria amostra (offset 0) nao conta.
    for offset, size, kind in sorted(binwalk(path, work, timeout)):
        if offset == 0:
            continue
        end = len(data) if size <= 0 else min(len(data), offset + size)
        if kind == "pe":
            end = offset + (pe_size(data[offset:offset + MAX_CARVED]) or end - offset)
        emit("", kind, offset, data[offset:min(end, offset + MAX_CARVED)])
    at = data.find(OLE, 1)
    if at > 0:
        emit("", "ole", at, data[at:at + MAX_CARVED])

    # 2. forca bruta de 1 byte.
    scan = data[:MAX_SCAN]
    for label, enc, dec in transforms():
        for needle, kind in ((DOS_STUB, "pe"), (b"PK\x03\x04", "zip"), (b"http://", "url"), (b"https://", "url")):
            i = scan.find(needle.translate(enc))
            hits = 0
            while i >= 0 and hits < 5:
                hits += 1
                if kind == "url":
                    text = scan[i:i + 300].translate(dec)
                    m = URL_RE.match(text)
                    if m and len(m.group(0)) >= 12 and len(decoded) < MAX_DECODED and not printable(scan[i:i + m.end()]):
                        decoded.append({"method": label, "offset": i, "text": m.group(0).decode("ascii", "replace")})
                elif kind == "pe":
                    start = max(0, i - 0x100)
                    head = scan[start:i].translate(dec)
                    mz = head.rfind(b"MZ")
                    if mz >= 0:
                        at = start + mz
                        body = data[at:at + MAX_CARVED].translate(dec)
                        size = pe_size(body)
                        if size:
                            emit(label, "pe", at, body[:size])
                else:
                    body = data[i:i + MAX_CARVED].translate(dec)
                    size = zip_size(body)
                    if size:
                        emit(label, "zip", i, body[:size])
                i = scan.find(needle.translate(enc), i + 1)

    # 3. XOR de 2 a 4 bytes, pelo stub do DOS e pelas URLs.
    for n in (2, 3, 4):
        if len(scan) <= n:
            break
        diff = (int.from_bytes(scan[:-n], "little") ^ int.from_bytes(scan[n:], "little")).to_bytes(len(scan) - n, "little")
        for needle, kind in ((DOS_STUB, "pe"), (b"https://", "url"), (b"http://", "url")):
            want = bytes(a ^ b for a, b in zip(needle[:-n], needle[n:]))
            i = diff.find(want)
            hits = 0
            while i >= 0 and hits < 5:
                hits += 1
                key = bytearray(n)
                for j in range(n):
                    key[(i + j) % n] = scan[i + j] ^ needle[j]
                key = bytes(key)
                # Chave nula e o texto em claro; chave de um byte repetido ja saiu acima.
                if len(set(key)) > 1:
                    label = f"xor 0x{key.hex()}"
                    if kind == "url":
                        text = xor_multi(scan[i:i + 300], key, i)
                        m = URL_RE.match(text)
                        if m and len(m.group(0)) >= 12 and len(decoded) < MAX_DECODED and not printable(scan[i:i + m.end()]):
                            decoded.append({"method": label, "offset": i, "text": m.group(0).decode("ascii", "replace")})
                    else:
                        start = max(0, i - 0x100)
                        head = xor_multi(scan[start:i], key, start)
                        mz = head.rfind(b"MZ")
                        if mz >= 0:
                            at = start + mz
                            body = xor_multi(data[at:at + MAX_CARVED], key, at)
                            size = pe_size(body)
                            if size:
                                emit(label, "pe", at, body[:size])
                i = diff.find(want, i + 1)

    seen, unique = set(), []
    for d in decoded:
        if d["text"] not in seen:
            seen.add(d["text"])
            unique.append(d)
    note = None
    if files:
        note = f"{len(files)} arquivo(s) embutido(s)" + (f"; chave: {', '.join(sorted(methods))}" if methods else "")
    return {"files": files, "note": note, "decoded": unique}
