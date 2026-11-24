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


def api_text(value):
    """A 1.x escrevia o modulo em maiusculas (KERNEL32.CreateFileA); o 2.x usa minusculas."""
    name = text(value, 200)
    if not name:
        return name
    module, dot, rest = name.partition(".")
    return f"{module.upper()}.{rest}" if dot else name


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
    """O perfil do Speakeasy 2.x, com o tempo e o teto de chamadas daqui."""
    return {
        "config_version": "2.0",
        "limits": {
            "per_run_time": RUN_S,
            "api_calls": MAX_API_CALLS,
        },
        "memory": {"strings": True},
    }


# Eventos do relatorio 2.x que viram as listas do resumo. Os nomes a esquerda sao os do
# EventType; os da direita sao os que a API e a tela ja mostravam na 1.x.
FILE_EVENTS = {
    "file_create": "create",
    "file_open": "open",
    "file_read": "read",
    "file_write": "write",
    "file_delete": "delete",
    "directory_create": "directory_create",
    "directory_delete": "directory_delete",
}
REG_EVENTS = {
    "reg_open_key": "open_key",
    "reg_create_key": "create_key",
    "reg_read_value": "read_value",
    "reg_write_value": "write_value",
    "reg_list_subkeys": "list_subkeys",
    "reg_delete_key": "delete_key",
    "reg_delete_value": "delete_value",
}
PROC_EVENTS = {
    "process_create": "create",
    "thread_create": "thread_create",
    "thread_inject": "thread_inject",
    "mem_alloc": "mem_alloc",
    "mem_write": "mem_write",
    "mem_read": "mem_read",
    "mem_protect": "mem_protect",
}


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

    for run in report.get("runs") or []:
        calls = run.get("api_call_count")
        calls = calls if isinstance(calls, int) else 0
        total += calls
        err = run.get("error") or {}
        entry_points.append(
            {
                "type": text(run.get("type"), 120),
                "start": text(run.get("start_address"), 40),
                "apis": calls,
                "error": text(err.get("type"), 120) if err else None,
            }
        )
        if err:
            errors.append(
                {
                    "entry": text(run.get("type"), 120),
                    "type": text(err.get("type"), 120),
                    "api": api_text(err.get("api_name")),
                    "pc": text(err.get("pc"), 40),
                    "instr": text(err.get("instruction"), 200),
                }
            )
        for event in run.get("events") or []:
            name = event.get("event")
            if name == "api":
                api = api_text(event.get("api_name")) or "?"
                count = event.get("calls")
                count = count if isinstance(count, int) and count > 0 else 1
                found = apis.get(api)
                if found:
                    found["count"] += count
                elif len(apis) < MAX_APIS:
                    apis[api] = {
                        "name": api,
                        "count": count,
                        "order": order,
                        "args": [
                            text((arg or {}).get("display") or (arg or {}).get("value"), 200)
                            for arg in (event.get("args") or [])[:6]
                        ],
                        "ret": text(event.get("return_value"), 60),
                    }
                    order += 1
            elif name in FILE_EVENTS:
                path = text(event.get("path"))
                mapped = FILE_EVENTS[name]
                if path and len(files) < MAX_ITEMS and once(("file", mapped, path)):
                    files.append({"event": mapped, "path": path})
            elif name in REG_EVENTS:
                path = text(event.get("path"))
                mapped = REG_EVENTS[name]
                value = text(event.get("value_name"), 200)
                if path and len(registry) < MAX_ITEMS and once(("reg", mapped, path, value)):
                    registry.append({"event": mapped, "path": path, "value": value})
            elif name == "net_dns":
                query = text(event.get("query"), 300)
                if query and len(dns) < MAX_ITEMS and once(("dns", query)):
                    dns.append({"query": query, "response": text(event.get("response"), 300)})
            elif name in ("net_traffic", "net_http"):
                server = text(event.get("server"), 300)
                port = event.get("port")
                if len(traffic) < MAX_ITEMS and once(("net", server, port, event.get("proto"))):
                    traffic.append(
                        {
                            "server": server,
                            "port": port if isinstance(port, int) else None,
                            "proto": text(event.get("proto"), 40),
                            "method": text(event.get("method"), 20),
                            "url": None,
                        }
                    )
            elif name in PROC_EVENTS:
                if len(processes) >= MAX_ITEMS:
                    continue
                item = {
                    "event": PROC_EVENTS[name],
                    "pid": event.get("pid") if isinstance(event.get("pid"), int) else None,
                    "path": text(event.get("path")),
                    "cmdline": text(event.get("command_line")),
                    "protect": text(event.get("permissions"), 60),
                    "size": event.get("size") if isinstance(event.get("size"), int) else None,
                }
                if once(("proc", json.dumps(item, sort_keys=True))):
                    processes.append(item)
        for dropped_file in run.get("dropped_files") or []:
            path = text(dropped_file.get("path"))
            sha = text(dropped_file.get("sha256"), 64)
            if path and len(dropped) < MAX_ITEMS and once(("drop", path, sha)):
                dropped.append({"path": path, "size": dropped_file.get("size"), "sha256": sha})
        dynamic += len(run.get("dynamic_code") or [])

    # Erros que nao pertencem a uma execucao (imagem invalida, por exemplo).
    for err in report.get("errors") or []:
        if len(errors) >= 50:
            break
        errors.append(
            {
                "entry": None,
                "type": text(err.get("type"), 120),
                "api": api_text(err.get("api_name")),
                "pc": text(err.get("pc"), 40),
                "instr": text(err.get("instruction"), 200),
            }
        )

    # O tamanho do arquivo largado e o da escrita; o mesmo caminho pode aparecer com 0 numa thread.
    best = {}
    for item in dropped:
        prev = best.get(item["path"])
        if not prev or (item.get("size") or 0) > (prev.get("size") or 0):
            best[item["path"]] = item
    dropped = list(best.values())

    strings = []
    memory = (report.get("strings") or {}).get("in_memory") or {}
    static = (report.get("strings") or {}).get("static") or {}
    known = set(static.get("ansi") or []) | set(static.get("unicode") or [])
    for value in (memory.get("ansi") or []) + (memory.get("unicode") or []):
        if len(strings) >= MAX_STRINGS:
            break
        if isinstance(value, str) and len(value) >= 6 and value not in known and once(("str", value)):
            strings.append(text(value))

    return {
        "ok": True,
        "kind": kind,
        "arch": text(report.get("arch"), 20) or arch,
        "filetype": text(report.get("file_type"), 40),
        "runtimeS": round(float(report.get("emulation_total_runtime") or 0), 2),
        "apiTotal": total,
        "apis": sorted(apis.values(), key=lambda item: item["order"]),
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
            se.run_module(module)
    except Exception as exc:  # noqa: BLE001 - PE que o Speakeasy nao carrega vira resposta legivel
        # O que ja rodou antes da falha (um ponto de entrada que quebrou no meio) ainda vale.
        try:
            report = se.get_report().model_dump(mode="json")
        except Exception:  # noqa: BLE001 - nem carregou
            report = {}
        if not report.get("runs"):
            print(json.dumps({"ok": False, "error": f"o Speakeasy não emulou o arquivo: {text(exc, 200)}"}))
            return
    report = se.get_report().model_dump(mode="json")
    with open(args.sample, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    out = summarize(report, args.kind, args.arch)
    out["sha256"] = report.get("sha256") or sha
    out["memory"] = memory_report(se)
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
