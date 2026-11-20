"""Analise de um documento com o oletools (item 7.14; revisao de novembro, 3.2).

Roda num processo filho do server.py, com tempo-limite: um documento malicioso pode travar um
parser, e quem cai e este processo, nao o servidor. Le o arquivo do caminho dado e escreve um JSON
na saida padrao. Nada do documento e executado: o oletools so le.

  olevba   macros VBA (codigo, palavras-chave suspeitas, desofuscacao) e macros XLM 4.0
  mraptor  o veredito do MacroRaptor: macro que executa ao abrir E grava ou executa algo
  msodde   campos DDE (executam comandos sem macro)
  oleid    os indicadores do arquivo (cifrado, macros, objetos externos, Flash)
  rtfobj   objetos embutidos num RTF (o Equation Editor do CVE-2017-11882, por exemplo)
"""

import io
import json
import logging
import os
import sys
from contextlib import redirect_stderr, redirect_stdout

# Tetos do que sai: o resultado vai para o banco por amostra.
MAX_CODE_PER_MODULE = 20_000
MAX_CODE_TOTAL = 200_000
MAX_MODULES = 50
MAX_KEYWORDS = 200
MAX_XLM_LINES = 300
MAX_TEXT = 4000

logging.disable(logging.CRITICAL)


def text(value, limit=MAX_TEXT):
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    return str(value)[:limit] if value is not None else None


def run_quiet(fn, *args, **kwargs):
    """O oletools imprime na tela: o que ele imprime nao pode misturar com o JSON."""
    sink = io.StringIO()
    with redirect_stdout(sink), redirect_stderr(sink):
        return fn(*args, **kwargs)


XLM_TIMEOUT = 60


def xlm_resolved(path):
    """XLM 4.0 resolvido (plans/analise-estatica-ampliada, item 21): o XLMMacroDeobfuscator emula as
    formulas a partir do Auto_Open, na ordem de execucao, e devolve cada celula com a formula ja
    resolvida (CHAR, concatenacao, celulas referenciadas). [{cell, status, formula}]."""
    try:
        from XLMMacroDeobfuscator.deobfuscator import process_file

        lines = run_quiet(
            process_file,
            file=path,
            noninteractive=True,
            noindent=True,
            output_formula_format="[[CELL-ADDR]]\t[[STATUS]]\t[[INT-FORMULA]]",
            return_deobfuscated=True,
            timeout=XLM_TIMEOUT,
            silent=True,
        ) or []
    except Exception:  # noqa: BLE001 - formato que o emulador nao abre: fica a lista do olevba
        return []
    out = []
    for line in lines[:MAX_XLM_LINES]:
        parts = [p.strip() for p in str(line).split("\t", 2)]
        if len(parts) == 3:
            out.append({"cell": parts[0][:40], "status": parts[1][:40], "formula": text(parts[2], 400)})
    return out


def has_macrosheet(path):
    import zipfile

    try:
        with zipfile.ZipFile(path) as z:
            return any(n.lower().startswith("xl/macrosheets/") for n in z.namelist())
    except (zipfile.BadZipFile, OSError):
        return False


def vba_report(path, data):
    from oletools import mraptor, olevba

    out = {"macros": False, "xlm": False, "modules": [], "keywords": [], "xlmLines": [],
           "xlmResolved": [], "stomping": False, "mraptor": None, "error": None}
    parser = None
    try:
        parser = run_quiet(olevba.VBA_Parser, path, data=data)
        out["macros"] = bool(run_quiet(parser.detect_vba_macros))
        try:
            out["xlm"] = bool(run_quiet(parser.detect_xlm_macros))
        except Exception:  # noqa: BLE001 - so parte dos formatos tem XLM
            out["xlm"] = False
        # Com os bytes em data=, o olevba nao acha o XLM do OOXML (ele relê pelo caminho): a folha de
        # macro do Excel 4 no ZIP (xl/macrosheets/) basta.
        if not out["xlm"] and has_macrosheet(path):
            out["xlm"] = True
        if out["xlm"]:
            lines = getattr(parser, "xlm_macros", []) or []
            out["xlmLines"] = [text(line, 400) for line in lines[:MAX_XLM_LINES]]
            out["xlmResolved"] = xlm_resolved(path)
        if out["macros"]:
            total = 0
            code_all = []
            for _filename, _stream, vba_filename, code in run_quiet(parser.extract_macros):
                code = text(code, 10_000_000) or ""
                code_all.append(code)
                if len(out["modules"]) >= MAX_MODULES:
                    continue
                shown = code[: max(0, min(MAX_CODE_PER_MODULE, MAX_CODE_TOTAL - total))]
                total += len(shown)
                out["modules"].append({
                    "name": text(vba_filename, 200),
                    "lines": code.count("\n") + 1,
                    "code": shown,
                    "truncated": len(shown) < len(code),
                })
            try:
                out["stomping"] = bool(run_quiet(parser.detect_vba_stomping))
            except Exception:  # noqa: BLE001
                out["stomping"] = False
            raptor = mraptor.MacroRaptor("\n".join(code_all))
            raptor.scan()
            out["mraptor"] = {
                "suspicious": bool(raptor.suspicious),
                "autoexec": bool(raptor.autoexec),
                "write": bool(raptor.write),
                "execute": bool(raptor.execute),
                "flags": text(raptor.get_flags(), 10),
            }
        if out["macros"] or out["xlm"]:
            results = run_quiet(parser.analyze_macros, show_decoded_strings=True, deobfuscate=True) or []
            seen = set()
            for kind, keyword, description in results:
                key = (kind, text(keyword, 300))
                if key in seen:
                    continue
                seen.add(key)
                out["keywords"].append({
                    "type": text(kind, 40),
                    "keyword": text(keyword, 300),
                    "description": text(description, 300),
                })
                if len(out["keywords"]) >= MAX_KEYWORDS:
                    break
    except Exception as exc:  # noqa: BLE001 - falha vira campo legivel
        # RTF nao tem VBA: o olevba recusa o arquivo, e quem o le e o rtfobj (abaixo).
        if not data.lstrip()[:5].startswith(b"{\\rt"):
            out["error"] = text(f"{type(exc).__name__}: {exc}", 300)
    finally:
        if parser is not None:
            try:
                parser.close()
            except Exception:  # noqa: BLE001
                pass
    return out


def dde_report(path):
    from oletools import msodde

    try:
        found = run_quiet(msodde.process_maybe_encrypted, path)
        found = text(found, MAX_TEXT) or ""
        links = [line.strip() for line in found.splitlines() if line.strip()]
        return {"links": links[:50], "error": None}
    except Exception as exc:  # noqa: BLE001
        return {"links": [], "error": text(f"{type(exc).__name__}: {exc}", 300)}


def oleid_report(path):
    from oletools import oleid

    try:
        checker = run_quiet(oleid.OleID, path)
        indicators = run_quiet(checker.check) or []
        return {
            "indicators": [
                {
                    "id": text(i.id, 60),
                    "name": text(i.name, 120),
                    "value": text(i.value, 200),
                    "risk": text(getattr(i, "risk", None), 20),
                    "description": text(getattr(i, "description", None), 300),
                }
                for i in indicators[:40]
            ],
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {"indicators": [], "error": text(f"{type(exc).__name__}: {exc}", 300)}


def rtf_report(data):
    from oletools import rtfobj

    if not data.lstrip()[:5].startswith(b"{\\rt"):
        return None
    try:
        parser = rtfobj.RtfObjParser(data)
        run_quiet(parser.parse)
        objects = []
        for obj in parser.objects[:50]:
            objects.append({
                "ole": bool(obj.is_ole),
                "package": bool(getattr(obj, "is_package", False)),
                "className": text(getattr(obj, "class_name", None), 120),
                "filename": text(getattr(obj, "filename", None), 200),
                "size": int(getattr(obj, "oledata_size", 0) or 0),
            })
        return {"objects": objects, "error": None}
    except Exception as exc:  # noqa: BLE001
        return {"objects": [], "error": text(f"{type(exc).__name__}: {exc}", 300)}


# Senha do Excel que o proprio Office usa sem perguntar (planilha "protegida" so para a estrutura):
# o malware cifra com ela para o filtro nao ler as macros, e o Excel abre sem pedir nada.
VELVET = "VelvetSweatshop"
MAX_DECRYPTED = 32 * 1024 * 1024


def decrypt_report(path, passwords):
    """Office cifrado (item 9): tenta a VelvetSweatshop e as senhas candidatas com o msoffcrypto.
    O documento decifrado volta em Base64 e vira amostra filha na API."""
    import base64
    import io

    import msoffcrypto

    try:
        with open(path, "rb") as f:
            if not msoffcrypto.OfficeFile(f).is_encrypted():
                return None
    except Exception:  # noqa: BLE001 - nao e um Office que o msoffcrypto le
        return None
    for password in [VELVET, *passwords]:
        try:
            with open(path, "rb") as f:
                office = msoffcrypto.OfficeFile(f)
                try:
                    office.load_key(password=password, verify_password=True)
                except TypeError:
                    # Os formatos antigos (.doc, .xls, .ppt) nao tem a opcao; a conferencia e a
                    # assinatura do resultado, abaixo.
                    office.load_key(password=password)
                out = io.BytesIO()
                office.decrypt(out)
            data = out.getvalue()
        except Exception:  # noqa: BLE001 - senha errada ou formato que ele nao decifra
            continue
        # Decifrado de verdade: um ZIP (OOXML) ou um OLE (formato antigo); lixo e senha errada.
        if not data or len(data) > MAX_DECRYPTED:
            continue
        if not (data.startswith(b"PK\x03\x04") or data.startswith(b"\xd0\xcf\x11\xe0")):
            continue
        return {
            "encrypted": True,
            "password": password,
            "size": len(data),
            "data": base64.b64encode(data).decode("ascii"),
        }
    return {"encrypted": True, "password": None, "size": 0, "data": None}


def main():
    path = sys.argv[1]
    passwords = []
    if len(sys.argv) > 2:
        with open(sys.argv[2], encoding="utf-8") as f:
            passwords = [p for p in f.read().split("\n") if p]
    with open(path, "rb") as f:
        data = f.read()
    # O XLMMacroDeobfuscator (que o olevba importa) avisa no stdout, ao carregar, que falta o pywin32:
    # importado aqui, com a saida desviada, o aviso nao se mistura com o JSON.
    run_quiet(__import__, "oletools.olevba")
    run_quiet(__import__, "XLMMacroDeobfuscator.deobfuscator")
    from oletools import olevba

    result = {
        "ok": True,
        "version": getattr(olevba, "__version__", None),
        "vba": vba_report(path, data),
        "dde": dde_report(path),
        "oleid": oleid_report(path),
        "rtf": rtf_report(data),
        "decrypted": decrypt_report(path, passwords),
    }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    os.environ.setdefault("HOME", "/tmp")
    main()
