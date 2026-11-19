"""Variantes dos PEs de teste (item 7.1): Rich header, checksum, overlay e UPX disfarcado."""
import hashlib
import io
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

