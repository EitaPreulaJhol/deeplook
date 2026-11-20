"""Analise de funcoes com o Ghidra (item 7.3), sob demanda, num container sem rede.

Recebe POST /analyze (corpo = o executavel, com o token da API) e roda o Ghidra headless em duas
passadas: a primeira importa, analisa e exporta o resumo (ExportDeepLook.java: funcoes, quem chama
APIs sensiveis e o pseudo-C dessas funcoes) e o pseudo-C de todas as funcoes, ate o prazo
(plans/ghidra-pseudo-c); a segunda abre o programa ja gravado, sem analisar de novo, e empacota o
projeto .gzf para abrir no Ghidra local (PackGzf.java). Devolve o resumo, o pseudo-C completo
(JSON com gzip) e o .gzf, os dois em base64. Um trabalho por vez; com GHIDRA_RECYCLE (padrao), o processo sai depois de responder
e o Docker sobe um container limpo, como a captura (item 6.17) e o capa (7.2).

Mesmo esqueleto do apps/capa/server.py (token, recusa lendo o corpo, /health com o estado, troca de
container): mudou um, confira o outro.
"""

import base64
import gzip
import hmac
import hashlib
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


def secret(name):
    """Segredo do ambiente ou, com NOME_FILE, do arquivo (Docker secrets; plano pos-revisao 5.1)."""
    path = os.environ.get(f"{name}_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read().rstrip("\r\n")
    return os.environ.get(name, "")


PORT = int(os.environ.get("PORT", "3300"))
TOKEN = secret("GHIDRA_TOKEN")
RECYCLE = os.environ.get("GHIDRA_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("GHIDRA_MAX_MB", "32")) * 1024 * 1024
TIMEOUT = int(os.environ.get("GHIDRA_TIMEOUT_S", "900"))
# O .gzf traz o programa inteiro (com os bytes da amostra); acima disto nao volta.
MAX_GZF = int(os.environ.get("GHIDRA_MAX_GZF_MB", "64")) * 1024 * 1024
# Pseudo-C completo: teto do codigo (UTF-8) somado de todas as funcoes; o script para de guardar ao
# passar dele. O arquivo tem ainda os metadados e o escape do JSON: acima de PSEUDO_FILE_MAX, nao
# volta. A API descomprime com o mesmo limite (lib/ghidra.ts).
MAX_PSEUDO = int(os.environ.get("GHIDRA_MAX_PSEUDO_MB", "32")) * 1024 * 1024
PSEUDO_FILE_MAX = 2 * MAX_PSEUDO + 64 * 1024 * 1024
# O prazo do pseudo-C completo fica antes do teto da primeira passada: as funcoes em andamento
# terminam (ate 30 s cada) e o script ainda grava os dois arquivos.
PSEUDO_MARGIN_S = 90
GHIDRA = os.environ.get("GHIDRA_HOME", "/opt/ghidra")
APP = os.environ.get("GHIDRA_APP", "/app")
VERSION = os.environ.get("GHIDRA_VERSION", "")
MIN_UPTIME_S = 10.5
# A segunda passada so abre o programa gravado e empacota: nao analisa nada.
PACK_TIMEOUT = 300
# Analise mais leve (plans/ajustes-usabilidade, item 2): acima de GHIDRA_LIGHT_MB, sem o analisador
# de switch. No python3.13 (6,8 MB), com o teto de memoria do descompilador (decompile-limit.sh), a
# completa levou 662 s (a analise automatica perto do teto de 630 s) e a leve 300 s, com 2% a menos
# de funcoes. 0 desliga.
LIGHT_BYTES = int(os.environ.get("GHIDRA_LIGHT_MB", "5")) * 1024 * 1024
LIGHT_ANALYZERS = ["Decompiler Switch Analysis"]
FID_DIR = os.environ.get("GHIDRA_FID_DIR", "/opt/fid")
# BSim (item 23): a base H2 fica no volume /bsim, que sobrevive a troca de container.
BSIM_DIR = os.environ.get("GHIDRA_BSIM_DIR", "/bsim")
BSIM_TIMEOUT = int(os.environ.get("GHIDRA_BSIM_TIMEOUT_S", "300"))


def binexport_pass(project, work):
    """O .BinExport (item 24), para o BinDiff comparar duas amostras depois. (base64, motivo)."""
    if not os.path.isdir(f"{GHIDRA}/Ghidra/Extensions/BinExport"):
        return None, None
    out = os.path.join(work, "amostra.BinExport")
    logfile = os.path.join(work, "passo-binexport.log")
    error = run(
        headless(project, "-process", "amostra", "-noanalysis", "-postScript", "ExportBinExport.java", out),
        PACK_TIMEOUT,
        logfile,
    ) or script_error(logfile)
    if error or not os.path.exists(out):
        return None, (error or "o BinExport não foi gerado")[:300]
    if os.path.getsize(out) > MAX_BINEXPORT:
        return None, f"BinExport acima de {MAX_BINEXPORT // (1024 * 1024)} MB"
    with open(out, "rb") as f:
        return base64.b64encode(f.read()).decode(), None


BINDIFF = os.environ.get("BINDIFF", "/opt/bindiff/bin/bindiff")
BINDIFF_TIMEOUT = int(os.environ.get("GHIDRA_BINDIFF_TIMEOUT_S", "300"))
MAX_BINEXPORT = int(os.environ.get("GHIDRA_MAX_BINEXPORT_MB", "32")) * 1024 * 1024
MAX_DIFF_ROWS = 5000


def bindiff(body):
    """Compara dois .BinExport (item 24). Corpo: 4 bytes com o tamanho do primeiro (big endian), o
    primeiro e o segundo. Devolve as funcoes casadas, com a similaridade, e os totais de cada lado."""
    import sqlite3
    import struct

    if len(body) < 4:
        return {"ok": False, "error": "corpo inválido"}
    size = struct.unpack(">I", body[:4])[0]
    if size <= 0 or 4 + size >= len(body):
        return {"ok": False, "error": "corpo inválido"}
    work = tempfile.mkdtemp(prefix="bindiff-", dir="/tmp")
    try:
        a = os.path.join(work, "a.BinExport")
        b = os.path.join(work, "b.BinExport")
        with open(a, "wb") as f:
            f.write(body[4:4 + size])
        with open(b, "wb") as f:
            f.write(body[4 + size:])
        out = os.path.join(work, "saida")
        os.mkdir(out)
        error = run(
            [BINDIFF, "--logo=false", "--primary", a, "--secondary", b, "--output_dir", out,
             "--output_format", "bin"],
            BINDIFF_TIMEOUT,
            os.path.join(work, "bindiff.log"),
        )
        found = [p for p in os.listdir(out) if p.endswith(".BinDiff")]
        if error or not found:
            with open(os.path.join(work, "bindiff.log"), encoding="utf-8", errors="replace") as f:
                tail = [line for line in f.read().splitlines() if line.strip()][-1:] or ["sem detalhe"]
            return {"ok": False, "error": (error or f"o BinDiff falhou: {tail[0]}")[:300]}
        db = sqlite3.connect(os.path.join(out, found[0]))
        try:
            meta = db.execute("SELECT similarity, confidence FROM metadata").fetchone() or (None, None)
            files = db.execute("SELECT id, functions, libfunctions FROM file ORDER BY id").fetchall()
            rows = db.execute(
                "SELECT address1, name1, address2, name2, similarity, confidence FROM function "
                "ORDER BY similarity ASC, address1 LIMIT ?",
                (MAX_DIFF_ROWS,),
            ).fetchall()
            total = db.execute("SELECT COUNT(*) FROM function").fetchone()[0]
        finally:
            db.close()
        side = lambda i: {"functions": files[i][1], "libraryFunctions": files[i][2]} if len(files) > i else None  # noqa: E731
        return {
            "ok": True,
            "version": VERSION,
            "similarity": round(meta[0], 4) if meta[0] is not None else None,
            "confidence": round(meta[1], 4) if meta[1] is not None else None,
            "primary": side(0),
            "secondary": side(1),
            "matched": total,
            "truncated": total > len(rows),
            "functions": [
                {"address1": hex(r[0]), "name1": (r[1] or "")[:300], "address2": hex(r[2]),
                 "name2": (r[3] or "")[:300], "similarity": round(r[4], 4), "confidence": round(r[5], 4)}
                for r in rows
            ],
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def bsim_pass(project, work, data):
    """Funcoes parecidas em outras amostras e as assinaturas desta (BSimDeepLook.java). Um passo a
    parte: falhar aqui nao derruba a analise. None quando o volume nao existe."""
    if not os.path.isdir(BSIM_DIR) or not os.access(BSIM_DIR, os.W_OK):
        return None
    out = os.path.join(work, "bsim.json")
    logfile = os.path.join(work, "passo3.log")
    deadline_ms = int((time.time() + BSIM_TIMEOUT - 30) * 1000)
    error = run(
        headless(
            project, "-process", "amostra", "-noanalysis", "-postScript", "BSimDeepLook.java",
            os.path.join(BSIM_DIR, "deeplook"), out, hashlib.sha256(data).hexdigest(), str(deadline_ms),
        ),
        BSIM_TIMEOUT,
        logfile,
    ) or script_error(logfile)
    if error or not os.path.exists(out):
        log(f"BSim: {error or 'sem resultado'}")
        return {"error": (error or "o BSim não produziu o resultado")[:300]}
    with open(out, encoding="utf-8") as f:
        return json.load(f)

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[ghidra] {msg}", file=sys.stderr, flush=True)


def run(cmd, timeout, logfile):
    """Roda o Ghidra num grupo de processos proprio; no tempo esgotado ou com a API fora do pedido,
    mata o grupo inteiro."""
    with open(logfile, "wb") as out:
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + timeout
        while True:
            try:
                proc.wait(timeout=max(0.05, min(1.0, deadline - time.monotonic())))
                break
            except subprocess.TimeoutExpired:
                # A cada segundo: a API desistiu (cancelado no Monitoramento) ou o tempo acabou.
                gone = client_gone()
                if not gone and time.monotonic() < deadline:
                    continue
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                if gone:
                    raise Cancelled() from None
                return f"tempo esgotado ({timeout} s)"
    # Morto pelo teto do conteiner: o sinal direto ou 137 (128 + 9) pelo script do headless, que
    # espera o Java.
    if proc.returncode in (-signal.SIGKILL, 128 + signal.SIGKILL):
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


def pack_pseudo(path):
    """Pseudo-C completo em gzip e base64, ou (None, motivo). O resumo vale sem ele."""
    if not os.path.exists(path):
        return None, "o pseudo-C completo não foi gerado"
    if os.path.getsize(path) > PSEUDO_FILE_MAX:
        return None, f"pseudo-C completo acima de {PSEUDO_FILE_MAX // (1024 * 1024)} MB"
    with open(path, "rb") as f:
        packed = gzip.compress(f.read(), compresslevel=6, mtime=0)
    return base64.b64encode(packed).decode(), None


def first_pass(work, budget, light):
    """Importa, analisa e exporta (resumo e pseudo-C) em ate `budget` s. Erro ou None."""
    project = os.path.join(work, "projeto")
    os.mkdir(project)
    # A analise automatica para em 70% do teto e o script ainda roda: sai um resultado
    # parcial em vez de nada.
    analysis_timeout = max(60, int(budget * 0.7))
    deadline_ms = int((time.time() + max(30, budget - PSEUDO_MARGIN_S)) * 1000)
    logfile = os.path.join(work, "passo1.log")
    error = run(
        headless(
            project,
            "-import",
            os.path.join(work, "amostra"),
            "-analysisTimeoutPerFile",
            str(analysis_timeout),
            # As bases do Function ID do MinGW-w64, montadas no build (item 25).
            *(["-preScript", "AttachFid.java", FID_DIR] if os.path.isdir(FID_DIR) else []),
            *(["-preScript", "LightAnalysis.java", *LIGHT_ANALYZERS] if light else []),
            "-postScript",
            "ExportDeepLook.java",
            os.path.join(work, "resumo.json"),
            f"{APP}/sensitive-apis.txt",
            f"{APP}/pe-ordinals.json",
            os.path.join(work, "pseudo.json"),
            str(deadline_ms),
            str(MAX_PSEUDO),
        ),
        budget,
        logfile,
    )
    return error or script_error(logfile)


def analyze(data):
    started = time.monotonic()
    work = tempfile.mkdtemp(prefix="ghidra-", dir="/tmp")
    try:
        sample = os.path.join(work, "amostra")
        project = os.path.join(work, "projeto")
        out = os.path.join(work, "resumo.json")
        pseudo = os.path.join(work, "pseudo.json")
        gzf = os.path.join(work, "projeto.gzf")
        with open(sample, "wb") as f:
            f.write(data)
        light = "size" if LIGHT_BYTES and len(data) > LIGHT_BYTES else None
        error = first_pass(work, TIMEOUT, light)
        if error or not os.path.exists(out):
            return {
                "ok": False,
                "error": error or "o Ghidra não produziu o resumo",
                "version": VERSION,
                "ms": int((time.monotonic() - started) * 1000),
            }
        with open(out, encoding="utf-8") as f:
            summary = json.load(f)
        if light:
            # O motivo e o que ficou de fora, para a tela explicar o resultado.
            summary["light"] = {"reason": light, "analyzers": LIGHT_ANALYZERS}
            log(f"análise leve ({light}): sem {', '.join(LIGHT_ANALYZERS)}")

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
        binexport_b64, binexport_error = binexport_pass(project, work)
        bsim = bsim_pass(project, work, data)
        if bsim is not None:
            summary["bsim"] = bsim
        # Depois da segunda passada, com o Java fora da memoria.
        pseudo_b64, pseudo_error = pack_pseudo(pseudo)
        return {
            "ok": True,
            "kind": kind_of(data[:4]),
            "version": VERSION,
            "summary": summary,
            "gzf": gzf_b64,
            "gzfError": gzf_error,
            "binexport": binexport_b64,
            "binexportError": binexport_error,
            "pseudo": pseudo_b64,
            "pseudoError": pseudo_error,
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
        if self.path not in ("/analyze", "/bindiff"):
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
            if self.path == "/bindiff":
                # Comparacao de dois .BinExport (item 24): rapida, mas o container tambem e trocado.
                if RECYCLE:
                    _retiring.set()
                try:
                    result = bindiff(data)
                except Exception as exc:  # noqa: BLE001 - falha vira resposta legivel
                    log(f"falha no BinDiff: {exc!r}")
                    result = {"ok": False, "error": "falha interna no BinDiff", "version": VERSION}
                self.send(200, result)
                return
            if kind_of(data[:4]) is None:
                self.send(415, {"error": "só executáveis do Windows (PE) e Linux (ELF)"})
                return
            if RECYCLE:
                _retiring.set()
            _request.sock = self.connection
            try:
                result = analyze(data)
            except Cancelled:
                log("cancelado: a API fechou a conexão")
                return
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
