"""Gera os .pyc e o PYZ de teste (item 15) com o Python do container (3.9), em /out:

    docker run --rm -v <fixtures/py>:/f:ro -v <saida>:/out python:3.9-slim python /f/gen.py

O PYZ segue o formato do PyInstaller 6: "PYZ\\0", o magic do Python, a posicao do indice (big
endian), os modulos (marshal + zlib) e o indice (marshal de [(nome, (tipo, posicao, tamanho))]).
Leva tambem um modulo com nome da biblioteca padrao, que o servico deixa de fora.
"""
import importlib.util
import marshal
import py_compile
import struct
import zlib

for name in ("ladrao", "varredura", "armado"):
    py_compile.compile(f"/f/{name}.py", cfile=f"/out/{name}.pyc", doraise=True)

modules = [
    ("painel", 0, open("/f/ladrao.py").read()),
    ("painel.varredura", 0, open("/f/varredura.py").read()),
    ("base64", 0, "def b64encode(s):\n    return s\n"),
]
body, toc = b"", []
start = 12
for name, kind, source in modules:
    data = zlib.compress(marshal.dumps(compile(source, f"<{name}>", "exec")))
    toc.append((name, (kind, start + len(body), len(data))))
    body += data
toc_at = start + len(body)
with open("/out/painel.pyz", "wb") as f:
    f.write(b"PYZ\0" + importlib.util.MAGIC_NUMBER + struct.pack(">I", toc_at) + body + marshal.dumps(toc))
