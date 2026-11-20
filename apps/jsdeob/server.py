"""Desofuscacao de JavaScript com o webcrack (plans/analise-estatica-ampliada, item 20), num
container sem rede. Recebe POST /deobfuscate (corpo = o JavaScript, ou um HTML/HTA com scripts
embutidos, com o token da API) e devolve o codigo desofuscado e, se for um bundle do webpack ou do
browserify, os modulos. O webcrack roda num processo Node filho com tempo-limite (deob.mjs); os
decodificadores de strings da amostra rodam num isolate do V8 (isolated-vm), nunca no Node.

Mesmo esqueleto do apps/oletools/server.py (token, recusa lendo o corpo, /health com o estado, um
container por trabalho), igual nos servicos emulate, android, extract, dotnet e jar: mudou um,
confira os outros. So o bloco de configuracao abaixo muda de um para outro.
"""

import hmac
import json
import os
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ------------------------------------------------------------------ configuracao do servico

NAME = "jsdeob"
PREFIX = "JSDEOB"
DEFAULT_PORT = 4100
HERE = os.path.dirname(os.path.abspath(__file__))
# Rota -> script (cada um le o arquivo do argv[1] e escreve o JSON no stdout).
SCRIPTS = {"/deobfuscate": os.path.join(HERE, "deob.mjs")}
# Parametros de query aceitos, com o valor permitido; vao para o script como --nome valor.
PARAMS: dict[str, re.Pattern] = {}
NODE = os.environ.get("NODE", "/usr/local/bin/node")
# O isolated-vm pede o Node sem o snapshot de inicializacao.
NODE_ARGS = ["--no-node-snapshot", "--max-old-space-size=1536"]


def tool_version():
    try:
        with open(os.path.join(HERE, "node_modules", "webcrack", "package.json"), encoding="utf-8") as f:
            return f"webcrack {json.load(f)['version']}"
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


# ------------------------------------------------------------------ esqueleto comum


# ---- Cancelamento pelo Monitoramento (plans/monitoramento, item 4): quando a API desiste do pedido
# (fecha a conexao), a ferramenta morre junto, em vez de seguir ate o tempo-limite.
_request = threading.local()


class Cancelled(Exception):
    """A API fechou a conexao antes da resposta (trabalho cancelado no Monitoramento)."""


def client_gone():
    """A conexao do pedido em andamento fechou (fim de arquivo ou erro ao espiar o socket)."""
    sock = getattr(_request, "sock", None)
    if sock is None:
        return False
    try:
        readable, _, _ = select.select([sock], [], [], 0)
        return bool(readable) and sock.recv(1, socket.MSG_PEEK) == b""
    except OSError:
        return True


def run_watched(cmd, timeout, **popen):
    """subprocess.run com a saida capturada e tempo-limite, num grupo de processos proprio, que
    tambem para (e mata o grupo inteiro) quando a API fecha a conexao."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, **popen
    )
    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = proc.communicate(timeout=max(0.05, min(1.0, deadline - time.monotonic())))
            return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            gone = client_gone()
            if not gone and time.monotonic() < deadline:
                continue
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            if gone:
                raise Cancelled() from None
            raise subprocess.TimeoutExpired(cmd, timeout) from None


def secret(name):
    """Segredo do ambiente ou, com NOME_FILE, do arquivo (Docker secrets; plano pos-revisao 5.1)."""
    path = os.environ.get(f"{name}_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read().rstrip("\r\n")
    return os.environ.get(name, "")


PORT = int(os.environ.get("PORT", str(DEFAULT_PORT)))
TOKEN = secret(f"{PREFIX}_TOKEN")
RECYCLE = os.environ.get(f"{PREFIX}_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get(f"{PREFIX}_MAX_MB", "32")) * 1024 * 1024
TIMEOUT = int(os.environ.get(f"{PREFIX}_TIMEOUT_S", "180"))
MIN_UPTIME_S = 10.5

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[{NAME}] {msg}", file=sys.stderr, flush=True)


VERSION = tool_version()


def analyze(data, work, script, args):
    """Roda o script num processo filho, com o tempo-limite; devolve o JSON."""
    sample = os.path.join(work, "amostra")
    with open(sample, "wb") as f:
        f.write(data)
    started = time.monotonic()
    try:
        proc = run_watched(
            [NODE, *NODE_ARGS, script, sample, *args],
            TIMEOUT,
            cwd=work,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"tempo esgotado ({TIMEOUT} s)", "version": VERSION}
    ms = int((time.monotonic() - started) * 1000)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["sem detalhes"]
        return {"ok": False, "error": f"a análise falhou: {tail[0][:200]}", "version": VERSION, "ms": ms}
    try:
        result = json.loads(proc.stdout)
    except ValueError:
        return {"ok": False, "error": "a análise não respondeu em JSON", "version": VERSION, "ms": ms}
    result["ms"] = ms
    result.setdefault("version", VERSION)
    return result


def retire(server):
    """Sai depois de responder (ver apps/capa/server.py): primeiro para de aceitar conexoes."""
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


def query_args(query):
    """Os parametros conhecidos da query, conferidos; None se algum for invalido."""
    args = []
    for part in filter(None, query.split("&")):
        key, _, value = part.partition("=")
        rule = PARAMS.get(key)
        if rule is None or not rule.match(value):
            return None
        args += [f"--{key}", value]
    return args


class Handler(BaseHTTPRequestHandler):
    server_version = f"deeplook-{NAME}"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def send(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            state = "trocando" if _retiring.is_set() else "analisando" if _busy.locked() else "livre"
            self.send(200, {"ok": True, "state": state, "version": VERSION})
        else:
            self.send(404, {"error": "não encontrado"})

    def refuse(self, status, error, length, limit=MAX_BYTES):
        """Recusa lendo o corpo antes (senao o TCP manda RST e a API ve a conexao cair)."""
        if 0 < length <= limit:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                remaining -= len(chunk)
        else:
            self.close_connection = True
        self.send(status, {"error": error})

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", "-1"))
        except ValueError:
            length = -1
        path, _, query = self.path.partition("?")
        script = SCRIPTS.get(path)
        if script is None:
            self.refuse(404, "não encontrado", length)
            return
        auth = self.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
            self.refuse(401, "token inválido", length)
            return
        args = query_args(query)
        if args is None:
            self.refuse(400, "parâmetro inválido", length)
            return
        if length <= 0:
            self.refuse(411, "corpo vazio ou sem tamanho", length)
            return
        if length > MAX_BYTES:
            self.refuse(413, f"arquivo acima de {MAX_BYTES // (1024 * 1024)} MB", length, 512 << 20)
            return
        if _retiring.is_set() or not _busy.acquire(blocking=False):
            self.refuse(503, "ocupado", length)
            return
        work = tempfile.mkdtemp(prefix=f"{NAME}-", dir="/tmp")
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.send(400, {"error": "corpo incompleto"})
                return
            if RECYCLE:
                _retiring.set()
            _request.sock = self.connection
            try:
                result = analyze(data, work, script, args)
            except Cancelled:
                log("cancelado: a API fechou a conexão")
                return
            except Exception as exc:  # noqa: BLE001 - falha vira resposta legivel
                log(f"falha: {exc!r}")
                result = {"ok": False, "error": "falha interna na análise", "version": VERSION}
            self.send(200, result)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            _busy.release()
            if _retiring.is_set():
                threading.Thread(target=retire, args=(self.server,), daemon=True).start()


def main():
    if len(TOKEN) < 16:
        log(f"{PREFIX}_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    log(f"ouvindo na porta {PORT} ({VERSION})")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
