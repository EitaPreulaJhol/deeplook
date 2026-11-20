"""Ordena strings com o StringSifter (plans/analise-estatica-ampliada, item 26): POST /rank.

Le um JSON com a lista de strings (argv[1]) e escreve {ok, scores}: uma nota por string, na mesma
ordem. Quanto maior, mais util para o analista (URL, caminho de PDB, comando, chave de registro);
lixo de compilador e bytes que parecem texto ficam embaixo. Roda no ambiente /opt/sifter.
"""

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

MAX_STRINGS = 20000
MAX_LEN = 400


def main():
    import joblib
    import numpy
    from stringsifter.lib import util

    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        items = json.load(f)
    if not isinstance(items, list):
        print(json.dumps({"ok": False, "error": "esperava uma lista de strings"}))
        return
    strings = [str(s).replace("\n", " ").replace("\r", " ")[:MAX_LEN] for s in items[:MAX_STRINGS]]
    if not strings:
        print(json.dumps({"ok": True, "scores": []}))
        return
    model = os.path.join(util.package_base(), "model")
    featurizer = joblib.load(os.path.join(model, "featurizer.pkl"))
    ranker = joblib.load(os.path.join(model, "ranker.pkl"))
    scores = ranker.predict(featurizer.transform(numpy.array(strings, dtype=object)))
    print(json.dumps({"ok": True, "scores": [round(float(s), 3) for s in scores]}))


if __name__ == "__main__":
    main()
