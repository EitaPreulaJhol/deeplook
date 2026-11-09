"""Analise de funcoes com o Ghidra (item 7.3), sob demanda, num container sem rede.

Recebe POST /analyze (corpo = o executavel, com o token da API) e roda o Ghidra headless em duas
passadas: a primeira importa, analisa e exporta o resumo (ExportDeepLook.java: funcoes, quem chama
APIs sensiveis e o pseudo-C dessas funcoes); a segunda abre o programa ja gravado, sem analisar de
novo, e empacota o projeto .gzf para abrir no Ghidra local (PackGzf.java). Devolve o resumo e o
.gzf em base64. Um trabalho por vez; com GHIDRA_RECYCLE (padrao), o processo sai depois de responder
e o Docker sobe um container limpo, como a captura (item 6.17) e o capa (7.2).

Mesmo esqueleto do apps/capa/server.py (token, recusa lendo o corpo, /health com o estado, troca de
container): mudou um, confira o outro.
"""

import base64
import hmac
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "3300"))
TOKEN = os.environ.get("GHIDRA_TOKEN", "")
RECYCLE = os.environ.get("GHIDRA_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("GHIDRA_MAX_MB", "32")) * 1024 * 1024
TIMEOUT = int(os.environ.get("GHIDRA_TIMEOUT_S", "900"))
# O .gzf traz o programa inteiro (com os bytes da amostra); acima disto nao volta.
MAX_GZF = int(os.environ.get("GHIDRA_MAX_GZF_MB", "64")) * 1024 * 1024
GHIDRA = os.environ.get("GHIDRA_HOME", "/opt/ghidra")
APP = os.environ.get("GHIDRA_APP", "/app")
VERSION = os.environ.get("GHIDRA_VERSION", "")
MIN_UPTIME_S = 10.5
# A segunda passada so abre o programa gravado e empacota: nao analisa nada.
PACK_TIMEOUT = 300

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[ghidra] {msg}", file=sys.stderr, flush=True)


def run(cmd, timeout, logfile):
    """Roda o Ghidra num grupo de processos proprio; no tempo esgotado, mata o grupo inteiro."""
    with open(logfile, "wb") as out:
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            return f"tempo esgotado ({timeout} s)"
    if proc.returncode == -signal.SIGKILL:
        return "a análise foi interrompida (memória esgotada)"
    if proc.returncode != 0:
        return f"o Ghidra saiu com código {proc.returncode}"
    return None


def script_error(logfile):
    """Erro de script no log do headless (o processo sai com 0 mesmo assim)."""
    try:
        with open(logfile, encoding="utf-8", errors="replace") as f:
            for line in f:
                if "SCRIPT ERROR" in line or "Script error" in line:
                    return line.strip()[-300:]
    except OSError:
        pass
    return None


def kind_of(head):
    if head[:2] == b"MZ":
        return "pe"
    if head[:4] == b"\x7fELF":
        return "elf"
    return None


def headless(project, *args):
    return [
        f"{GHIDRA}/support/analyzeHeadless",
        project,
        "p",
        *args,
        "-scriptPath",
        f"{APP}/scripts",
        "-max-cpu",
        "2",
    ]


def analyze(data):
    started = time.monotonic()
    work = tempfile.mkdtemp(prefix="ghidra-", dir="/tmp")
    try:
        sample = os.path.join(work, "amostra")
        project = os.path.join(work, "projeto")
        out = os.path.join(work, "resumo.json")
        gzf = os.path.join(work, "projeto.gzf")
        os.mkdir(project)
        with open(sample, "wb") as f:
            f.write(data)
        # A analise automatica para em 70% do teto e o script ainda roda: sai um resultado
        # parcial em vez de nada.
        analysis_timeout = max(60, int(TIMEOUT * 0.7))
        error = run(
            headless(
                project,
                "-import",
                sample,
                "-analysisTimeoutPerFile",
                str(analysis_timeout),
                "-postScript",
                "ExportDeepLook.java",
                out,
                f"{APP}/sensitive-apis.txt",
                f"{APP}/pe-ordinals.json",
            ),
            TIMEOUT,
            os.path.join(work, "passo1.log"),
        )
        error = error or script_error(os.path.join(work, "passo1.log"))
        if error or not os.path.exists(out):
            return {
                "ok": False,
                "error": error or "o Ghidra não produziu o resumo",
                "version": VERSION,
                "ms": int((time.monotonic() - started) * 1000),
            }
        with open(out, encoding="utf-8") as f:
            summary = json.load(f)

        gzf_b64 = None
        gzf_error = run(
            headless(project, "-process", "amostra", "-noanalysis", "-postScript", "PackGzf.java", gzf),
            PACK_TIMEOUT,
            os.path.join(work, "passo2.log"),
        ) or script_error(os.path.join(work, "passo2.log"))
        if not gzf_error:
            if not os.path.exists(gzf):
                gzf_error = "o projeto não foi gerado"
            elif os.path.getsize(gzf) > MAX_GZF:
                gzf_error = f"projeto acima de {MAX_GZF // (1024 * 1024)} MB"
            else:
                with open(gzf, "rb") as f:
                    gzf_b64 = base64.b64encode(f.read()).decode()
        return {
            "ok": True,
            "kind": kind_of(data[:4]),
            "version": VERSION,
            "summary": summary,
            "gzf": gzf_b64,
            "gzfError": gzf_error,
            "ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def retire(server):
    """Sai depois de responder (ver apps/capa/server.py): primeiro para de aceitar conexoes."""
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = "deeplook-ghidra"
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
            self.send(200, {"ok": True, "state": state, "ghidra": VERSION})
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
        if self.path != "/analyze":
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
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.send(400, {"error": "corpo incompleto"})
                return
            if kind_of(data[:4]) is None:
                self.send(415, {"error": "só executáveis do Windows (PE) e Linux (ELF)"})
                return
            if RECYCLE:
                _retiring.set()
            try:
                result = analyze(data)
            except Exception as exc:  # noqa: BLE001 - falha vira resposta legivel
                log(f"falha: {exc!r}")
                result = {"ok": False, "error": "falha interna na análise", "version": VERSION}
            self.send(200, result)
        finally:
            _busy.release()
            if _retiring.is_set():
                threading.Thread(target=retire, args=(self.server,), daemon=True).start()


def main():
    if len(TOKEN) < 16:
        log("GHIDRA_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    if not os.path.exists(f"{GHIDRA}/support/analyzeHeadless"):
        log("o Ghidra nao foi encontrado na imagem.")
        sys.exit(1)
    log(f"ouvindo na porta {PORT} (Ghidra {VERSION})")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
