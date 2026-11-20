"""Pacotes da web (plans/analise-estatica-ampliada, item 20): ASAR do Electron, extensao do Chrome
(CRX2 e CRX3) e do Firefox (XPI). Viram filhas o codigo (JS, HTML, scripts), os binarios nativos
(.node, PE, ELF) e os manifestos; imagens, fontes e traducoes ficam de fora. O manifesto da
extensao (permissoes, hosts, content scripts) vai para a ficha.

- ASAR: [4][tamanho do pickle][tamanho do payload][tamanho do JSON][JSON], depois os arquivos; o
  JSON diz o tamanho e o deslocamento de cada um (os `unpacked` ficam fora do pacote).
- CRX2: "Cr24", 2, tamanho da chave, tamanho da assinatura, depois o ZIP; CRX3: "Cr24", 3,
  tamanho do cabecalho (protobuf), depois o ZIP.
- XPI: o proprio ZIP.
"""

import json
import os
import struct
import zipfile

from common import UnpackError

NAME = "webpkg"
LABEL = "Pacote da web (ASAR, CRX, XPI)"
MAX_ENTRIES = 20000
MAX_FILE = 64 * 1024 * 1024
KEEP = {
    "js", "mjs", "cjs", "jsx", "ts", "html", "htm", "json", "node", "wasm", "exe", "dll", "so",
    "dylib", "bat", "cmd", "ps1", "vbs", "sh", "py",
}
# Permissoes que dao muito poder a extensao.
RISKY = {
    "<all_urls>", "*://*/*", "http://*/*", "https://*/*", "nativeMessaging", "debugger", "proxy",
    "webRequestBlocking", "declarativeNetRequest", "cookies", "history", "management",
    "clipboardRead", "privacy", "downloads", "scripting", "tabs", "webRequest",
}


def kind_of(data):
    if data[:4] == b"Cr24" and len(data) >= 16:
        return "crx"
    if data[:4] == b"\x04\x00\x00\x00" and data[16:24] == b'{"files"':
        return "asar"
    if data[:4] == b"PK\x03\x04" and b"manifest.json" in data[-65536:]:
        return "xpi"
    return None


def detect(data):
    return kind_of(data) is not None


def wanted(name):
    base = name.rsplit("/", 1)[-1].lower()
    ext = base.rsplit(".", 1)[-1] if "." in base else ""
    if ext == "json":
        return base in ("manifest.json", "package.json")
    return ext in KEEP


def priority(name):
    """O codigo do proprio app antes das dependencias (o teto de arquivos corta o fim da lista)."""
    low = name.lower()
    return (
        0 if low.rsplit("/", 1)[-1] in ("manifest.json", "package.json") and low.count("/") <= 1 else
        1 if "node_modules/" not in low and not low.endswith(".node") else
        2 if low.endswith(".node") else 3,
        low,
    )


def write(outdir, name, blob):
    target = os.path.realpath(os.path.join(outdir, name.lstrip("/")))
    if not target.startswith(os.path.realpath(outdir) + os.sep):
        return None
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as f:
        f.write(blob)
    return target


def asar_files(data):
    try:
        json_len = struct.unpack_from("<I", data, 12)[0]
        pickle_size = struct.unpack_from("<I", data, 4)[0]
        header = json.loads(data[16:16 + json_len].decode("utf-8"))
    except (struct.error, ValueError, UnicodeDecodeError) as exc:
        raise UnpackError(f"cabeçalho do ASAR ilegível: {exc}"[:200])
    base = 8 + pickle_size
    out, stack = [], [("", header)]
    while stack and len(out) < MAX_ENTRIES:
        prefix, node = stack.pop()
        for name, item in (node.get("files") or {}).items():
            path = f"{prefix}{name}"
            if "files" in item:
                stack.append((f"{path}/", item))
            elif not item.get("unpacked") and "offset" in item:
                size, offset = int(item.get("size", 0)), base + int(item["offset"])
                if 0 < size <= MAX_FILE and offset + size <= len(data):
                    out.append((path, data[offset:offset + size]))
    return out


def zip_files(blob):
    import io
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise UnpackError(f"o ZIP do pacote está corrompido: {exc}"[:200])
    out = []
    for info in archive.infolist()[:MAX_ENTRIES]:
        if info.is_dir() or info.file_size > MAX_FILE:
            continue
        try:
            out.append((info.filename, archive.read(info)))
        except Exception:  # noqa: BLE001 - entrada cifrada ou corrompida: fica de fora
            continue
    return out


def crx_zip(data):
    version = struct.unpack_from("<I", data, 4)[0]
    if version == 2:
        key_len, sig_len = struct.unpack_from("<II", data, 8)
        return data[16 + key_len + sig_len:], 2
    if version == 3:
        header_len = struct.unpack_from("<I", data, 8)[0]
        return data[12 + header_len:], 3
    raise UnpackError(f"versão do CRX desconhecida: {version}")


def strings(value, limit=50):
    if isinstance(value, str):
        return [value[:200]]
    if isinstance(value, list):
        return [str(v)[:200] for v in value if isinstance(v, (str, int, float))][:limit]
    return []


def extension_info(manifest):
    """O que importa do manifest.json de uma extensao."""
    perms = strings(manifest.get("permissions")) + strings(manifest.get("optional_permissions"))
    hosts = strings(manifest.get("host_permissions"))
    # MV2 mistura hosts nas permissoes.
    hosts += [p for p in perms if "://" in p or p == "<all_urls>"]
    perms = [p for p in perms if "://" not in p and p != "<all_urls>"]
    scripts = []
    for cs in (manifest.get("content_scripts") or [])[:20]:
        if isinstance(cs, dict):
            scripts.append({"matches": strings(cs.get("matches"), 20), "js": strings(cs.get("js"), 20)})
    background = manifest.get("background") or {}
    gecko = ((manifest.get("browser_specific_settings") or manifest.get("applications") or {}).get("gecko") or {})
    info = {
        "name": str(manifest.get("name", ""))[:200],
        "version": str(manifest.get("version", ""))[:40],
        "manifestVersion": manifest.get("manifest_version") if isinstance(manifest.get("manifest_version"), int) else None,
        "permissions": sorted(set(perms))[:60],
        "hostPermissions": sorted(set(hosts))[:60],
        "contentScripts": scripts,
        "background": strings(background.get("service_worker") or background.get("scripts") or background.get("page")),
        "updateUrl": str(manifest.get("update_url") or gecko.get("update_url") or "")[:300] or None,
        "geckoId": str(gecko.get("id") or "")[:200] or None,
        "externallyConnectable": strings((manifest.get("externally_connectable") or {}).get("matches")),
    }
    info["risky"] = sorted({p for p in perms + hosts if p in RISKY})
    return info


def unpack(path, outdir, timeout):
    with open(path, "rb") as f:
        data = f.read()
    kind = kind_of(data)
    crx_version = None
    if kind == "asar":
        entries = asar_files(data)
    elif kind == "crx":
        blob, crx_version = crx_zip(data)
        entries = zip_files(blob)
    elif kind == "xpi":
        entries = zip_files(data)
    else:
        raise UnpackError("não é um pacote ASAR, CRX ou XPI")
    if not entries:
        raise UnpackError("o pacote está vazio")
    package = {"kind": kind, "files": len(entries)}
    if crx_version:
        package["crxVersion"] = crx_version
    names = {n.lstrip("/"): b for n, b in entries}
    if "manifest.json" in names and kind in ("crx", "xpi"):
        try:
            package["extension"] = extension_info(json.loads(names["manifest.json"].decode("utf-8-sig")))
        except (ValueError, UnicodeDecodeError, AttributeError):
            package["extension"] = None
    if kind == "asar" and "package.json" in names:
        try:
            pkg = json.loads(names["package.json"].decode("utf-8-sig"))
            package["app"] = {
                "name": str(pkg.get("name", ""))[:200],
                "version": str(pkg.get("version", ""))[:40],
                "main": str(pkg.get("main", ""))[:300] or None,
            }
        except (ValueError, UnicodeDecodeError, AttributeError):
            pass
    files = []
    for name, blob in sorted(((n.lstrip("/"), b) for n, b in entries if wanted(n)), key=lambda x: priority(x[0])):
        target = write(outdir, name, blob)
        if target:
            files.append((name, target))
    skipped = len(entries) - len(files)
    note = f"{len(entries)} arquivo(s) no pacote" + (f"; {skipped} sem código (imagens, estilos, traduções) ficam de fora" if skipped else "")
    return {"files": files, "note": note, "package": package}
