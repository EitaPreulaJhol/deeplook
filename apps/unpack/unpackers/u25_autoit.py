"""AutoIt (autoit-ripper 1.2.0, MIT; plans/caca-e-formatos, item 5): o script de um executavel
compilado com o Aut2Exe (EA05, AutoIt 3.0/3.1; EA06, 3.2 em diante; JB01, o AutoHotkey antigo) e os
arquivos que ele embute com FileInstall. A extracao roda em subprocesso (autoit_extract.py): o
descompressor do autoit-ripper e Python puro, e o tempo limite tem de poder mata-lo."""

import os
import re
import sys

from common import UnpackError, run

NAME = "autoit"
LABEL = "AutoIt"
# GUID que abre o bloco do script em todas as versoes (EA05, EA06 e JB01).
MAGIC = bytes.fromhex("a3484bbe986c4aa9994c530a86d6487d")
HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "autoit_extract.py")


def detect(data):
    return data[:2] == b"MZ" and MAGIC in data


def unpack(path, outdir, timeout):
    code, out = run([sys.executable, HELPER, path, outdir], timeout)
    files = []
    version = None
    for line in out.splitlines():
        parts = line.split("\t")
        if parts[0] == "ARQUIVO" and len(parts) == 2:
            candidate = os.path.join(outdir, parts[1])
            if os.path.isfile(candidate) and not os.path.islink(candidate):
                files.append((parts[1], candidate))
        elif parts[0] == "VERSAO" and len(parts) == 2:
            version = parts[1]
    if not files:
        reason = re.search(r"^ERRO\t(.+)$", out, re.M)
        raise UnpackError(
            f"o autoit-ripper não extraiu o script ({reason.group(1)[:200]})"
            if reason
            else "o autoit-ripper não extraiu o script (formato não reconhecido ou cifrado de outro jeito)"
        )
    scripts = sum(1 for name, _ in files if name.endswith((".au3", ".ahk")))
    embedded = len(files) - scripts
    # Sem idioma (vai para a ficha nos dois): a versao, os scripts e os arquivos do FileInstall.
    note = f"{version or 'AutoIt'} · {scripts} script(s)"
    if embedded:
        note += f" · {embedded} FileInstall"
    return {"files": files, "note": note}
