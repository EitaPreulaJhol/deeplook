"""Office e PDF mais fundo (item 7.14 do plano; revisao de novembro, 3.2), num container sem rede.
Tambem le QR codes de imagens e PDFs (POST /qr, qr.py; plano pos-revisao, item 2.2).

Recebe POST /analyze (corpo = o documento, com o token da API) e devolve o que o oletools achou:
macros VBA e XLM 4.0 (com o codigo e a desofuscacao do olevba), o veredito do MacroRaptor, campos
DDE, os indicadores do oleid e os objetos de um RTF. A analise roda num processo filho com
tempo-limite (analyze.py): documento que trava o parser derruba o filho, nao o servidor. Nada do
documento e executado.

Mesmo esqueleto do apps/unpack/server.py (token, recusa lendo o corpo, /health com o estado, um
container por trabalho): mudou um, confira o outro.
"""

import base64
import hmac
import json
import os
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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


PORT = int(os.environ.get("PORT", "3500"))
TOKEN = secret("OLETOOLS_TOKEN")
RECYCLE = os.environ.get("OLETOOLS_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("OLETOOLS_MAX_MB", "32")) * 1024 * 1024
TIMEOUT = int(os.environ.get("OLETOOLS_TIMEOUT_S", "120"))
ANALYZER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "analyze.py")
# QR code em imagens e PDFs (plano pos-revisao, item 2.2): POST /qr, no mesmo esquema.
QR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qr.py")
SCRIPTS = {"/analyze": ANALYZER, "/qr": QR}
MIN_UPTIME_S = 10.5

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[oletools] {msg}", file=sys.stderr, flush=True)


def oletools_version():
    try:
        from oletools import olevba

        return getattr(olevba, "__version__", None)
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


VERSION = oletools_version()


def analyze(data, work, script=ANALYZER, passwords=None):
    """Roda o script (analyze.py ou qr.py) num processo filho, com o tempo-limite; devolve o JSON.

    `passwords`: senhas candidatas para o Office cifrado (plans/analise-estatica-ampliada, item 9),
    gravadas num arquivo ao lado da amostra (uma por linha), nunca na linha de comando."""
    sample = os.path.join(work, "documento")
    with open(sample, "wb") as f:
        f.write(data)
    extra = []
    if passwords:
        listed = os.path.join(work, "senhas")
        with open(listed, "w", encoding="utf-8") as f:
            f.write("\n".join(passwords))
        extra = [listed]
    started = time.monotonic()
    try:
        proc = run_watched(
            [sys.executable, script, sample, *extra],
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
    return result


def retire(server):
    """Sai depois de responder (ver apps/capa/server.py): primeiro para de aceitar conexoes."""
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = "deeplook-oletools"
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
            self.send(
                200,
                {"ok": True, "state": state, "oletools": VERSION},
            )
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
        # Senhas candidatas (item 9): ?passwords=<base64 de uma por linha>, ate 20 de ate 64.
        passwords = []
        for key, value in urllib.parse.parse_qsl(query):
            if key == "passwords":
                try:
                    decoded = base64.b64decode(value, validate=True).decode("utf-8")
                except (ValueError, UnicodeDecodeError):
                    decoded = ""
                passwords = [p for p in decoded.split("\n") if 0 < len(p) <= 64][:20]
        if script is None:
            self.refuse(404, "não encontrado", length)
            return
        auth = self.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
            self.refuse(401, "token inválido", length)
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
        work = tempfile.mkdtemp(prefix="oletools-", dir="/tmp")
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.send(400, {"error": "corpo incompleto"})
                return
            if RECYCLE:
                _retiring.set()
            _request.sock = self.connection
            try:
                result = analyze(data, work, script, passwords)
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
        log("OLETOOLS_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    log(f"ouvindo na porta {PORT} (oletools {VERSION})")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
