"""Descompila bytecode Python (plans/analise-estatica-ampliada, item 15): um .pyc solto ou um PYZ do
PyInstaller (os modulos do programa, sem a biblioteca padrao). Escreve um JSON no stdout no formato
dos servicos de descompilacao (.NET e Java): o modulo, os arquivos, as fontes e os ofuscadores.

- pycdc descompila; quando ele para no meio (opcode que nao conhece, comum do 3.11 em diante), o
  fonte parcial vem junto com o disassembly do pycdas (<modulo>.pycdas.txt);
- PyArmor e reconhecido e dito: o bytecode real esta cifrado e nao descompila.
Nada e executado: o pycdc e o pycdas so leem o bytecode.
"""

import json
import marshal
import os
import re
import struct
import subprocess
import sys
import zlib

PYCDC = os.environ.get("PYCDC", "/opt/pycdc/pycdc")
PYCDAS = os.environ.get("PYCDAS", "/opt/pycdc/pycdas")
MAX_MODULES = int(os.environ.get("PYDEC_MAX_MODULES", "150"))
MAX_SOURCE = 512 * 1024
MAX_TOTAL = 16 * 1024 * 1024
PER_MODULE_S = int(os.environ.get("PYDEC_MODULE_S", "20"))
URL_RE = re.compile(r"\bhttps?://[^\s\"'<>\\)]{4,300}")
ARMOR = re.compile(rb"__pyarmor__|pyarmor_runtime|pytransform|PY[0-9]{6}\x00", re.I)

# O "magic" de cada versao do CPython (os dois primeiros bytes, little endian) -> versao.
MAGICS = [
    (3550, "3.13"), (3495, "3.12"), (3450, "3.11"), (3430, "3.10"), (3400, "3.9"), (3394, "3.8"),
    (3379, "3.7"), (3360, "3.6"), (3320, "3.5"), (3250, "3.4"), (3190, "3.3"), (3000, "3.0"),
]


def version_of(magic):
    word = struct.unpack("<H", magic[:2])[0]
    if word >= 62000:
        return "2.7"
    for start, name in MAGICS:
        if word >= start:
            return name
    return None


def header_size(magic):
    """Cabecalho do .pyc: 16 bytes do 3.7 em diante, 12 do 3.3 ao 3.6, 8 antes."""
    word = struct.unpack("<H", magic[:2])[0]
    if word >= 62000:
        return 8
    return 16 if word >= 3390 else 12 if word >= 3190 else 8


def run(cmd, timeout):
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return None, "tempo esgotado"
    return p.returncode, p.stdout.decode("utf-8", "replace") + "\n\x00" + p.stderr.decode("utf-8", "replace")


def decompile(pyc, name):
    """(fonte, status, disassembly ou None). status: ok | partial | failed."""
    code, out = run([PYCDC, pyc], PER_MODULE_S)
    source, _, err = (out or "").partition("\n\x00")
    incomplete = "WARNING: Decompyle incomplete" in source or bool(err.strip()) or code != 0
    status = "ok" if source.strip() and not incomplete else "partial" if source.strip() else "failed"
    dis = None
    if status != "ok":
        _, dout = run([PYCDAS, pyc], PER_MODULE_S)
        dis = (dout or "").partition("\n\x00")[0][:MAX_SOURCE] or None
        if err.strip():
            source = f"# pycdc: {err.strip().splitlines()[0][:200]}\n{source}"
    return source[:MAX_SOURCE], status, dis


def stdlib(name):
    top = name.split(".", 1)[0]
    return top in sys.stdlib_module_names or top.startswith(("_pyi", "pyimod", "pyi_", "_bootlocale"))


def pyz_modules(data, work):
    """Os modulos do PYZ como .pyc (o cabecalho refeito com o magic do PYZ)."""
    magic = data[4:8]
    toc_at = struct.unpack(">I", data[8:12])[0]
    toc = marshal.loads(data[toc_at:])
    if isinstance(toc, dict):
        toc = list(toc.items())
    header = magic + b"\x00" * (header_size(magic) - 4)
    found, encrypted = [], 0
    for name, info in toc:
        name = name.decode() if isinstance(name, bytes) else str(name)
        kind, pos, length = (info if len(info) == 3 else (0, *info[-2:]))
        if stdlib(name):
            continue
        try:
            body = zlib.decompress(data[pos:pos + length])
        except zlib.error:
            encrypted += 1
            continue
        path = os.path.join(work, f"m{len(found):04d}.pyc")
        with open(path, "wb") as f:
            f.write(header + body)
        rel = name.replace(".", "/") + ("/__init__.py" if kind == 1 else ".py")
        found.append((rel, path, body))
    return magic, found, encrypted


def main():
    sample = sys.argv[1]
    work = os.path.dirname(os.path.abspath(sample))
    with open(sample, "rb") as f:
        data = f.read()
    if data[:4] == b"PYZ\x00":
        kind = "pyz"
        try:
            magic, modules, encrypted = pyz_modules(data, work)
        except Exception as exc:  # noqa: BLE001 - PYZ corrompido ou de formato que nao conhece
            print(json.dumps({"ok": False, "error": f"PYZ ilegível: {str(exc)[:200]}"}))
            return
    elif len(data) >= 16 and data[2:4] == b"\r\n" and version_of(data[:4]):
        kind, magic, encrypted = "pyc", data[:4], 0
        modules = [(os.path.basename(sys.argv[2]) if len(sys.argv) > 2 else "modulo.py", sample, data)]
    else:
        print(json.dumps({"ok": False, "error": "não é um .pyc nem um PYZ do PyInstaller"}))
        return
    version = version_of(magic)
    sources, types, obfuscators, urls = {}, [], [], set()
    failed = 0
    total = 0
    truncated = len(modules) > MAX_MODULES
    for rel, path, raw in modules[:MAX_MODULES]:
        if ARMOR.search(raw) and "PyArmor" not in obfuscators:
            obfuscators.append("PyArmor")
        source, status, dis = decompile(path, rel)
        if status != "ok":
            failed += 1
        if total + len(source) > MAX_TOTAL:
            truncated = True
            break
        total += len(source)
        sources[rel] = source
        types.append({"path": rel, "size": len(source), "lines": source.count("\n") + 1})
        if dis:
            sources[rel + ".pycdas.txt"] = dis
            types.append({"path": rel + ".pycdas.txt", "size": len(dis), "lines": dis.count("\n") + 1})
        urls.update(URL_RE.findall(source))
        if dis:
            urls.update(URL_RE.findall(dis))
    if encrypted and "PyInstaller (PYZ cifrado)" not in obfuscators:
        obfuscators.append("PyInstaller (PYZ cifrado)")
    print(json.dumps({
        "ok": True,
        "module": {
            "kind": kind,
            "pythonVersion": version,
            "modules": len(modules),
            "encrypted": encrypted,
        },
        "types": types,
        "findings": [],
        "obfuscators": obfuscators,
        "resources": [],
        "urls": sorted(urls)[:200],
        "sources": sources,
        "failed": failed,
        "truncated": truncated,
    }))


if __name__ == "__main__":
    main()
