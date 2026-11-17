"""Descompila um JAR ou .class com o CFR e resume o resultado (plans/caca-e-formatos, Java).

Uso: analyze.py <arquivo>. Escreve um JSON no stdout:
- module: nome, classe principal, agente, versao do bytecode e do manifesto;
- types: os arquivos .java (um por classe), com o tamanho e as linhas;
- findings: o que as regras acharam no codigo (o arquivo, a linha e o trecho);
- obfuscators: os ofuscadores reconhecidos pelas marcas e pelos nomes;
- resources: os arquivos embutidos no JAR (PE, ELF, Mach-O, ZIP, scripts e blobs cifrados); os que
  viram amostras filhas vao em Base64 (data);
- urls: as URLs que aparecem no codigo;
- sources: o texto de cada .java (cortado), que a API guarda no armazenamento.
Nada e executado: o CFR so le o bytecode.
"""

import base64
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import zipfile

CFR = os.environ.get("CFR_JAR", "/opt/cfr/cfr.jar")
TIMEOUT = int(os.environ.get("JAR_DECOMPILE_S", "150"))
# Tetos contra JAR malicioso (bomba de descompressao, milhares de classes).
MAX_ENTRIES = 50_000
MAX_CLASS_BYTES = 192 * 1024 * 1024
MAX_SOURCE_FILE = 512 * 1024
MAX_SOURCES = 16 * 1024 * 1024
MAX_FINDINGS = 300
MAX_RESOURCES = 500
MAX_RESOURCE_READ = 16 * 1024 * 1024
MAX_RESOURCE_DATA = 16 * 1024 * 1024
MAX_RESOURCES_DATA = 32 * 1024 * 1024
MAX_URLS = 200
MAX_MANIFEST = 30
# Classes lidas so para saber a versao do bytecode.
VERSION_SCAN = 2000

# (id, nivel, regra, por que)
RULES = [
    ("exec", "high", r"\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|\bnew\s+ProcessBuilder\s*\(", "inicia outro programa ou comando do sistema"),
    ("classloader", "high", r"\bdefineClass\s*\(|\bURLClassLoader\b|\bnew\s+(?:\w+\.)*ClassLoader\s*\(", "carrega classes a partir de bytes ou de uma URL (carga em memória)"),
    ("reflection", "medium", r"\.\s*(?:getDeclaredMethod|getMethod|getDeclaredConstructor)\s*\(", "chama métodos por reflexão"),
    ("network", "medium", r"\bHttpURLConnection\b|\bHttpClient\b|\bnew\s+URL\s*\(|\bnew\s+Socket\s*\(|\bDatagramSocket\b", "acessa a rede (download de carga ou envio de dados)"),
    ("crypto", "medium", r"\bCipher\s*\.\s*getInstance\s*\(|\bSecretKeySpec\b", "cifra ou decifra conteúdo (carga ou configuração cifrada)"),
    ("base64", "medium", r"\bBase64\s*\.\s*getDecoder\s*\(|\bDatatypeConverter\s*\.\s*parseBase64Binary\s*\(", "decodifica conteúdo em Base64"),
    ("native", "medium", r"\bSystem\s*\.\s*(?:load|loadLibrary)\s*\(|\bsun\s*\.\s*misc\s*\.\s*Unsafe\b|\bUnsafe\s*\.\s*getUnsafe\b", "carrega código nativo ou mexe na memória (Unsafe)"),
    ("script-engine", "medium", r"\bScriptEngineManager\b|\bgetEngineByName\s*\(", "executa script (JavaScript) em tempo de execução"),
    ("jndi", "medium", r"\bnew\s+InitialContext\s*\(|\bInitialContext\b[^;\n]{0,80}\.\s*lookup\s*\(", "consulta JNDI (vetor de execução remota, como o Log4Shell)"),
    ("deserialization", "medium", r"\bnew\s+ObjectInputStream\s*\(", "desserializa objetos (execução por gadget)"),
    ("persistence", "high", r"CurrentVersion\\\\+Run|\.bashrc|\.zshrc|\bcrontab\b|LaunchAgents|LaunchDaemons|Start Menu\\\\+Programs\\\\+Startup|/etc/rc\.local", "grava em local de inicialização (persistência)"),
    ("screen-keys", "medium", r"\bjava\.awt\.Robot\b|\bnew\s+Robot\s*\(|\bcreateScreenCapture\s*\(|\bGlobalScreen\b|\bNativeKeyListener\b", "tira print da tela ou captura teclas"),
    ("browser-data", "high", r"Login Data|logins\.json|key4\.db|wallet\.dat|Local State|Cookies\.sqlite", "lê dados de navegador ou carteira (credenciais)"),
    ("discord-telegram", "medium", r"api\.telegram\.org|discord(?:app)?\.com/api/webhooks", "envia dados por Telegram ou Discord"),
    ("minecraft-session", "high", r"\.\s*getSession\s*\(\s*\)\s*\.\s*(?:getToken|getAccessToken|getSessionID|getSessionId|func_148254_d)\s*\(", "lê o token da sessão do Minecraft (roubo de conta)"),
    ("agent", "medium", r"\bjava\.lang\.instrument\b|\bVirtualMachine\s*\.\s*attach\s*\(", "agente Java ou anexa a outra JVM"),
    ("anti-vm", "medium", r"VBoxService|vmtoolsd|VirtualBox|VMware|SbieDll", "procura máquina virtual ou sandbox (anti-análise)"),
]
# Identificadores do Java diferenciam maiusculas (uRLClassLoader nao e URLClassLoader); so as regras
# sobre texto (caminhos, nomes de produto, URLs) ignoram a caixa.
TEXT_RULES = {"persistence", "browser-data", "discord-telegram", "anti-vm"}
COMPILED = [(i, lvl, re.compile(rx, re.I if i in TEXT_RULES else 0), why) for i, lvl, rx, why in RULES]

# (ofuscador, regra sobre o codigo inteiro)
OBFUSCATORS = [
    ("Allatori", re.compile(r"ALLATORI")),
    ("Zelix KlassMaster", re.compile(r"\bZKM\b|Zelix")),
    ("Stringer", re.compile(r"com\.licel\.stringer|licel")),
    ("DashO", re.compile(r"\bDashO\b|com\.preemptive")),
    ("Skidfuscator", re.compile(r"skidfuscator", re.I)),
    ("Paramorphism", re.compile(r"paramorphism", re.I)),
    ("Radon", re.compile(r"me\.itzsomebody\.radon")),
    ("Qprotect", re.compile(r"qprotect", re.I)),
]
URL_RE = re.compile(r"\bhttps?://[^\s\"'<>`\\)]{4,300}", re.I)
SCRIPT_EXTS = (".sh", ".ps1", ".bat", ".cmd", ".vbs", ".js", ".py", ".hta")
FAILED_RE = re.compile(r"Exception decompiling|Decompilation failed|Unable to fully structure|couldn't be decompiled", re.I)


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = len(data)
    return -sum(c / n * math.log2(c / n) for c in counts if c)


def kind_of(name, data):
    if data[:2] == b"MZ":
        return "pe"
    if data[:4] == b"\x7fELF":
        return "elf"
    if data[:4] in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce"):
        return "macho"
    if data[:4] == b"\xca\xfe\xba\xbe":
        return "class"
    if data[:4] == b"PK\x03\x04":
        return "zip"
    if name.lower().endswith(SCRIPT_EXTS) or data[:2] == b"#!":
        return "script"
    return None


def java_version(major):
    if major < 45:
        return None
    return f"Java {major - 44}" if major >= 49 else f"Java 1.{major - 44}"


def parse_manifest(text):
    """Atributos principais do MANIFEST.MF (as linhas de continuacao comecam com um espaco)."""
    lines = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw.startswith(" ") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    attrs = {}
    for line in lines:
        if not line.strip():
            break  # fim da secao principal
        key, sep, value = line.partition(":")
        if sep and len(attrs) < MAX_MANIFEST:
            attrs[key.strip()[:60]] = value.strip()[:200]
    return attrs


def short_names(class_paths):
    """Proporcao de classes com nome de 1 ou 2 letras (ProGuard e parecidos)."""
    names = [p.rsplit("/", 1)[-1][: -len(".class")] for p in class_paths]
    names = [n for n in names if "$" not in n]
    if len(names) < 20:
        return False
    return sum(1 for n in names if len(n) <= 2) / len(names) > 0.5


def odd_names(class_paths):
    """Proporcao de classes com caracteres fora do ASCII (ofuscador sem nome conhecido)."""
    names = [p.rsplit("/", 1)[-1] for p in class_paths]
    if len(names) < 20:
        return False
    return sum(1 for n in names if any(ord(c) > 127 or not (c.isalnum() or c in "_$.") for c in n)) / len(names) > 0.5


def inspect_jar(path):
    """Manifesto, versao do bytecode, nomes das classes e os arquivos embutidos."""
    info = {"manifest": {}, "major": None, "class_paths": [], "resources": [], "error": None}
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        info["error"] = "o arquivo não é um JAR válido (ZIP corrompido)"
        return info
    with zf:
        entries = zf.infolist()
        if len(entries) > MAX_ENTRIES:
            info["error"] = f"JAR com {len(entries)} entradas (limite {MAX_ENTRIES})"
            return info
        class_bytes = sum(e.file_size for e in entries if e.filename.endswith(".class"))
        if class_bytes > MAX_CLASS_BYTES:
            info["error"] = "o conteúdo descompactado das classes passa do limite (possível bomba de descompressão)"
            return info
        resource_data = 0
        major = 0
        scanned = 0
        for e in entries:
            name = e.filename
            if e.is_dir() or name.startswith("/") or ".." in name.split("/"):
                continue
            if name.endswith(".class"):
                info["class_paths"].append(name)
                if scanned < VERSION_SCAN:
                    scanned += 1
                    with zf.open(e) as f:
                        head = f.read(8)
                    if len(head) == 8 and head[:4] == b"\xca\xfe\xba\xbe":
                        major = max(major, int.from_bytes(head[6:8], "big"))
                continue
            if name == "META-INF/MANIFEST.MF" and e.file_size <= 256 * 1024:
                info["manifest"] = parse_manifest(zf.read(e).decode("utf-8", "replace"))
                continue
            if e.file_size == 0 or e.file_size > MAX_RESOURCE_READ or len(info["resources"]) >= MAX_RESOURCES:
                continue
            data = zf.read(e)
            kind = kind_of(name, data)
            ent = round(entropy(data[: 1 << 20]), 2)
            # So o que interessa: executaveis, pacotes, scripts e blobs grandes e cifrados.
            if kind is None and not (len(data) >= 64 * 1024 and ent > 7.2):
                continue
            item = {
                "name": name,
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "kind": kind,
                "entropy": ent,
            }
            if kind in ("pe", "elf", "macho", "zip", "script") and len(data) <= MAX_RESOURCE_DATA and resource_data + len(data) <= MAX_RESOURCES_DATA:
                item["data"] = base64.b64encode(data).decode()
                resource_data += len(data)
            info["resources"].append(item)
        info["major"] = major or None
    return info


def main():
    sample = sys.argv[1]
    with open(sample, "rb") as f:
        magic = f.read(4)
    is_jar = magic == b"PK\x03\x04"
    work = tempfile.mkdtemp(prefix="cfr-", dir=os.path.dirname(os.path.abspath(sample)))
    target = os.path.join(work, "Amostra.jar" if is_jar else "Amostra.class")
    os.symlink(os.path.abspath(sample), target)
    out = os.path.join(work, "out")

    info = {"manifest": {}, "major": None, "class_paths": [], "resources": [], "error": None}
    if is_jar:
        info = inspect_jar(sample)
        if info["error"]:
            print(json.dumps({"ok": False, "error": info["error"]}))
            return
        if not info["class_paths"]:
            print(json.dumps({"ok": False, "error": "o JAR não tem nenhuma classe Java"}))
            return
    elif magic != b"\xca\xfe\xba\xbe":
        print(json.dumps({"ok": False, "error": "não é um JAR nem um .class"}))
        return
    else:
        with open(sample, "rb") as f:
            head = f.read(8)
        info["major"] = int.from_bytes(head[6:8], "big") if len(head) == 8 else None
        info["class_paths"] = ["Amostra.class"]

    try:
        proc = subprocess.run(
            [
                "java", "-XX:-UsePerfData", "-XX:MaxRAMPercentage=60", "-XX:+ExitOnOutOfMemoryError",
                "-Djava.io.tmpdir=/tmp", "-jar", CFR, target,
                "--outputdir", out, "--silent", "true", "--showversion", "false",
            ],
            capture_output=True,
            timeout=TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": f"o CFR não terminou em {TIMEOUT} s"}))
        return

    files = []
    for base, _dirs, names in os.walk(out):
        for name in names:
            path = os.path.join(base, name)
            if name.endswith(".java") and os.path.isfile(path) and not os.path.islink(path):
                files.append((os.path.relpath(path, out).replace(os.sep, "/"), path))
    files.sort()
    if not files:
        err = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        reason = "o CFR não descompilou o arquivo: " + (err[0] if err else "sem detalhes")[:200]
        print(json.dumps({"ok": False, "error": reason}))
        return

    types, findings, sources, urls = [], [], {}, []
    seen_urls = set()
    total_source = 0
    failed = 0
    all_text = []
    for rel, path in files:
        with open(path, "rb") as f:
            data = f.read()
        text = data.decode("utf-8", "replace")
        all_text.append(text)
        lines = text.splitlines()
        types.append({"path": rel, "size": len(data), "lines": len(lines)})
        if FAILED_RE.search(text):
            failed += 1
        for n, line in enumerate(lines, 1):
            # import e package nomeiam a classe sem usa-la: so o uso conta.
            skip_rules = line.lstrip().startswith(("import ", "package "))
            for rid, level, rx, why in COMPILED:
                if skip_rules:
                    break
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

    text = "\n".join(all_text)
    obfuscators = [name for name, rx in OBFUSCATORS if rx.search(text)]
    if not obfuscators and short_names(info["class_paths"]):
        obfuscators.append("ProGuard")
    if not obfuscators and odd_names(info["class_paths"]):
        # Sem nome: a API mostra "nomes ilegiveis" (o texto fica do lado dela, traduzido).
        obfuscators.append("unknown")

    manifest = info["manifest"]
    module = {
        "name": manifest.get("Implementation-Title") or manifest.get("Bundle-Name") or None,
        "mainClass": manifest.get("Main-Class") or None,
        "agentClass": manifest.get("Premain-Class") or manifest.get("Agent-Class") or manifest.get("Launcher-Agent-Class") or None,
        "javaVersion": java_version(info["major"]) if info["major"] else None,
        "createdBy": manifest.get("Created-By") or None,
        "classes": len(info["class_paths"]),
    }
    print(json.dumps({
        "ok": True,
        "module": module,
        "types": types,
        "findings": findings,
        "obfuscators": obfuscators,
        "resources": info["resources"],
        "urls": urls,
        "sources": sources,
        "failed": failed,
        "truncated": total_source >= MAX_SOURCES,
    }))


if __name__ == "__main__":
    main()
