"""7z e RAR com senha (plans/analise-estatica-ampliada, item 9): o golpe manda o anexo cifrado para o
filtro de e-mail nao abrir, e a senha vai no corpo da mensagem. A API manda as senhas candidatas
(as citadas no e-mail e as de costume) em ?passwords=; o 7-Zip tenta uma a uma. So age com senhas
candidatas: um 7z ou RAR qualquer nao passa por aqui.
"""

import os
import shutil

from common import UnpackError, files_under, run

NAME = "password-archive"
LABEL = "Arquivo com senha (7z/RAR)"
# O server.py poe aqui as senhas do pedido antes de escolher o desempacotador.
CANDIDATES = []
MAGICS = (b"7z\xbc\xaf\x27\x1c", b"Rar!\x1a\x07")


def detect(data):
    return bool(CANDIDATES) and any(data.startswith(m) for m in MAGICS)


def unpack(path, outdir, timeout):
    for password in CANDIDATES:
        shutil.rmtree(outdir, ignore_errors=True)
        os.makedirs(outdir)
        # -p com a senha; -y responde sim a tudo (sem pedir outra senha no terminal).
        code, _ = run(["7z", "x", "-y", "-bd", "-bso0", "-bsp0", f"-p{password}", f"-o{outdir}", path], timeout)
        files = [(p[len(outdir) + 1:], p) for p in files_under(outdir)]
        if code == 0 and files:
            return {"files": files, "note": f"aberto com a senha \"{password}\""}
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir)
    raise UnpackError(f"nenhuma das {len(CANDIDATES)} senhas candidatas abriu o arquivo")
