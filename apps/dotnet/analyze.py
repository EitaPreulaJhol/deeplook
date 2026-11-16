"""Descompila um assembly .NET com o ilspycmd e resume o resultado (plans/caca-e-formatos, item 3).

Uso: analyze.py <assembly>. Escreve um JSON no stdout:
- module: nome, framework e tipo de saida (do .csproj que o ILSpy monta);
- types: os arquivos .cs (um por tipo), com o tamanho e as linhas;
- findings: o que as regras acharam no codigo (o arquivo, a linha e o trecho);
- obfuscators: os ofuscadores reconhecidos pelos atributos e pelos nomes;
- resources: os recursos embutidos, com o tipo; os PE e ZIP vao em Base64 (data);
- urls: as URLs que aparecem no codigo;
- sources: o texto de cada .cs (cortado), que a API guarda no armazenamento.
Nada e executado: o ILSpy so le o IL e os metadados.
"""

import base64
import hashlib
import math
import os
import re
import subprocess
import sys
import tempfile
import json

ILSPY = os.environ.get("ILSPY", "/opt/ilspy/ilspycmd")
TIMEOUT = int(os.environ.get("DOTNET_DECOMPILE_S", "150"))
MAX_SOURCE_FILE = 512 * 1024
MAX_SOURCES = 16 * 1024 * 1024
MAX_FINDINGS = 300
MAX_RESOURCE_DATA = 16 * 1024 * 1024
MAX_RESOURCES_DATA = 32 * 1024 * 1024
MAX_URLS = 200

# (id, nivel, regra, por que)
RULES = [
    ("assembly-load", "high", r"\bAssembly\s*\.\s*(?:Load|LoadFile|LoadFrom|UnsafeLoadFrom)\s*\(", "carrega um assembly a partir de bytes ou de um arquivo (carga em memória)"),
    ("invoke", "medium", r"\.\s*(?:EntryPoint|GetMethod\s*\([^)]*\))\s*\.\s*Invoke\s*\(|\bMethodInfo\b[^;\n]{0,200}\.Invoke\s*\(", "chama por reflexão um método carregado em tempo de execução"),
    ("download", "high", r"\b(?:WebClient|HttpClient|WebRequest|HttpWebRequest)\b[^;\n]{0,200}\b(?:Download(?:Data|String|File)(?:Async)?|GetByteArrayAsync|GetStringAsync|GetResponse|OpenRead)\b|\bnew\s+WebClient\s*\(", "baixa conteúdo da internet"),
    ("process-start", "high", r"\bProcess\s*\.\s*Start\s*\(|\bnew\s+ProcessStartInfo\b", "inicia outro programa"),
    ("run-key", "high", r"CurrentVersion\\\\+Run|CurrentVersion\\+Run", "grava na chave Run do registro (persistência)"),
    ("crypto", "medium", r"\b(?:RijndaelManaged|AesManaged|Aes\.Create|TripleDES|DESCryptoServiceProvider|RC2|CreateDecryptor)\b", "decifra conteúdo (carga ou configuração cifrada)"),
    ("base64", "medium", r"\bConvert\s*\.\s*FromBase64String\s*\(", "decodifica conteúdo em Base64"),
    ("native-memory", "high", r"\b(?:VirtualAlloc(?:Ex)?|VirtualProtect(?:Ex)?|WriteProcessMemory|CreateRemoteThread|NtUnmapViewOfSection|ZwUnmapViewOfSection|SetThreadContext|QueueUserAPC)\b", "mexe na memória de processos (injeção ou shellcode)"),
    ("anti-debug", "medium", r"\bDebugger\s*\.\s*IsAttached\b|\bIsDebuggerPresent\b|\bCheckRemoteDebuggerPresent\b", "procura depurador (anti-análise)"),
    ("anti-vm", "medium", r"Win32_ComputerSystem|Win32_BIOS|VBoxService|vmtoolsd|VirtualBox|VMware|SbieDll", "procura máquina virtual ou sandbox (anti-análise)"),
    ("browser-data", "high", r"Login Data|Web Data|logins\.json|key4\.db|wallet\.dat|\\Local State|Network\\+Cookies", "lê dados de navegador ou carteira (credenciais)"),
    ("keylogger", "medium", r"\bGetAsyncKeyState\b|\bSetWindowsHookEx\b", "captura teclas"),
    ("screenshot", "medium", r"\bCopyFromScreen\s*\(", "tira print da tela"),
    ("discord-telegram", "medium", r"api\.telegram\.org|discord(?:app)?\.com/api/webhooks", "envia dados por Telegram ou Discord"),
    ("defender", "high", r"Add-MpPreference|Set-MpPreference|DisableRealtimeMonitoring", "mexe no Defender"),
]
COMPILED = [(i, lvl, re.compile(rx, re.I), why) for i, lvl, rx, why in RULES]

# (ofuscador, regra sobre o codigo inteiro)
OBFUSCATORS = [
    ("ConfuserEx", re.compile(r"\bConfusedByAttribute\b|ConfuserEx")),
    (".NET Reactor", re.compile(r"\.NET Reactor|\bReactor\b[^\n]{0,40}Eziriz")),
    ("SmartAssembly", re.compile(r"\bSmartAssembly\b|\bPoweredByAttribute\b")),
    ("Eazfuscator.NET", re.compile(r"Eazfuscator|\{[0-9A-F-]{36}\}\s*\.Eaz")),
    ("Babel", re.compile(r"\bBabelAttribute\b|BabelObfuscator")),
    ("Dotfuscator", re.compile(r"\bDotfuscatorAttribute\b")),
    ("Agile.NET", re.compile(r"ObfuscatedByAgileDotNet|CliSecure")),
    ("Crypto Obfuscator", re.compile(r"CryptoObfuscator")),
]
URL_RE = re.compile(r"\bhttps?://[^\s\"'<>`\\)]{4,300}", re.I)


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return -sum(c / n * math.log2(c / n) for c in counts if c)


def kind_of(data):
    if data[:2] == b"MZ":
        return "pe"
    if data[:4] == b"PK\x03\x04":
        return "zip"
    if data[:4] == b"\xce\xca\xef\xbe":
        return "resources"
    if data[:3] in (b"\xff\xd8\xff",) or data[:4] in (b"\x89PNG", b"GIF8") or data[:2] == b"BM":
        return "imagem"
    if data[:4] == b"\x00\x00\x01\x00":
        return "ícone"
    return None


def unreadable_names(text):
    """Proporcao de identificadores com caracteres fora do ASCII (ofuscador sem nome conhecido)."""
    names = re.findall(r"(?:class|struct|void|static)\s+([^\s(<{:;]+)", text)
    if len(names) < 20:
        return False
    odd = sum(1 for n in names if any(ord(c) > 127 or not (c.isalnum() or c in "_@") for c in n))
    return odd / len(names) > 0.5


def main():
    sample = sys.argv[1]
    out = tempfile.mkdtemp(prefix="ilspy-", dir=os.path.dirname(os.path.abspath(sample)))
    try:
        proc = subprocess.run(
            [ILSPY, "-p", "-o", out, sample],
            capture_output=True,
            timeout=TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": f"o ILSpy não terminou em {TIMEOUT} s"}))
        return
    err = proc.stderr.decode("utf-8", "replace")
    files = []
    for base, _dirs, names in os.walk(out):
        for name in names:
            path = os.path.join(base, name)
            if os.path.isfile(path) and not os.path.islink(path):
                files.append((os.path.relpath(path, out).replace(os.sep, "/"), path))
    files.sort()
    if proc.returncode != 0 or not any(rel.endswith(".cs") for rel, _ in files):
        if re.search(r"MetadataFileNotSupported|PEFileNotSupported|not a \.NET|does not contain (?:any )?(?:a )?(?:managed |CLI )?metadata|BadImageFormat", err, re.I):
            reason = "não é um assembly .NET (sem metadados do CLR)"
        else:
            # A primeira linha e a excecao ("Tipo: mensagem"); as seguintes sao o stack trace.
            first = (err.strip().splitlines() or ["sem detalhes"])[0]
            reason = "o ILSpy não descompilou o arquivo: " + first.split(": ", 1)[-1][:200]
        print(json.dumps({"ok": False, "error": reason}))
        return

    module = {"name": None, "framework": None, "outputType": None}
    types, findings, sources, resources, urls = [], [], {}, [], []
    seen_urls = set()
    total_source = 0
    resource_data = 0
    all_text = []
    for rel, path in files:
        with open(path, "rb") as f:
            data = f.read()
        if rel.endswith(".csproj"):
            text = data.decode("utf-8", "replace")
            for key, tag in (("name", "AssemblyName"), ("framework", "TargetFramework"), ("outputType", "OutputType")):
                m = re.search(rf"<{tag}>([^<]{{1,200}})</{tag}>", text)
                if m:
                    module[key] = m.group(1)
            continue
        if rel.endswith(".cs"):
            text = data.decode("utf-8", "replace")
            all_text.append(text)
            lines = text.splitlines()
            types.append({"path": rel, "size": len(data), "lines": len(lines)})
            for n, line in enumerate(lines, 1):
                for rid, level, rx, why in COMPILED:
                    if len(findings) < MAX_FINDINGS and rx.search(line):
                        findings.append({"rule": rid, "level": level, "why": why, "path": rel, "line": n, "text": line.strip()[:300]})
                for m in URL_RE.finditer(line):
                    url = m.group(0).rstrip(".,;")
                    if url not in seen_urls and len(urls) < MAX_URLS:
                        seen_urls.add(url)
                        urls.append(url)
            if total_source < MAX_SOURCES:
                cut = text[:MAX_SOURCE_FILE]
                sources[rel] = cut
                total_source += len(cut)
            continue
        # O resto e recurso (embutido no assembly ou o .resx/.resources que o ILSpy extraiu).
        kind = kind_of(data)
        item = {
            "name": rel,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "kind": kind,
            "entropy": round(entropy(data[: 1 << 20]), 2),
        }
        if kind in ("pe", "zip") and len(data) <= MAX_RESOURCE_DATA and resource_data + len(data) <= MAX_RESOURCES_DATA:
            item["data"] = base64.b64encode(data).decode()
            resource_data += len(data)
        resources.append(item)

    text = "\n".join(all_text)
    obfuscators = [name for name, rx in OBFUSCATORS if rx.search(text)]
    if not obfuscators and unreadable_names(text):
        # Sem nome: a API mostra "nomes ilegiveis" (o texto fica do lado dela, traduzido).
        obfuscators.append("unknown")
    print(json.dumps({
        "ok": True,
        "module": module,
        "types": types,
        "findings": findings,
        "obfuscators": obfuscators,
        "resources": resources,
        "urls": urls,
        "sources": sources,
        "truncated": total_source >= MAX_SOURCES,
    }))


if __name__ == "__main__":
    main()
