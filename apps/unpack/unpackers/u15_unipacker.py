"""Desempacotar por emulacao (plans/analise-estatica-ampliada, item 17): unipacker 1.0.8 (GPL-2.0).

Emula o stub do empacotador no unicorn ate o salto para o programa original e despeja a memoria com
a tabela de importacao refeita. Cobre ASPack, FSG, MEW, MPRESS, PEtite, PECompact, YZPack e o UPX
disfarcado (sem a marca UPX!, que o `upx -d` recusa). So PE32: o unipacker nao emula 64 bits.

Nada roda no processador: o stub e emulado. Quem decide o empacotador e o Detect It Easy (o
`detect_ident` recebe a saida dele); o `detect` sozinho nao reconhece nada.
"""

import json
import os
import struct
import sys

from common import UnpackError, run

NAME = "unipacker"
LABEL = "unipacker (emulação)"
RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_unipacker.py")
SITE = os.environ.get("UNIPACKER_PATH", "/opt/unipacker")

# Trecho do nome que o DIE da ao empacotador -> chave do run_unipacker.
PACKERS = [
    ("upx", "upx"),
    ("aspack", "aspack"),
    ("fsg", "fsg"),
    ("mew", "mew"),
    ("mpress", "mpress"),
    ("petite", "petite"),
    ("pecompact", "pecompact"),
    ("yzpack", "yzpack"),
]


def is_pe32(data):
    """PE32 de x86 (o unicorn do unipacker so emula 32 bits)."""
    if len(data) < 0x40 or data[:2] != b"MZ":
        return False
    off = struct.unpack_from("<I", data, 0x3C)[0]
    if off + 26 > len(data) or data[off:off + 4] != b"PE\0\0":
        return False
    machine = struct.unpack_from("<H", data, off + 4)[0]
    magic = struct.unpack_from("<H", data, off + 24)[0]
    return machine == 0x14C and magic == 0x10B


def packer_of(detections):
    for d in detections or []:
        if (d.get("type") or "").lower() != "packer":
            continue
        name = (d.get("name") or "").lower().replace(" ", "")
        for needle, key in PACKERS:
            if needle in name:
                return key
    return None


def detect(data):
    return False


def detect_ident(data, detections):
    return is_pe32(data) and packer_of(detections) is not None


def unpack(path, outdir, timeout, detections=None):
    packer = packer_of(detections)
    if packer is None:
        raise UnpackError("o Detect It Easy não apontou um empacotador que o unipacker conheça")
    target = os.path.join(outdir, "desempacotado")
    env = dict(os.environ, UNIPACKER_PATH=SITE)
    code, out = run(
        [sys.executable, RUNNER, path, target, packer, str(max(5, timeout - 10))],
        timeout,
        cwd=outdir,
        env=env,
    )
    result = None
    for line in reversed(out.splitlines()):
        if line.startswith("{"):
            try:
                result = json.loads(line)
            except ValueError:
                pass
            break
    if not result or not result.get("ok"):
        reason = (result or {}).get("error") or f"o unipacker falhou (código {code})"
        raise UnpackError(reason[:300])
    if not os.path.isfile(target):
        raise UnpackError("o unipacker terminou sem gravar o executável")
    return {"files": [("desempacotado", target)], "note": f"{packer.upper()} emulado"}
