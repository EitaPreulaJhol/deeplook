"""PyInstaller (pyinstxtractor, 2026.07): o script de entrada (.pyc) do programa empacotado. Os
modulos da biblioteca padrao (centenas) ficam de fora: so o que o autor escreveu interessa."""

import os
import re

from common import UnpackError, files_under, run

NAME = "pyinstaller"
LABEL = "PyInstaller"
COOKIE = b"MEI\x0c\x0b\x0a\x0b\x0e"
EXTRACTOR = "/opt/pyinstxtractor/pyinstxtractor.py"


def detect(data):
    return COOKIE in data[-(4 << 20):]


def unpack(path, outdir, timeout):
    code, out = run(["python3", EXTRACTOR, path], timeout, cwd=outdir)
    # Os pontos de entrada incluem o bootstrap e os runtime hooks do proprio PyInstaller
    # (pyiboot01_bootstrap, pyi_rth_*): iguais em todo programa, so viram ruido.
    entries = [
        name
        for name in re.findall(r"Possible entry point: (.+)", out)
        if not name.strip().startswith(("pyiboot", "pyi_rth_"))
    ]
    version = re.search(r"Python version: ([\d.]+)", out)
    extracted = os.path.join(outdir, os.path.basename(path) + "_extracted")
    files = []
    for name in entries:
        name = name.strip()
        candidate = os.path.join(extracted, name)
        if os.path.isfile(candidate):
            files.append((name, candidate))
    if not files:
        # Sem ponto de entrada identificado: o que sair na raiz da extracao (sem o PYZ).
        files = [
            (os.path.relpath(p, extracted), p)
            for p in files_under(extracted)
            if os.path.dirname(p) == extracted and p.endswith(".pyc")
        ]
    if code != 0 and not files:
        raise UnpackError("o pyinstxtractor não extraiu o programa")
    note = f"Python {version.group(1)}" if version else None
    return {"files": files, "note": note}
