"""Analise de funcoes (item 7.2): capa e FLOSS num container sem rede.

Recebe POST /analyze (corpo = o arquivo, com o token da API), roda o capa (o que cada funcao faz,
com ATT&CK e MBC) e, em executavel do Windows, o FLOSS (strings montadas na pilha ou decifradas
em tempo de execucao), e devolve um resumo em JSON. Um trabalho por vez; com CAPA_RECYCLE (padrao),
o processo sai depois de responder e o Docker sobe um container limpo, como na captura (item 6.17):
nada que um arquivo malicioso tenha deixado no parser sobra para o proximo.

Nunca executa a amostra: o capa e o FLOSS leem e emulam o codigo dentro do vivisect (Python).
"""

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

PORT = int(os.environ.get("PORT", "3200"))
TOKEN = os.environ.get("CAPA_TOKEN", "")
RECYCLE = os.environ.get("CAPA_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("CAPA_MAX_MB", "32")) * 1024 * 1024
CAPA_TIMEOUT = int(os.environ.get("CAPA_TIMEOUT_S", "600"))
FLOSS_TIMEOUT = int(os.environ.get("FLOSS_TIMEOUT_S", "300"))
RULES = os.environ.get("CAPA_RULES", "/opt/capa/rules")
SIGS = os.environ.get("CAPA_SIGS", "/opt/capa/sigs")
RULES_VERSION = os.environ.get("CAPA_RULES_VERSION", "")
# O Docker dobra a espera para reiniciar um container que viveu menos de 10 s; com 10 s ou mais,
# reinicia na hora (medido no item 6.17).
MIN_UPTIME_S = 10.5
# Teto do que volta para a API, por lista.
MAX_RULES = 500
MAX_ADDRESSES = 20
MAX_STRINGS = 300
MAX_STRING_LEN = 400

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[capa] {msg}", file=sys.stderr, flush=True)


def tool_version(cmd):
    try:
        out = subprocess.run([cmd, "--version"], capture_output=True, text=True, timeout=60)
        return (out.stdout or out.stderr).strip().split()[-1]
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


VERSIONS = {"capa": tool_version("capa"), "floss": tool_version("floss"), "rules": RULES_VERSION}


def run(cmd, timeout):
    """Roda a ferramenta num grupo de processos proprio; no tempo esgotado, mata o grupo inteiro."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        return None, f"tempo esgotado ({timeout} s)"
    if proc.returncode != 0:
        # Memoria acabou: o kernel mata a ferramenta com SIGKILL (-9).
        if proc.returncode == -signal.SIGKILL:
            return None, "a análise foi interrompida (memória esgotada)"
        tail = err.decode("utf-8", "replace").strip().splitlines()[-3:]
        return None, (" ".join(tail) or f"saiu com código {proc.returncode}")[:300]
    try:
        return json.loads(out), None
    except ValueError:
        return None, "saída ilegível"


def hexaddr(addr):
    """Endereco do JSON do capa ({type, value}) em hexa; outros tipos ficam de fora."""
    if isinstance(addr, dict) and isinstance(addr.get("value"), int):
        return hex(addr["value"])
    return None


def summarize_capa(doc):
    meta = doc.get("meta", {})
    analysis = meta.get("analysis", {})
    rules = []
    for name, rule in (doc.get("rules") or {}).items():
        rmeta = rule.get("meta", {})
        namespace = rmeta.get("namespace") or ""
        # Regras de biblioteca e internas so servem de base para as outras (o capa tambem as esconde).
        if rmeta.get("lib") or namespace.startswith("internal"):
            continue
        addresses = [a for a in (hexaddr(m[0]) for m in rule.get("matches", []) if m) if a]
        rules.append(
            {
                "name": str(name)[:200],
                "namespace": namespace[:200],
                "attack": sorted({a.get("id") for a in rmeta.get("attack", []) if a.get("id")}),
                "mbc": sorted(
                    {
                        f"{m.get('objective')}::{m.get('behavior')}"
                        + (f"::{m['method']}" if m.get("method") else "")
                        + (f" [{m['id']}]" if m.get("id") else "")
                        for m in rmeta.get("mbc", [])
                    }
                ),
                "matches": len(rule.get("matches", [])),
                "addresses": addresses[:MAX_ADDRESSES],
            }
        )
    rules.sort(key=lambda r: (r["namespace"], r["name"]))
    counts = analysis.get("feature_counts", {})
    return {
        "format": analysis.get("format"),
        "arch": analysis.get("arch"),
        "os": analysis.get("os"),
        "functions": len(counts.get("functions", [])) if isinstance(counts, dict) else None,
        "libraryFunctions": len(analysis.get("library_functions", []) or []),
        "rules": rules[:MAX_RULES],
        "truncated": len(rules) > MAX_RULES,
    }


def summarize_floss(doc):
    strings = doc.get("strings", {})

    def pick(kind, where):
        out = []
        for item in strings.get(kind, [])[:MAX_STRINGS]:
            text = str(item.get("string", ""))[:MAX_STRING_LEN]
            if text:
                out.append({"string": text, "function": hexaddr_int(item.get(where))})
        return out

    return {
        "stack": pick("stack_strings", "function"),
        "tight": pick("tight_strings", "function"),
        "decoded": pick("decoded_strings", "decoding_routine"),
        "truncated": any(
            len(strings.get(k, [])) > MAX_STRINGS
            for k in ("stack_strings", "tight_strings", "decoded_strings")
        ),
    }


def hexaddr_int(value):
    return hex(value) if isinstance(value, int) else None


def kind_of(head):
    if head[:2] == b"MZ":
        return "pe"
    if head[:4] == b"\x7fELF":
        return "elf"
    return None


def analyze(data):
    started = time.monotonic()
    work = tempfile.mkdtemp(prefix="amostra-", dir="/tmp")
    try:
        path = os.path.join(work, "amostra")
        with open(path, "wb") as f:
            f.write(data)
        kind = kind_of(data[:4])
        capa_doc, capa_error = run(["capa", "-q", "-j", "-r", RULES, "-s", SIGS, path], CAPA_TIMEOUT)
        result = {
            "ok": True,
            "kind": kind,
            "versions": VERSIONS,
            "capa": summarize_capa(capa_doc) if capa_doc else None,
            "capaError": capa_error,
            "floss": None,
            "flossError": None,
        }
        # O FLOSS so decifra executavel do Windows.
        if kind == "pe":
            floss_doc, floss_error = run(
                ["floss", "-q", "-j", "--no", "static", "--", path], FLOSS_TIMEOUT
            )
            result["floss"] = summarize_floss(floss_doc) if floss_doc else None
            result["flossError"] = floss_error
        result["ms"] = int((time.monotonic() - started) * 1000)
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def retire(server):
    """
    Sai depois de responder; o restart do compose sobe um container limpo. Primeiro para de aceitar
    conexoes (a API recebe "conexao recusada", que e seguro repetir) e so depois sai: sair com um
    pedido chegando derrubaria a conexao no meio, e a API contaria isso como tentativa perdida.
    """
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = "deeplook-capa"
    sys_version = ""

    def log_message(self, fmt, *args):  # sem o log padrao (tem o IP e a URL de cada pedido)
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
            # Responde durante a analise (o servidor tem uma thread por pedido; a analise segue
            # exclusiva pelo lock): o status do sistema ve "analisando", nao um servico mudo.
            state = "trocando" if _retiring.is_set() else "analisando" if _busy.locked() else "livre"
            self.send(200, {"ok": True, "state": state, **VERSIONS})
        else:
            self.send(404, {"error": "não encontrado"})

    def refuse(self, status, error, length, limit=MAX_BYTES):
        """
        Recusa lendo o corpo antes: responder e fechar com o arquivo ainda chegando faz o TCP
        mandar RST, e a API veria a conexao cair em vez da resposta. Sem token, le no maximo o teto.
        """
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
            # Ja autenticado (so a API): le ate 512 MB para o motivo chegar inteiro, mesmo com a
            # API configurada com um teto maior que o daqui.
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
                result = {"ok": False, "error": "falha interna na análise", "versions": VERSIONS}
            self.send(200, result)
        finally:
            _busy.release()
            if _retiring.is_set():
                threading.Thread(target=retire, args=(self.server,), daemon=True).start()


def main():
    if len(TOKEN) < 16:
        log("CAPA_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    if not VERSIONS["capa"] or not os.path.isdir(RULES):
        log("capa ou as regras nao foram encontrados na imagem.")
        sys.exit(1)
    log(f"ouvindo na porta {PORT} (capa {VERSIONS['capa']}, FLOSS {VERSIONS['floss']}, regras {RULES_VERSION})")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    # So chega aqui na troca (retire): fecha a porta e da um instante as respostas em andamento.
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
