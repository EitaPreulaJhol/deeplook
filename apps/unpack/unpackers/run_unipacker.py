"""Roda o unipacker (item 17) num processo proprio, com o PYTHONPATH dele (/opt/unipacker):

    python3 run_unipacker.py <amostra> <saida> <empacotador> <segundos>

O empacotador vem do Detect It Easy: o unipacker escolhe o dele pelos nomes das secoes e pelas
regras YARA proprias, e o disfarcado (secoes renomeadas, marca apagada) cai no desempacotador
generico, que despeja no primeiro salto. Aqui o desempacotador e o do empacotador que o DIE viu.
Imprime uma linha JSON: {"ok": true} ou {"ok": false, "error": "..."}.
"""

import json
import os
import site
import sys
import threading
import warnings

warnings.filterwarnings("ignore")


def main():
    src, dst, packer, seconds = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
    # Como pasta de site (nao so PYTHONPATH): o .pth do setuptools poe o distutils de volta.
    site.addsitedir(os.environ.get("UNIPACKER_PATH", "/opt/unipacker"))
    from unipacker import unpackers
    from unipacker.core import Sample, SimpleClient, UnpackerEngine

    classes = {
        "upx": unpackers.UPXUnpacker,
        "aspack": unpackers.ASPackUnpacker,
        "fsg": unpackers.FSGUnpacker,
        "mew": unpackers.MEWUnpacker,
        "mpress": unpackers.MPRESSUnpacker,
        "petite": unpackers.PEtiteUnpacker,
        "pecompact": unpackers.PECompactUnpacker,
        "yzpack": unpackers.YZPackUnpacker,
    }
    try:
        sample = Sample(src, auto_default_unpacker=True)
    except Exception as exc:  # noqa: BLE001 - o motivo vai para a ficha
        print(json.dumps({"ok": False, "error": f"o unipacker não abriu o executável: {exc}"[:200]}))
        return
    sample.unpacker = classes[packer](sample)
    done = threading.Event()
    engine = UnpackerEngine(sample, dst)
    engine.register_client(SimpleClient(done))
    threading.Thread(target=engine.emu, daemon=True).start()
    finished = done.wait(seconds)
    engine.stop()
    if not finished:
        print(json.dumps({"ok": False, "error": f"a emulação não terminou em {int(seconds)} s"}))
        return
    print(json.dumps({"ok": True}))


if __name__ == "__main__":
    main()
