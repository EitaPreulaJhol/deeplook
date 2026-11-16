"""Suricata sobre o pcap do sandbox (plano pos-revisao, item 5.4).

Recebe POST /analyze (corpo = o pcap gravado pelo netcap, com o token da API), roda o Suricata em
modo offline (`suricata -r`) num processo filho com tempo-limite e devolve o eve.json resumido: os
alertas, as consultas DNS, os pedidos HTTP e as conexoes TLS (SNI e certificado).

As regras sao as ET Open (Proofpoint, licenca GPLv2/BSD), baixadas com o suricata-update na subida
e uma vez por dia, pela saida controlada do compose (o proxy `egress`, em HTTPS_PROXY). A analise em
si nao usa rede. Sem as regras (primeira subida sem internet), o Suricata roda so com a regra de
teste do DeepLook (deeplook.rules) e ainda tira DNS, HTTP e TLS do trafego.

Mesmo esqueleto do apps/oletools/server.py (token, recusa lendo o corpo, /health com o estado, um
container por trabalho): mudou um, confira o outro.
"""

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


PORT = int(os.environ.get("PORT", "3800"))
TOKEN = secret("SURICATA_TOKEN")
RECYCLE = os.environ.get("SURICATA_RECYCLE", "true") != "false"
MAX_BYTES = int(os.environ.get("SURICATA_MAX_MB", "256")) * 1024 * 1024
TIMEOUT = int(os.environ.get("SURICATA_TIMEOUT_S", "600"))
# Atualizacao das regras: a cada N horas (0 desliga; so a regra de teste fica).
UPDATE_HOURS = float(os.environ.get("SURICATA_UPDATE_HOURS", "24"))
UPDATE_TIMEOUT = int(os.environ.get("SURICATA_UPDATE_TIMEOUT_S", "900"))
RULES = "/var/lib/suricata/rules/suricata.rules"
LOCAL_RULES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "deeplook.rules")
CONFIG = "/etc/suricata/suricata.yaml"
MIN_UPTIME_S = 10.5
# Tetos do resumo.
MAX_ITEMS = 500
MAX_ALERTS = 200
MAX_TEXT = 500

STARTED = time.monotonic()
_busy = threading.Lock()
_retiring = threading.Event()
_updating = threading.Event()
_update_state = {"lastError": None, "lastRunAt": None}


def log(msg):
    print(f"[suricata] {msg}", file=sys.stderr, flush=True)


def suricata_version():
    try:
        out = subprocess.run(["suricata", "-V"], capture_output=True, timeout=30).stdout
        return out.decode("utf-8", "replace").strip().replace("This is Suricata version ", "")[:40]
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


VERSION = suricata_version()


def rules_info():
    """Quantas regras e de quando (do arquivo gerado pelo suricata-update)."""
    try:
        st = os.stat(RULES)
    except OSError:
        return {"count": 0, "updatedAt": None, "lastError": _update_state["lastError"]}
    count = 0
    with open(RULES, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith(("alert", "drop", "pass", "reject")):
                count += 1
    return {
        "count": count,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
        "lastError": _update_state["lastError"],
    }


def rules_stale():
    try:
        return time.time() - os.stat(RULES).st_mtime > UPDATE_HOURS * 3600 - 600
    except OSError:
        return True


def update_rules():
    """suricata-update (ET Open), com o mesmo lock da analise: nao troca as regras no meio de uma."""
    with _busy:
        _updating.set()
        try:
            log("atualizando as regras (ET Open)")
            proc = subprocess.run(
                ["suricata-update", "--no-reload", "--suricata-conf", CONFIG, "-q"],
                capture_output=True,
                timeout=UPDATE_TIMEOUT,
            )
            _update_state["lastRunAt"] = time.time()
            if proc.returncode == 0:
                _update_state["lastError"] = None
                log(f"regras atualizadas: {rules_info()['count']}")
            else:
                tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["?"]
                _update_state["lastError"] = f"suricata-update falhou: {tail[0][:200]}"
                log(_update_state["lastError"])
        except subprocess.TimeoutExpired:
            _update_state["lastError"] = f"suricata-update passou de {UPDATE_TIMEOUT} s"
            log(_update_state["lastError"])
        except Exception as exc:  # noqa: BLE001 - segue com as regras que tem
            _update_state["lastError"] = f"suricata-update falhou: {exc!r}"[:200]
            log(_update_state["lastError"])
        finally:
            _updating.clear()


def updater():
    """Na subida (se as regras estiverem velhas) e depois a cada UPDATE_HOURS."""
    while UPDATE_HOURS > 0 and not _retiring.is_set():
        if rules_stale():
            update_rules()
        time.sleep(600)


def clip(value, size=MAX_TEXT):
    return value[:size] if isinstance(value, str) else None


def endpoint(ev, side):
    ip = ev.get(f"{side}_ip")
    port = ev.get(f"{side}_port")
    if not isinstance(ip, str):
        return None
    return f"{ip}:{port}" if isinstance(port, int) else ip


def summarize(eve_path):
    """O eve.json em listas curtas, agrupadas (o mesmo nome consultado 50 vezes vira uma linha)."""
    alerts, dns, http, tls = {}, {}, {}, {}
    total_alerts = 0
    if not os.path.exists(eve_path):
        return {"alerts": [], "dns": [], "http": [], "tls": [], "alertsTotal": 0}
    with open(eve_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            kind = ev.get("event_type")
            when = clip(ev.get("timestamp"), 40)
            if kind == "alert":
                a = ev.get("alert") or {}
                sid = a.get("signature_id")
                if not isinstance(sid, int):
                    continue
                total_alerts += 1
                item = alerts.get(sid)
                if item:
                    item["count"] += 1
                elif len(alerts) < MAX_ALERTS:
                    alerts[sid] = {
                        "sid": sid,
                        "signature": clip(a.get("signature")) or "?",
                        "category": clip(a.get("category"), 120),
                        "severity": a.get("severity") if isinstance(a.get("severity"), int) else None,
                        "proto": clip(ev.get("proto"), 10),
                        "src": endpoint(ev, "src"),
                        "dst": endpoint(ev, "dest"),
                        "time": when,
                        "count": 1,
                    }
            elif kind == "dns":
                d = ev.get("dns") or {}
                name = clip(d.get("rrname"), 255)
                if not name:
                    continue
                key = name.lower()
                item = dns.get(key)
                if not item:
                    if len(dns) >= MAX_ITEMS:
                        continue
                    item = dns[key] = {"name": key, "type": None, "answers": [], "time": when, "count": 0}
                if d.get("type") == "query":
                    item["count"] += 1
                    item["type"] = item["type"] or clip(d.get("rrtype"), 10)
                answers = d.get("answers") if isinstance(d.get("answers"), list) else []
                grouped = d.get("grouped") if isinstance(d.get("grouped"), dict) else {}
                values = [x.get("rdata") for x in answers if isinstance(x, dict)]
                for group in grouped.values():
                    if isinstance(group, list):
                        values.extend(group)
                for rdata in values:
                    if isinstance(rdata, str) and rdata not in item["answers"] and len(item["answers"]) < 10:
                        item["answers"].append(rdata[:255])
            elif kind == "http":
                h = ev.get("http") or {}
                host = clip(h.get("hostname"), 255)
                url = clip(h.get("url"))
                method = clip(h.get("http_method"), 16)
                key = (host, method, url)
                item = http.get(key)
                if item:
                    item["count"] += 1
                elif len(http) < MAX_ITEMS:
                    http[key] = {
                        "host": host,
                        "method": method,
                        "url": url,
                        "status": h.get("status") if isinstance(h.get("status"), int) else None,
                        "userAgent": clip(h.get("http_user_agent"), 255),
                        "dst": endpoint(ev, "dest"),
                        "time": when,
                        "count": 1,
                    }
            elif kind == "tls":
                t = ev.get("tls") or {}
                sni = clip(t.get("sni"), 255)
                key = (sni, endpoint(ev, "dest"))
                item = tls.get(key)
                if item:
                    item["count"] += 1
                elif len(tls) < MAX_ITEMS:
                    tls[key] = {
                        "sni": sni,
                        "subject": clip(t.get("subject")),
                        "issuer": clip(t.get("issuerdn")),
                        "version": clip(t.get("version"), 20),
                        "notAfter": clip(t.get("notafter"), 40),
                        "dst": endpoint(ev, "dest"),
                        "time": when,
                        "count": 1,
                    }
    ordered = sorted(alerts.values(), key=lambda a: (a["severity"] or 9, -a["count"]))
    return {
        "alerts": ordered,
        "dns": list(dns.values()),
        "http": list(http.values()),
        "tls": list(tls.values()),
        "alertsTotal": total_alerts,
    }


def analyze(data, work):
    """Roda o Suricata no pcap, num processo filho com tempo-limite; devolve o resumo."""
    pcap = os.path.join(work, "captura.pcap")
    out = os.path.join(work, "saida")
    os.makedirs(out)
    with open(pcap, "wb") as f:
        f.write(data)
    rules = rules_info()
    started = time.monotonic()
    command = [
        "suricata",
        "-c",
        CONFIG,
        "-r",
        pcap,
        "-l",
        out,
        # O MikroTik copia o quadro antes do offload de checksum: sem isto, o Suricata descarta.
        "-k",
        "none",
        "-s",
        LOCAL_RULES,
        "--set",
        "logging.outputs.1.file.enabled=no",
    ]
    try:
        proc = run_watched(command, TIMEOUT, cwd=work)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"tempo esgotado ({TIMEOUT} s)", "version": VERSION}
    ms = int((time.monotonic() - started) * 1000)
    if proc.returncode != 0:
        lines = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        errors = [l for l in lines if "Error" in l or "error" in l] or lines[-1:] or ["sem detalhes"]
        return {"ok": False, "error": f"o Suricata falhou: {errors[-1][:200]}", "version": VERSION, "ms": ms}
    result = summarize(os.path.join(out, "eve.json"))
    result.update({"ok": True, "version": VERSION, "rules": rules, "ms": ms})
    return result


def retire(server):
    """Sai depois de responder (ver apps/capa/server.py): primeiro para de aceitar conexoes."""
    wait = MIN_UPTIME_S - (time.monotonic() - STARTED)
    if wait > 0:
        time.sleep(wait)
    server.shutdown()


class Handler(BaseHTTPRequestHandler):
    server_version = "deeplook-suricata"
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
            if _retiring.is_set():
                state = "trocando"
            elif _updating.is_set():
                state = "atualizando"
            elif _busy.locked():
                state = "analisando"
            else:
                state = "livre"
            self.send(200, {"ok": True, "state": state, "suricata": VERSION, "rules": rules_info()})
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
        work = tempfile.mkdtemp(prefix="suricata-", dir="/tmp")
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.send(400, {"error": "corpo incompleto"})
                return
            if data[:4] not in (b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4", b"\x0a\x0d\x0d\x0a"):
                self.send(200, {"ok": False, "error": "o arquivo não é um pcap", "version": VERSION})
                return
            if RECYCLE:
                _retiring.set()
            _request.sock = self.connection
            try:
                result = analyze(data, work)
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
        log("SURICATA_TOKEN ausente ou curto (16+ caracteres).")
        sys.exit(1)
    log(f"ouvindo na porta {PORT} (Suricata {VERSION}, {rules_info()['count']} regras)")
    threading.Thread(target=updater, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    server.server_close()
    time.sleep(1)
    log("trabalho concluido: saindo para o Docker subir um container limpo")
    os._exit(0)


if __name__ == "__main__":
    main()
