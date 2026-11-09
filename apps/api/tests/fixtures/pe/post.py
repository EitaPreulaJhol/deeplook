"""Variantes dos PEs de teste (item 7.1): Rich header, checksum, overlay e UPX disfarcado."""
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
shutil.copy(f'{W}/upx64.exe', f'{W}/upx-disfarcado.exe')
data = bytearray(open(f'{W}/upx-disfarcado.exe', 'rb').read())
pe = pefile.PE(data=bytes(data))
for sec, name in zip(pe.sections, [b'.text', b'.data', b'.rsrc', b'.idata']):
    off = sec.get_file_offset()
    data[off:off + 8] = name.ljust(8, b'\0')
head = min(s.PointerToRawData for s in pe.sections if s.PointerToRawData) + 0x1000
i = data.find(b'UPX!')
while 0 <= i < head:
    data[i:i + 4] = b'\0\0\0\0'
    i = data.find(b'UPX!', i + 4)
open(f'{W}/upx-disfarcado.exe', 'wb').write(bytes(data))

# Assinado e depois adulterado: um byte do codigo trocado.
data = bytearray(open(f'{W}/assinado.exe', 'rb').read())
pe = pefile.PE(data=bytes(data), fast_load=True)
text = pe.sections[0]
mid = text.PointerToRawData + text.SizeOfRawData // 2
data[mid] ^= 0xFF
open(f'{W}/adulterado.exe', 'wb').write(bytes(data))
print('post ok')
