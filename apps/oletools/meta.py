"""Metadados com o ExifTool (plans/analise-estatica-ampliada, item 19): POST /metadata.

Le o arquivo do argv[1] e escreve no stdout {ok, version, groups, fields}:
- groups: {grupo: {chave: valor}} (EXIF, XMP, PDF, FlashPix/XML do Office, LNK...), com teto de
  chaves e de tamanho; os grupos do proprio sistema (permissoes, caminho no container) ficam de fora;
- fields: o que liga documentos feitos do mesmo modelo (autores, ferramentas, IDs do XMP) e as datas
  de criacao e de modificacao, ja normalizados.
Nada e executado: o ExifTool so le.
"""

import json
import os
import re
import subprocess
import sys

EXIFTOOL = os.environ.get("EXIFTOOL", "/usr/bin/exiftool")
MAX_KEYS = 400
MAX_VALUE = 300
SKIP_GROUPS = {"System", "ExifTool", "SourceFile"}
KEEP_FILE = {"FileType", "FileTypeExtension", "MIMEType"}

AUTHOR_KEYS = {"Author", "Creator", "LastModifiedBy", "Company", "Manager", "Owner", "Artist"}
# Creator do Office e o autor; o do PDF e a ferramenta (o ExifTool chama os dois de Creator).
TOOL_KEYS = {"Producer", "CreatorTool", "Software", "Application", "AppVersion", "Generator"}
XMP_IDS = {"DocumentID", "InstanceID", "OriginalDocumentID", "DerivedFromDocumentID"}
CREATE_KEYS = {"CreateDate", "CreationDate", "DateTimeOriginal", "CreateTime"}
MODIFY_KEYS = {"ModifyDate", "ModDate", "MetadataDate", "LastSaved", "ModifyTime"}


def version():
    try:
        out = subprocess.run([EXIFTOOL, "-ver"], capture_output=True, timeout=30, check=False)
        return f"ExifTool {out.stdout.decode().strip()}"
    except Exception:  # noqa: BLE001 - versao e so informativa
        return None


def flat(value):
    if isinstance(value, (list, tuple)):
        return ", ".join(flat(v) for v in value)[:MAX_VALUE]
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)[:MAX_VALUE]
    return str(value)[:MAX_VALUE]


def main():
    path = sys.argv[1]
    proc = subprocess.run(
        [EXIFTOOL, "-j", "-G1", "-a", "-u", "-struct", "-charset", "filename=utf8", "--", path],
        capture_output=True,
        timeout=90,
        check=False,
    )
    try:
        doc = json.loads(proc.stdout.decode("utf-8", "replace"))[0]
    except (ValueError, IndexError):
        sys.stdout.write(json.dumps({"ok": False, "error": "o ExifTool não leu o arquivo", "version": version()}))
        return
    groups, count = {}, 0
    authors, tools, ids, created, modified = [], [], [], [], []

    def add(lst, value):
        v = flat(value).strip()
        if v and v not in lst and len(lst) < 20:
            lst.append(v)

    for full, value in doc.items():
        group, _, key = full.partition(":")
        if not key or group in SKIP_GROUPS or (group == "File" and key not in KEEP_FILE):
            continue
        if count >= MAX_KEYS:
            break
        groups.setdefault(group, {})[key] = flat(value)
        count += 1
        is_pdf = group == "PDF"
        if key in AUTHOR_KEYS and not (is_pdf and key == "Creator"):
            add(authors, value)
        if key in TOOL_KEYS or (is_pdf and key == "Creator"):
            add(tools, value)
        if group.startswith("XMP") and key in XMP_IDS:
            add(ids, value)
        if key in CREATE_KEYS:
            add(created, value)
        if key in MODIFY_KEYS:
            add(modified, value)
    # "uuid:..." e "xmp.did:..." identificam o mesmo documento: fica so o valor.
    ids = [re.sub(r"^(?:uuid|xmp\.(?:did|iid)|adobe:docid:[a-z]+):", "", i, flags=re.I) for i in ids]
    sys.stdout.write(json.dumps({
        "ok": True,
        "version": version(),
        "groups": groups,
        "keys": count,
        "fields": {
            "authors": authors,
            "tools": tools,
            "xmpIds": [i for i in dict.fromkeys(ids) if len(i) >= 8][:20],
            "created": created,
            "modified": modified,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
