"""UPX (upx -d). Precisa da marca UPX! que o empacotador grava: sem ela (o disfarce mais comum),
o proprio upx recusa, e a ficha diz por que."""

import os

from common import UnpackError, is_pe_or_elf, run

NAME = "upx"
LABEL = "UPX"


def detect(data):
    head = data[:0x2000]
    return is_pe_or_elf(data) and (b"UPX!" in head or b"UPX0\x00" in head)


def unpack(path, outdir, timeout):
    target = os.path.join(outdir, "desempacotado")
    code, out = run(["upx", "-d", "-q", "-o", target, path], timeout)
    if code != 0 or not os.path.exists(target):
        last = [line for line in out.splitlines() if line.strip()][-1:] or ["sem detalhe"]
        raise UnpackError(f"o upx não desempacotou: {last[0].strip()[:200]}")
    return {"files": [("desempacotado", target)], "note": None}
