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
import select
import shutil
import socket
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ---- Cancelamento pelo Monitoramento (plans/monitoramento, item 4). Os desempacotadores rodam
# dentro deste processo, sem filho para matar: com UNPACK_RECYCLE (padrao), quando a API desiste do
# pedido (fecha a conexao), o processo sai e o Docker sobe um container limpo, como depois de cada
# trabalho. Sem a troca de container, o trabalho segue ate o fim (a API ja nao espera a resposta).
def client_gone(sock):
    """A conexao do pedido fechou (fim de arquivo ou erro ao espiar o socket)."""
    try:
        readable, _, _ = select.select([sock], [], [], 0)
        return bool(readable) and sock.recv(1, socket.MSG_PEEK) == b""
    except OSError:
        return True


def watch_client(sock, done):
    while not done.wait(1):
        if client_gone(sock):
            log("cancelado: a API fechou a conexão; saindo para o Docker subir um container limpo")
            os._exit(0)


def secret(name):
    """Segredo do ambiente ou, com NOME_FILE, do arquivo (Docker secrets; plano pos-revisao 5.1)."""
    path = os.environ.get(f"{name}_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read().rstrip("\r\n")
    return os.environ.get(name, "")


PORT = int(os.environ.get("PORT", "3400"))
TOKEN = secret("UNPACK_TOKEN")
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

GORESYM = os.environ.get("GORESYM", "/opt/goresym/GoReSym")
MAGIKA = os.environ.get("MAGIKA", "/opt/magika/magika")
MAGIKA_TIMEOUT = 60


def magika(path):
    """Magika (item 22): {label, description, group, mime, score, isText} ou None."""
    try:
        code, out = run([MAGIKA, "--json", path], MAGIKA_TIMEOUT)
        doc = json.loads(out[out.index("["):])
    except (UnpackError, ValueError):
        return None
    try:
        result = doc[0]["result"]
        if result.get("status") != "ok":
            return None
        value = result["value"]
        output = value["output"]
    except (IndexError, KeyError, TypeError):
        return None
    return {
        "label": str(output.get("label", ""))[:40],
        "description": str(output.get("description", ""))[:120],
        "group": str(output.get("group", ""))[:40],
        "mime": str(output.get("mime_type", ""))[:120],
        "extensions": [str(e)[:20] for e in (output.get("extensions") or [])][:10],
        "isText": bool(output.get("is_text")),
        "score": round(float(value.get("score") or 0), 4),
    }
GO_TIMEOUT = 60
MAX_GO_DEPS = 200
MAX_GO_FUNCTIONS = 500
MAX_GO_FILES = 200


def is_std(package):
    """Pacote da biblioteca padrao (ou do runtime): o primeiro trecho do caminho nao tem ponto."""
    first = package.split("/", 1)[0]
    return package != "main" and "." not in first


def looks_go(data, detections):
    """Go pelo DIE (compilador) ou pela marca do build ID que o linker do Go grava."""
    if any("go" == (d.get("name") or "").lower() or "golang" in (d.get("name") or "").lower()
           for d in detections):
        return True
    return b"\xff Go build ID: " in data or b"Go buildinf:" in data


def go_info(path):
    """GoReSym (plans/analise-estatica-ampliada, item 14): versao do Go, modulo principal, dependencias,
    configuracao do build, as funcoes do proprio programa (sem a biblioteca padrao) e os arquivos-fonte
    do projeto. Funciona com o binario sem simbolos (le o pclntab). None se nao for Go."""
    try:
        code, out = run([GORESYM, "-p", path], GO_TIMEOUT)
    except UnpackError:
        return None
    try:
        doc = json.loads(out[out.index("{"):])
    except ValueError:
        return None
    if code != 0 or not doc.get("Version"):
        return None
    build = doc.get("BuildInfo") or {}
    main = build.get("Main") or {}
    functions = [
        f.get("FullName", "")[:200]
        for f in doc.get("UserFunctions") or []
        if not is_std(f.get("PackageName") or "")
    ]
    packages = sorted({
        (f.get("PackageName") or "")[:200]
        for f in doc.get("UserFunctions") or []
        if not is_std(f.get("PackageName") or "")
    })
    toolchain = ("/go/src/", "/hostedtoolcache/", "/usr/local/go/", "/usr/lib/go", "/pkg/mod/")
    files = [
        str(p)[:300] for p in doc.get("Files") or []
        if not any(t in str(p).replace("\\", "/") for t in toolchain)
    ]
    return {
        "version": str(doc.get("Version"))[:40],
        "buildId": (str(doc.get("BuildId")) or "")[:200] or None,
        "arch": str(doc.get("Arch") or "")[:20] or None,
        "os": str(doc.get("OS") or "")[:20] or None,
        "path": (build.get("Path") or "")[:300] or None,
        "main": {"path": (main.get("Path") or "")[:300], "version": (main.get("Version") or "")[:120]}
        if main.get("Path") else None,
        "deps": [
            {"path": (d.get("Path") or "")[:300], "version": (d.get("Version") or "")[:120]}
            for d in (build.get("Deps") or [])[:MAX_GO_DEPS]
        ],
        "settings": [
            {"key": (s.get("Key") or "")[:80], "value": (s.get("Value") or "")[:300]}
            for s in (build.get("Settings") or [])[:50]
            if s.get("Key") != "DefaultGODEBUG"
        ],
        "packages": packages[:200],
        "functions": functions[:MAX_GO_FUNCTIONS],
        "functionCount": len(functions),
        "files": files[:MAX_GO_FILES],
    }


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
    ident = {
        "detections": detections,
        "dieError": die_error,
        "dieVersion": DIE_VERSION,
        "magika": magika(sample),
    }
    if looks_go(data, detections):
        ident["go"] = go_info(sample)
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
        child = {
            "name": name,
            "entry": entry,
            "size": size,
            "detections": child_detections,
            "dieError": child_error,
            "candidate": any(p.detect(head) for p in PLUGINS),
        }
        if looks_go(head, child_detections):
            child["go"] = go_info(path)
        files.append(child)
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
            done = threading.Event()
            if RECYCLE:
                threading.Thread(target=watch_client, args=(self.connection, done), daemon=True).start()
            try:
                manifest, chosen = analyze(data, work, unpack)
            except Exception as exc:  # noqa: BLE001 - falha vira resposta legivel
                log(f"falha: {exc!r}")
                manifest, chosen = {"ok": False, "error": "falha interna ao desempacotar"}, []
            finally:
                done.set()
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
