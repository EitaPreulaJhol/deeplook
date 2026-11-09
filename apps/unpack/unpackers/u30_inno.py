"""Inno Setup (innoextract 1.9). O innoextract le o formato ate o Inno Setup 6.2; da 6.3 em diante
ele recusa (medido com os instaladores oficiais 6.0.5, 6.2.2, 6.3.3, 6.4.3, 6.7.4 e 7.1.0)."""

import re

from common import UnpackError, files_under, is_pe_or_elf, run

NAME = "inno"
LABEL = "Inno Setup"
MARKER = re.compile(rb"Inno Setup Setup Data \((\d+(?:\.\d+)+)\)")


def detect(data):
    return is_pe_or_elf(data) and MARKER.search(data) is not None


def unpack(path, outdir, timeout):
    with open(path, "rb") as f:
        found = MARKER.search(f.read())
    version = found.group(1).decode() if found else "?"
    code, out = run(["innoextract", "--silent", "--extract", "--output-dir", outdir, path], timeout)
    files = [(p[len(outdir) + 1:], p) for p in files_under(outdir)]
    if code != 0 and not files:
        major = tuple(int(x) for x in version.split(".")[:2] if x.isdigit())
        if major >= (6, 3):
            raise UnpackError(
                f"formato do Inno Setup {version}: o innoextract 1.9 só lê até o 6.2"
            )
        raise UnpackError(f"o innoextract não extraiu o instalador (formato {version})")
    return {"files": files, "note": f"dados no formato do Inno Setup {version}"}
