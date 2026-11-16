"""Extrai o script AutoIt de um executavel (chamado pelo u25_autoit.py, em subprocesso).

Uso: autoit_extract.py <amostra> <pasta de saida>. Escreve na saida uma linha por arquivo
("ARQUIVO\\t<nome>"), a versao do formato ("VERSAO\\t<EA05|EA06|JB01>") ou o erro ("ERRO\\t<motivo>").
"""

import logging
import os
import re
import sys

logging.disable(logging.CRITICAL)

from autoit_ripper import autoit_unpack  # noqa: E402 - depois de calar o log da biblioteca


def safe(name, used):
    """Nome de arquivo sem pasta: o do FileInstall e o caminho na maquina de quem compilou."""
    base = re.split(r"[\\/]", name)[-1].strip() or "embutido"
    base = re.sub(r"[^\w.\- ]", "_", base)[:120].lstrip(".") or "embutido"
    stem, ext = os.path.splitext(base)
    candidate, n = base, 1
    while candidate.lower() in used:
        n += 1
        candidate = f"{stem}-{n}{ext}"
    used.add(candidate.lower())
    return candidate


def main():
    sample, outdir = sys.argv[1], sys.argv[2]
    with open(sample, "rb") as f:
        data = f.read()
    for version, fn in (
        ("EA06", autoit_unpack.unpack_ea06),
        ("EA05", autoit_unpack.unpack_ea05),
        ("JB01", autoit_unpack.unpack_jb01),
    ):
        try:
            items = fn(data)
        except Exception as exc:  # o autoit-ripper levanta Exception generica nos opcodes
            print(f"ERRO\t{version}: {type(exc).__name__}: {exc}"[:300], flush=True)
            continue
        if not items:
            continue
        # O cabecalho EA05 tambem pode trazer o EA06 (o autoit-ripper aceita os dois ali).
        print(f"VERSAO\t{version}", flush=True)
        used = set()
        for name, content in items:
            label = safe(name, used)
            with open(os.path.join(outdir, label), "wb") as out:
                out.write(content)
            print(f"ARQUIVO\t{label}", flush=True)
        return


if __name__ == "__main__":
    main()
