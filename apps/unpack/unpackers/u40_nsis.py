"""NSIS (7-Zip): os arquivos do instalador e o script ([NSIS].nsi) que o 7-Zip reconstroi, que
mostra o que o instalador faz (onde grava, o que executa)."""

from common import UnpackError, files_under, is_pe_or_elf, run

NAME = "nsis"
LABEL = "NSIS"


def detect(data):
    return is_pe_or_elf(data) and b"NullsoftInst" in data


def unpack(path, outdir, timeout):
    code, _ = run(["7z", "x", "-y", "-bd", "-bso0", "-bsp0", f"-o{outdir}", path], timeout)
    files = [(p[len(outdir) + 1:], p) for p in files_under(outdir)]
    if code != 0 and not files:
        raise UnpackError("o 7-Zip não abriu o instalador NSIS")
    return {"files": files, "note": None}
