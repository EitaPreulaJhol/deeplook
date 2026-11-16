"""CAB solto (plans/caca-e-formatos, item 4): a midia que sai de um MSI, ou um CAB enviado direto. O
7-Zip abre MSZIP, Quantum e LZX; os arquivos de dentro viram amostras filhas."""

from common import UnpackError, files_under, run

NAME = "cab"
LABEL = "CAB"


def detect(data):
    return data[:8] == b"MSCF\x00\x00\x00\x00"


def unpack(path, outdir, timeout):
    code, _ = run(["7z", "x", "-y", "-bd", "-bso0", "-bsp0", "-tcab", f"-o{outdir}", path], timeout)
    files = [(p[len(outdir) + 1:], p) for p in files_under(outdir)]
    if not files:
        raise UnpackError("o 7-Zip não abriu o CAB" if code != 0 else "CAB vazio")
    return {"files": files, "note": None}
