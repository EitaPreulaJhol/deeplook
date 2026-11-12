"""Identificar e desempacotar (itens 7.8 e 7.9), num container sem rede.

Recebe POST /analyze (corpo = o executavel, com o token da API), identifica o arquivo com o Detect It
Easy (compilador, empacotador, protetor, instalador) e escolhe o primeiro desempacotador
de unpackers/ que reconhece o arquivo (UPX, PyInstaller, Inno Setup, NSIS, arquivo compactado
embutido) e devolve um ZIP sem compressao com manifest.json e os arquivos extraidos. A API cria uma
amostra filha para cada um. So le e extrai: nada da amostra e executado.

Novos desempacotadores (um de Themida, por exemplo) entram como um arquivo em unpackers/; o
contrato esta em unpackers/README.md.

Mesmo esqueleto do apps/capa/server.py (token, recusa lendo o corpo, /health com o estado, um
container por trabalho): mudou um, confira o outro.
"""

import hmac
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "3400"))
TOKEN = os.environ.get("UNPACK_TOKEN", "")
RECYCLE = os.environ.get("UNPACK_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("UNPACK_MAX_MB", "64")) * 1024 * 1024
TIMEOUT = int(os.environ.get("UNPACK_TIMEOUT_S", "180"))
# Teto do que sai (contra zip bomb e instalador gigante): arquivos e bytes somados.
# A API aceita no maximo 100 arquivos no manifesto (manifestSchema, apps/api/src/lib/unpack.ts):
# acima disso ela recusaria a resposta inteira, entao o teto vale aqui tambem.
MAX_FILES_CEILING = 100
MAX_FILES = max(1, min(int(os.environ.get("UNPACK_MAX_FILES", "50")), MAX_FILES_CEILING))
MAX_TOTAL = int(os.environ.get("UNPACK_MAX_TOTAL_MB", "256")) * 1024 * 1024
# A lista do que ficou de fora tambem tem teto (a API aceita 10 mil linhas): um instalador com
# dezenas de milhares de arquivos nao pode fazer a resposta inteira ser recusada.
MAX_SKIPPED = 1000
PLUGINS_DIR = os.environ.get("UNPACK_PLUGINS", os.path.join(os.path.dirname(__file__), "unpackers"))
DIEC = os.environ.get("DIEC", "/usr/bin/diec")
DIE_TIMEOUT = 60
MAX_DETECTIONS = 50
MIN_UPTIME_S = 10.5

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()


def log(msg):
    print(f"[unpack] {msg}", file=sys.stderr, flush=True)


def load_plugins():
    """Os desempacotadores, na ordem do nome do arquivo (u10_upx antes de u90_archive)."""
    sys.path.insert(0, PLUGINS_DIR)
    plugins = []
    for name in sorted(os.listdir(PLUGINS_DIR)):
        if not (name.startswith("u") and name.endswith(".py")):
            continue
        spec = importlib.util.spec_from_file_location(name[:-3], os.path.join(PLUGINS_DIR, name))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for attr in ("NAME", "LABEL", "detect", "unpack"):
            if not hasattr(module, attr):
                raise SystemExit(f"[unpack] {name} sem {attr} (ver unpackers/README.md)")
        plugins.append(module)
    return plugins


PLUGINS = load_plugins()
from common import UnpackError, run  # noqa: E402 - so existe depois de load_plugins pôr a pasta no path


def die_version():
    try:
        _, out = run([DIEC, "--version"], 30)
        return out.strip().split()[-1]
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


DIE_VERSION = die_version()


def identify(path):
    """Detect It Easy (diec -j): [{filetype, type, name, version, info, string}] ou o motivo."""
    try:
        code, out = run([DIEC, "-j", path], DIE_TIMEOUT)
    except UnpackError as exc:
        return [], str(exc)
    try:
        doc = json.loads(out[out.index("{"):])
    except ValueError:
        return [], f"o Detect It Easy não respondeu em JSON (código {code})"
    found = []
    for part in doc.get("detects", []):
        for value in part.get("values", []):
            found.append(
                {
                    "filetype": str(part.get("filetype", ""))[:40],
                    "type": str(value.get("type", ""))[:40],
                    "name": str(value.get("name", ""))[:120],
                    "version": str(value.get("version", ""))[:80],
                    "info": str(value.get("info", ""))[:120],
                    "string": str(value.get("string", ""))[:240],
                }
            )
    return found[:MAX_DETECTIONS], None


def safe_name(rel):
    """Nome para a ficha: so o caminho relativo, sem barras iniciais nem '..'."""
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".", "..")]
    return "/".join(parts)[:300] or "arquivo"


def inside(root, path):
    """O caminho (resolvido) fica dentro da pasta?"""
    root = os.path.realpath(root)
    return os.path.commonpath([root, os.path.realpath(path)]) == root


def analyze(data, work, unpack=True):
    """Devolve (manifest, [(nome no zip, caminho)]). unpack=False: so identifica."""
    sample = os.path.join(work, "amostra")
    outdir = os.path.join(work, "saida")
    os.mkdir(outdir)
    with open(sample, "wb") as f:
        f.write(data)
    detections, die_error = identify(sample)
    ident = {"detections": detections, "dieError": die_error, "dieVersion": DIE_VERSION}
    plugin = next((p for p in PLUGINS if p.detect(data)), None) if unpack else None
    if plugin is None:
        return {"ok": True, "unpacker": None, "files": [], "skipped": [], "note": None, **ident}, []
    started = time.monotonic()
    try:
        result = plugin.unpack(sample, outdir, TIMEOUT)
    except UnpackError as exc:
        return {
            "ok": False,
            "unpacker": plugin.NAME,
            "label": plugin.LABEL,
            "error": str(exc)[:300],
            "ms": int((time.monotonic() - started) * 1000),
            **ident,
        }, []
    files, skipped, chosen, total = [], [], [], 0
    for rel, path in result["files"]:
        name = safe_name(rel)
        # Antes do getsize: num link quebrado ele lanca, e o trabalho inteiro falhava.
        if os.path.islink(path) or not os.path.isfile(path):
            continue
        # So o que esta dentro da pasta de saida: um desempacotador que monte o caminho a partir
        # de um nome vindo da amostra nao entrega arquivo do container.
        if not inside(outdir, path):
            skipped.append({"name": name, "size": 0, "reason": "fora da pasta de extração"})
            continue
        size = os.path.getsize(path)
        if len(chosen) >= MAX_FILES:
            skipped.append({"name": name, "size": size, "reason": f"limite de {MAX_FILES} arquivos"})
            continue
        if total + size > MAX_TOTAL:
            skipped.append({"name": name, "size": size, "reason": "limite de tamanho somado"})
            continue
        if size == 0:
            skipped.append({"name": name, "size": 0, "reason": "arquivo vazio"})
            continue
        total += size
        entry = f"f{len(chosen) + 1:04d}"
        chosen.append((entry, path))
        # A filha ja sai identificada daqui (o DIE leva ~150 ms): so volta para a fila, com um
        # container novo, se algum desempacotador a reconhecer.
        with open(path, "rb") as f:
            head = f.read()
        child_detections, child_error = identify(path)
        files.append(
            {
                "name": name,
                "entry": entry,
                "size": size,
                "detections": child_detections,
                "dieError": child_error,
                "candidate": any(p.detect(head) for p in PLUGINS),
            }
        )
    if len(skipped) > MAX_SKIPPED:
        rest = skipped[MAX_SKIPPED:]
        skipped = skipped[:MAX_SKIPPED] + [
            {
                "name": f"e mais {len(rest)} arquivo(s)",
                "size": sum(item["size"] for item in rest),
                "reason": "lista cortada",
            }
        ]
    return {
        "ok": True,
        "unpacker": plugin.NAME,
        "label": plugin.LABEL,
        "note": result.get("note"),
        "files": files,
        "skipped": skipped,
        "ms": int((time.monotonic() - started) * 1000),
        **ident,
    }, chosen


def retire(server):
    """Sai depois de responder (ver apps/capa/server.py): primeiro para de aceitar conexoes."""
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = "deeplook-unpack"
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

    def send_zip(self, path):
        self.send_response(200)
        self.send_header("content-type", "application/zip")
        self.send_header("content-length", str(os.path.getsize(path)))
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def do_GET(self):
        if self.path == "/health":
            state = "trocando" if _retiring.is_set() else "analisando" if _busy.locked() else "livre"
            self.send(
                200,
                {
                    "ok": True,
                    "state": state,
                    "unpackers": [p.NAME for p in PLUGINS],
                    "die": DIE_VERSION,
                },
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
        if path != "/analyze":
            self.refuse(404, "não encontrado", length)
            return
        # ?unpack=0: so identificar (a API manda assim a partir da segunda geracao).
        unpack = "unpack=0" not in query.split("&")
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
        work = tempfile.mkdtemp(prefix="unpack-", dir="/tmp")
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.send(400, {"error": "corpo incompleto"})
                return
            if RECYCLE:
                _retiring.set()
            try:
                manifest, chosen = analyze(data, work, unpack)
            except Exception as exc:  # noqa: BLE001 - falha vira resposta legivel
                log(f"falha: {exc!r}")
                manifest, chosen = {"ok": False, "error": "falha interna ao desempacotar"}, []
            bundle = os.path.join(work, "resposta.zip")
            with zipfile.ZipFile(bundle, "w", zipfile.ZIP_STORED) as z:
                z.writestr("manifest.json", json.dumps(manifest))
                for entry, path in chosen:
                    z.write(path, entry)
            self.send_zip(bundle)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            _busy.release()
            if _retiring.is_set():
                threading.Thread(target=retire, args=(self.server,), daemon=True).start()


def main():
    if len(TOKEN) < 16:
        log("UNPACK_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    if os.environ.get("UNPACK_MAX_FILES", "50") != str(MAX_FILES):
        log(f"UNPACK_MAX_FILES fora de 1 a {MAX_FILES_CEILING}: usando {MAX_FILES}")
    log(f"ouvindo na porta {PORT} (Detect It Easy {DIE_VERSION}; {', '.join(p.NAME for p in PLUGINS)})")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
