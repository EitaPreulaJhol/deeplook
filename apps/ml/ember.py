"""Pontuacao do EMBER2024 (plans/analise-estatica-ampliada, item 29): POST /ember.

Le o PE (argv[1]), tira os 2568 atributos do EMBER v3 com o features.py do thrember (pefile, sem o
LIEF) e da a probabilidade de ser malicioso pelo modelo LightGBM de PE do benchmark do EMBER2024.
Sinal fraco e informativo: a DeepLook nao o usa no risco. Roda no ambiente /opt/ember.
"""

import glob
import importlib.util
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

MODELS = os.environ.get("EMBER_MODELS", "/opt/ember-models")
MODEL = "EMBER2024_PE"


def features_module():
    """So o features.py: o __init__ do thrember puxa as dependencias de treino (polars, tqdm...)."""
    path = glob.glob("/opt/ember/lib/python*/site-packages/thrember/features.py")[0]
    spec = importlib.util.spec_from_file_location("ember_features", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    if data[:2] != b"MZ":
        print(json.dumps({"ok": False, "error": "o modelo do EMBER2024 daqui é só de PE"}))
        return
    import lightgbm
    import numpy

    vector = numpy.array(features_module().PEFeatureExtractor().feature_vector(data), dtype=numpy.float32)
    booster = lightgbm.Booster(model_file=os.path.join(MODELS, f"{MODEL}.model"))
    score = float(booster.predict([vector])[0])
    print(json.dumps({"ok": True, "model": MODEL, "score": round(score, 4), "features": int(vector.size)}))


if __name__ == "__main__":
    main()
