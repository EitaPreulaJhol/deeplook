"""Executavel com um arquivo compactado dentro (autoextraivel, dropper com ZIP anexado): o 7-Zip
acha o arquivo e o abre. Se o 7-Zip so enxerga o proprio executavel, nao ha o que extrair."""

from common import UnpackError, files_under, is_pe_or_elf, run

NAME = "archive"
LABEL = "Arquivo compactado embutido"
SIGNATURES = (b"PK\x03\x04", b"7z\xbc\xaf\x27\x1c", b"Rar!\x1a\x07", b"MSCF\x00\x00\x00\x00")
# Formatos que o 7-Zip abre e que sao o proprio executavel, nao um arquivo dentro dele.
SELF = {"pe", "elf", "te", "macho"}


def detect(data):
    return is_pe_or_elf(data) and any(data.find(sig, 0x200) >= 0 for sig in SIGNATURES)


def unpack(path, outdir, timeout):
    code, out = run(["7z", "l", "-slt", "-bd", path], timeout)
    kinds = {line.split("=", 1)[1].strip().lower() for line in out.splitlines() if line.startswith("Type = ")}
    if code != 0 or not kinds or kinds <= SELF:
        raise UnpackError("nenhum arquivo compactado que o 7-Zip abra")
    code, _ = run(["7z", "x", "-y", "-bd", "-bso0", "-bsp0", f"-o{outdir}", path], timeout)
    files = [(p[len(outdir) + 1:], p) for p in files_under(outdir)]
    if not files:
        raise UnpackError("o 7-Zip abriu, mas não extraiu nada")
    return {"files": files, "note": ", ".join(sorted(kinds - SELF)) or None}
