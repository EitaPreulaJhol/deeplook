"""Emulacao com o Speakeasy (plans/novas-analises, item 4): roda num processo filho do server.py.

  python analyze.py <arquivo> [--kind pe|shellcode] [--arch x86|amd64]

Emula o PE (todos os pontos de entrada: TLS, o principal e as exportacoes de uma DLL) ou o
shellcode, com o perfil padrao do Speakeasy (rede, disco e registro simulados), e escreve no
stdout um resumo em JSON com tetos: a API guarda e mostra esse resumo, nunca o relatorio inteiro.
"""

import argparse
import base64
import hashlib
import json
import math
import os
import re
import struct
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


# ------------------------------------------------------------------ memoria ao fim (item 16)

# Blocos que o programa alocou (os da emulacao, PEB, TEB, pilha, modulos carregados, ficam de fora).
ALLOC_TAG = re.compile(
    r"^api\.(?:VirtualAlloc(?:Ex)?|NtAllocateVirtualMemory|ZwAllocateVirtualMemory|heap\.HeapAlloc|"
    r"RtlAllocateHeap|LocalAlloc|GlobalAlloc|MapViewOfFile(?:Ex)?|NtMapViewOfSection)",
    re.I,
)
MIN_REGION = 256
MAX_REGIONS = 30
MAX_REGION = 16 * 1024 * 1024
MAX_CARVED = 10
MAX_CARVED_BYTES = 32 * 1024 * 1024


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return round(-sum(c / n * math.log2(c / n) for c in counts if c), 2)


def pe_carve(data):
    """O PE no inicio da regiao, em formato de arquivo. O programa pode ter copiado o arquivo cru
    (secoes onde o arquivo as tem) ou mapeado a mao (secoes onde a memoria as tem): o lado com os
    dados decide. Mesma ideia do apps/extract/memdump.py (realign), que le o dump do sandbox."""
    try:
        if data[:2] != b"MZ":
            return None
        e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
        if e_lfanew > 0x1000 or data[e_lfanew:e_lfanew + 4] != b"PE\0\0":
            return None
        count = struct.unpack_from("<H", data, e_lfanew + 6)[0]
        opt_size = struct.unpack_from("<H", data, e_lfanew + 20)[0]
        table = e_lfanew + 24 + opt_size
        sections = []
        for i in range(min(count, 96)):
            off = table + i * 40
            vsize, va, raw_size, raw_ptr = struct.unpack_from("<IIII", data, off + 8)
            sections.append((off, vsize, va, raw_size, raw_ptr))
        filled = lambda at: bool(data[at:at + 64].strip(b"\0"))  # noqa: E731
        file_layout = any(
            raw_size and raw_ptr != va and filled(raw_ptr) and not filled(va)
            for _, _, va, raw_size, raw_ptr in sections
        )
        if file_layout:
            end = max([raw_ptr + raw_size for _, _, _, raw_size, raw_ptr in sections] + [0x400])
            return bytes(data[:end]) if end <= len(data) else None
        out = bytearray(data)
        end = 0
        for off, vsize, va, raw_size, _ in sections:
            size = max(vsize, raw_size)
            struct.pack_into("<II", out, off + 16, size, va)
            end = max(end, va + size)
        return bytes(out[:max(end, 0x400)])
    except struct.error:
        return None


def memory_report(se):
    """As regioes que o programa alocou e escreveu, ao fim da emulacao: o resumo de cada uma e os
    PEs achados nelas (em Base64, para virar amostras filhas)."""
    regions, carved, carved_bytes = [], [], 0
    try:
        blocks = se.get_memory_dumps()
    except Exception:  # noqa: BLE001 - versao do Speakeasy sem o dump
        return {"regions": [], "carved": []}
    for tag, base, size, is_free, _proc, data in blocks:
        if not tag or not ALLOC_TAG.match(tag) or not data:
            continue
        if size < MIN_REGION or size > MAX_REGION or not data.strip(b"\0"):
            continue
        if len(regions) >= MAX_REGIONS:
            break
        pe = pe_carve(data)
        item = {
            "tag": text(re.sub(r"\.0x[0-9a-f]+$", "", tag), 120),
            "base": hex(base),
            "size": size,
            "freed": bool(is_free),
            "kind": "pe" if pe else "data",
            "entropy": entropy(data[:65536]),
            "head": data[:32].hex(),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        if pe and len(carved) < MAX_CARVED and carved_bytes + len(pe) <= MAX_CARVED_BYTES:
            carved_bytes += len(pe)
            sha = hashlib.sha256(pe).hexdigest()
            item["carved"] = sha
            carved.append({"base": hex(base), "tag": item["tag"], "sha256": sha, "size": len(pe),
                           "data": base64.b64encode(pe).decode()})
        regions.append(item)
    return {"regions": regions, "carved": carved}


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
    out["memory"] = memory_report(se)
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
