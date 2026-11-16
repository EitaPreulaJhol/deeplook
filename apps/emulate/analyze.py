"""Emulacao com o Speakeasy (plans/novas-analises, item 4): roda num processo filho do server.py.

  python analyze.py <arquivo> [--kind pe|shellcode] [--arch x86|amd64]

Emula o PE (todos os pontos de entrada: TLS, o principal e as exportacoes de uma DLL) ou o
shellcode, com o perfil padrao do Speakeasy (rede, disco e registro simulados), e escreve no
stdout um resumo em JSON com tetos: a API guarda e mostra esse resumo, nunca o relatorio inteiro.
"""

import argparse
import hashlib
import json
import os
import sys

import speakeasy

RUN_S = int(os.environ.get("EMULATE_RUN_S", "60"))
MAX_API_CALLS = int(os.environ.get("EMULATE_MAX_API_CALLS", "20000"))
MAX_APIS = 400
MAX_ITEMS = 200
MAX_STRINGS = 300
MAX_TEXT = 500


def text(value, limit=MAX_TEXT):
    if value is None:
        return None
    value = str(value).replace("\x00", "")
    return value[:limit]


def config():
    """O perfil padrao do Speakeasy, com o tempo e o teto de chamadas daqui."""
    path = os.path.join(os.path.dirname(speakeasy.__file__), "configs", "default.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["timeout"] = RUN_S
    cfg["max_api_count"] = MAX_API_CALLS
    cfg.setdefault("analysis", {})["strings"] = True
    return cfg


def summarize(report, kind, arch):
    apis = {}
    order = 0
    files, registry, processes, dropped, errors, entry_points = [], [], [], [], [], []
    dns, traffic = [], []
    seen = set()
    dynamic = 0
    total = 0

    def once(key):
        if key in seen:
            return False
        seen.add(key)
        return True

    for ep in report.get("entry_points") or []:
        calls = ep.get("apis") or []
        total += len(calls)
        err = ep.get("error") or {}
        entry_points.append(
            {
                "type": text(ep.get("ep_type"), 120),
                "start": text(ep.get("start_addr"), 40),
                "apis": len(calls),
                "error": text(err.get("type"), 120) if err else None,
            }
        )
        if err:
            errors.append(
                {
                    "entry": text(ep.get("ep_type"), 120),
                    "type": text(err.get("type"), 120),
                    "api": text((err.get("api") or {}).get("name") if isinstance(err.get("api"), dict) else err.get("api_name"), 200),
                    "pc": text(err.get("pc"), 40),
                    "instr": text(err.get("instr"), 200),
                }
            )
        for call in calls:
            name = text(call.get("api_name"), 200) or "?"
            found = apis.get(name)
            if found:
                found["count"] += 1
            elif len(apis) < MAX_APIS:
                apis[name] = {
                    "name": name,
                    "count": 1,
                    "order": order,
                    "args": [text(a, 200) for a in (call.get("args") or [])[:6]],
                    "ret": text(call.get("ret_val"), 60),
                }
                order += 1
        for f in ep.get("file_access") or []:
            path = text(f.get("path"))
            event = text(f.get("event"), 40)
            if path and len(files) < MAX_ITEMS and once(("file", event, path)):
                files.append({"event": event, "path": path})
        for r in ep.get("registry_access") or []:
            path = text(r.get("path"))
            event = text(r.get("event"), 40)
            value = text(r.get("value_name") or r.get("value"), 200)
            if path and len(registry) < MAX_ITEMS and once(("reg", event, path, value)):
                registry.append({"event": event, "path": path, "value": value})
        net = ep.get("network_events") or {}
        for d in net.get("dns") or []:
            query = text(d.get("query"), 300)
            if query and len(dns) < MAX_ITEMS and once(("dns", query)):
                dns.append({"query": query, "response": text(d.get("response"), 300)})
        for t in net.get("traffic") or []:
            server = text(t.get("server"), 300)
            key = ("net", server, t.get("port"), t.get("proto"), t.get("url"))
            if len(traffic) < MAX_ITEMS and once(key):
                traffic.append(
                    {
                        "server": server,
                        "port": t.get("port") if isinstance(t.get("port"), int) else None,
                        "proto": text(t.get("proto"), 40),
                        "method": text(t.get("method"), 20),
                        "url": text(t.get("url") or t.get("uri"), 500),
                    }
                )
        for p in ep.get("process_events") or []:
            if len(processes) >= MAX_ITEMS:
                break
            event = text(p.get("event"), 40)
            item = {
                "event": event,
                "pid": p.get("pid") if isinstance(p.get("pid"), int) else None,
                "path": text(p.get("path")),
                "cmdline": text(p.get("cmdline")),
                "protect": text(p.get("protect"), 60),
                "size": p.get("size") if isinstance(p.get("size"), int) else None,
            }
            if once(("proc", json.dumps(item, sort_keys=True))):
                processes.append(item)
        for d in ep.get("dropped_files") or []:
            path = text(d.get("path"))
            sha = text(d.get("sha256"), 64)
            if path and len(dropped) < MAX_ITEMS and once(("drop", path, sha)):
                dropped.append({"path": path, "size": d.get("size"), "sha256": sha})
        dynamic += len(ep.get("dynamic_code_segments") or [])

    # O tamanho do arquivo largado e o da escrita; o mesmo caminho pode aparecer com 0 numa thread.
    best = {}
    for d in dropped:
        prev = best.get(d["path"])
        if not prev or (d.get("size") or 0) > (prev.get("size") or 0):
            best[d["path"]] = d
    dropped = list(best.values())

    strings = []
    memory = (report.get("strings") or {}).get("in_memory") or {}
    static = (report.get("strings") or {}).get("static") or {}
    known = set(static.get("ansi") or []) | set(static.get("unicode") or [])
    for s in (memory.get("ansi") or []) + (memory.get("unicode") or []):
        if len(strings) >= MAX_STRINGS:
            break
        if isinstance(s, str) and len(s) >= 6 and s not in known and once(("str", s)):
            strings.append(text(s))

    return {
        "ok": True,
        "kind": kind,
        "arch": text(report.get("arch"), 20) or arch,
        "filetype": text(report.get("filetype"), 40),
        "runtimeS": round(float(report.get("emulation_total_runtime") or 0), 2),
        "apiTotal": total,
        "apis": sorted(apis.values(), key=lambda a: a["order"]),
        "entryPoints": entry_points[:50],
        "files": files,
        "registry": registry,
        "network": {"dns": dns, "traffic": traffic},
        "processes": processes,
        "dropped": dropped,
        "dynamicCode": dynamic,
        "strings": strings,
        "errors": errors[:50],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sample")
    parser.add_argument("--kind", default="pe", choices=["pe", "shellcode"])
    parser.add_argument("--arch", default="x86", choices=["x86", "amd64"])
    args = parser.parse_args()
    # O Speakeasy registra no logging; o stdout fica so para o JSON.
    se = speakeasy.Speakeasy(config=config())
    try:
        if args.kind == "shellcode":
            addr = se.load_shellcode(args.sample, args.arch)
            se.run_shellcode(addr, offset=0)
        else:
            module = se.load_module(args.sample)
            se.run_module(module, all_entrypoints=True)
    except Exception as exc:  # noqa: BLE001 - PE que o Speakeasy nao carrega vira resposta legivel
        # O que ja rodou antes da falha (um ponto de entrada que quebrou no meio) ainda vale.
        try:
            report = se.get_report()
        except Exception:  # noqa: BLE001 - nem carregou
            report = {}
        if not (report or {}).get("entry_points"):
            print(json.dumps({"ok": False, "error": f"o Speakeasy não emulou o arquivo: {text(exc, 200)}"}))
            return
    report = se.get_report()
    with open(args.sample, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    out = summarize(report, args.kind, args.arch)
    out["sha256"] = sha
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
