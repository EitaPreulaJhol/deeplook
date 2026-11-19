"""Icone (2 imagens: DIB 16x16 e PNG 32x32), cursor com ponto quente e bitmap de 8 bits com paleta,
para os recursos do icone.exe (plans/analise-estatica-ampliada, item 30). Sem bibliotecas: os
formatos sao montados a mao, e o teste confere que o recurso remontado e igual byte a byte."""
import struct
import sys
import zlib

out = sys.argv[1]


def dib_icon(w, h, seed):
    """DIB de icone: cabecalho com altura dobrada (cor + mascara), pixels BGRA e mascara AND."""
    head = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    pixels = bytes((seed + i * 7) & 0xFF for i in range(w * h * 4))
    mask = b'\0' * (((w + 31) // 32) * 4 * h)
    return head + pixels + mask


def png(w, h):
    raw = b''.join(b'\0' + bytes((x * 8 + y) & 0xFF for x in range(w * 4)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def icon_file(kind, images):
    """ICONDIR + entradas de 16 bytes + imagens, na ordem (como o Windows grava)."""
    data = struct.pack('<HHH', 0, kind, len(images))
    offset = 6 + 16 * len(images)
    body = b''
    for head8, img in images:
        data += head8 + struct.pack('<II', len(img), offset)
        offset += len(img)
        body += img
    return data + body


ico = icon_file(1, [
    (struct.pack('<BBBBHH', 16, 16, 0, 0, 1, 32), dib_icon(16, 16, 3)),
    (struct.pack('<BBBBHH', 32, 32, 0, 0, 1, 32), png(32, 32)),
])
open(f'{out}/teste.ico', 'wb').write(ico)
# Cursor: no .cur, os campos de planos e bits da entrada guardam o ponto quente (5, 7).
cur = icon_file(2, [(struct.pack('<BBBBHH', 32, 32, 0, 0, 5, 7), dib_icon(32, 32, 9))])
open(f'{out}/teste.cur', 'wb').write(cur)
# Bitmap 8 bits, 4x2, paleta de 256 cores: os pixels comecam depois de 14 + 40 + 1024 bytes.
info = struct.pack('<IiiHHIIiiII', 40, 4, 2, 1, 8, 0, 8, 2835, 2835, 0, 0)
palette = b''.join(struct.pack('<BBBB', i, 255 - i, i // 2, 0) for i in range(256))
pixels = bytes(range(8))
bmp = b'BM' + struct.pack('<IHHI', 14 + len(info) + len(palette) + len(pixels), 0, 0,
                          14 + len(info) + len(palette)) + info + palette + pixels
open(f'{out}/teste.bmp', 'wb').write(bmp)
print('icones ok')
