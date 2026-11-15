"""capa so no nivel do arquivo (plans/ajustes-usabilidade, item 3).

Quando a analise de funcoes do capa nao termina (tempo ou memoria) num executavel do Windows, o
server.py roda isto: o backend pefile do capa (importacoes, exportacoes, secoes, strings do arquivo)
e as regras de escopo de arquivo, em segundos. O CLI do capa nao aceita o pefile para a busca
completa (tenta extrair funcoes); a biblioteca tem a busca so do arquivo. Sai em JSON o mesmo resumo
do server.py (summarize_capa), com fileOnly = true. Uso: python capa_file.py <amostra>
"""

import json
import os
import re
import sys
from pathlib import Path

import capa.capabilities.common
import capa.rules
from capa.features.common import OS, Arch, Format
from capa.features.extractors.pefile import PefileFeatureExtractor

RULES = os.environ.get("CAPA_RULES", "/opt/capa/rules")
MAX_RULES = 500
TECHNIQUE = re.compile(r"\[(T\d{4}(?:\.\d{3})?)\]")


def main(path):
    rules = capa.rules.get_rules([Path(RULES)])
    extractor = PefileFeatureExtractor(Path(path))
    # O backend pefile so le PE (o server.py so chama isto para executavel do Windows).
    info = {"format": "pe", "arch": None, "os": None}
    for feature, _ in extractor.extract_global_features():
        if isinstance(feature, Format):
            info["format"] = str(feature.value)
        elif isinstance(feature, Arch):
            info["arch"] = str(feature.value)
        elif isinstance(feature, OS):
            info["os"] = str(feature.value)
    found = capa.capabilities.common.find_file_capabilities(rules, extractor, {})
    out = []
    for name, matches in found.matches.items():
        meta = rules[name].meta
        namespace = meta.get("namespace") or ""
        # Regras de biblioteca e internas so servem de base para as outras (como no server.py).
        if meta.get("lib") or namespace.startswith("internal"):
            continue
        out.append(
            {
                "name": str(name)[:200],
                "namespace": namespace[:200],
                "attack": sorted(
                    {m.group(1) for a in meta.get("att&ck") or [] for m in [TECHNIQUE.search(a)] if m}
                ),
                "mbc": sorted({str(m)[:300] for m in meta.get("mbc") or []}),
                "matches": len(matches),
                # No nivel do arquivo nao ha funcao para apontar.
                "addresses": [],
            }
        )
    out.sort(key=lambda r: (r["namespace"], r["name"]))
    json.dump(
        {
            **info,
            "functions": None,
            "libraryFunctions": None,
            "rules": out[:MAX_RULES],
            "truncated": len(out) > MAX_RULES,
            "fileOnly": True,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main(sys.argv[1])
