"""Configuracao de familias conhecidas com os extratores do CAPE (plans/novas-analises, item 2).

  python config.py <arquivo>

As regras YARA do CAPEv2 (rules/, cada uma com o `cape_type` da familia) e as que alguns extratores
trazem (`rule_source`) dizem que familia e aquela; so o extrator dela roda, com tempo-limite. Nada
da amostra e executado: os extratores so leem os bytes. Escreve no stdout o JSON com as familias
que casaram e as configuracoes extraidas.

O mesmo leitor vale para as regioes de memoria do memdump.py (item 3): `extract_configs(dados)`.
"""

import base64
import hashlib
import json
import logging
import os
import signal
import sys

import yara

HERE = os.path.dirname(os.path.abspath(__file__))
RULES_DIR = os.path.join(HERE, "rules")
PARSER_TIMEOUT_S = int(os.environ.get("EXTRACT_PARSER_TIMEOUT_S", "30"))
MAX_TEXT = 2000
MAX_ITEMS = 200
MAX_DEPTH = 6


def text(value, limit=MAX_TEXT):
    if value is None:
        return None
    return str(value).replace("\x00", "")[:limit]


def plain(value, depth=0):
    """O que o extrator devolveu -> JSON (bytes como texto, ou Base64 se nao for texto), com tetos."""
    if depth > MAX_DEPTH:
        return text(repr(value), 200)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return text(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            decoded = raw.decode("utf-8")
            if decoded.isprintable():
                return text(decoded)
        except UnicodeDecodeError:
            pass
        return {"base64": base64.b64encode(raw[:4096]).decode(), "size": len(raw)}
    if isinstance(value, dict):
        return {text(k, 200): plain(v, depth + 1) for k, v in list(value.items())[:MAX_ITEMS]}
    if isinstance(value, (list, tuple, set)):
        return [plain(v, depth + 1) for v in list(value)[:MAX_ITEMS]]
    return text(repr(value), 500)


_parsers = None
_rules = None
_rule_family = {}


def family_of(cape_type):
    """'Remcos Payload' -> 'Remcos' (como o CAPE escolhe o extrator)."""
    for suffix in (" Payload", " Config", " Loader"):
        if cape_type.endswith(suffix):
            return cape_type[: -len(suffix)]
    return cape_type


def load():
    """Os extratores (core e community do CAPE) e as regras, compiladas uma vez."""
    global _parsers, _rules
    if _parsers is not None:
        return _parsers, _rules
    logging.disable(logging.CRITICAL)
    from cape_parsers import load_cape_parsers

    # Extrator que nao importa vai para o stderr do proprio CAPE-parsers (print): o stdout e o JSON.
    stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        _parsers = load_cape_parsers(load="all")
    finally:
        sys.stdout = stdout
    sources = {}
    for name in sorted(os.listdir(RULES_DIR)):
        if name.endswith(".yar"):
            with open(os.path.join(RULES_DIR, name), encoding="utf-8", errors="replace") as f:
                sources[f"cape_{name[:-4]}"] = f.read()
    # Regras que os proprios extratores trazem (rule_source), quando o CAPEv2 nao tem a da familia.
    for family, module in _parsers.items():
        rule = getattr(module, "rule_source", None)
        if isinstance(rule, str) and f"cape_{family.replace(' ', '_')}" not in sources:
            sources[f"parser_{family.replace(' ', '_')}"] = rule
    compiled = {}
    for ns, src in sources.items():
        try:
            yara.compile(source=src)
            compiled[ns] = src
        except yara.Error as exc:
            print(f"regra {ns} não compila: {exc}", file=sys.stderr)
    _rules = yara.compile(sources=compiled)
    for ns in compiled:
        if ns.startswith("parser_"):
            _rule_family[ns] = ns[len("parser_") :].replace("_", " ")
    return _parsers, _rules


class ParserTimeout(Exception):
    pass


def _alarm(_signum, _frame):
    raise ParserTimeout()


def run_parser(module, data):
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(PARSER_TIMEOUT_S)
    stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        return module.extract_config(data)
    finally:
        signal.alarm(0)
        sys.stdout = stdout


def extract_configs(data):
    """As familias que as regras reconhecem nos bytes e a configuracao de cada uma."""
    parsers, rules = load()
    matches = []
    families = []
    for m in rules.match(data=data, timeout=60):
        cape_type = (m.meta or {}).get("cape_type")
        family = family_of(cape_type) if cape_type else _rule_family.get(m.namespace)
        matches.append({"rule": text(m.rule, 200), "family": text(family, 200)})
        if family and family not in families:
            families.append(family)
    configs = []
    errors = []
    for family in families:
        module = parsers.get(family)
        if module is None or not hasattr(module, "extract_config"):
            continue
        try:
            config = run_parser(module, data)
        except ParserTimeout:
            errors.append({"family": family, "error": f"tempo esgotado ({PARSER_TIMEOUT_S} s)"})
            continue
        except Exception as exc:  # noqa: BLE001 - extrator que quebra nao derruba os outros
            errors.append({"family": family, "error": text(f"{type(exc).__name__}: {exc}", 300)})
            continue
        if config:
            configs.append({"family": family, "config": plain(config)})
    return {"matches": matches[:MAX_ITEMS], "configs": configs, "errors": errors}


def parser_count():
    parsers, _ = load()
    return len(parsers)


def main():
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    out = {"ok": True, "sha256": hashlib.sha256(data).hexdigest(), **extract_configs(data)}
    out["parsers"] = parser_count()
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
