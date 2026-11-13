"""QR code em imagens e PDFs (plano pos-revisao, item 2.2), num processo filho do server.py.

Recebe o caminho do arquivo e imprime um JSON com os codigos encontrados: o texto de cada um e de
onde veio (a imagem, ou a pagina N do PDF). Phishing por QR code (inclusive boleto) passa pelos
filtros porque o link nao esta no texto do e-mail.

Entrada hostil, com tetos explicitos: so as primeiras paginas do PDF, pixels por imagem e por
pagina renderizada, codigos por arquivo e tamanho de cada texto. O tempo total e o do server.py
(processo filho com tempo-limite). Nada e executado: o PDF e so renderizado (pdfium, sem
JavaScript), a imagem so decodificada (Pillow).
"""

import json
import os
import sys
from importlib import metadata

import pypdfium2 as pdfium
import zxingcpp
from PIL import Image

MAX_PAGES = int(os.environ.get("QR_MAX_PAGES", "5"))
# Pixels por imagem ou pagina: acima disso, o Pillow recusa (bomba de descompressao).
MAX_PIXELS = int(os.environ.get("QR_MAX_PIXELS", "40000000"))
MAX_CODES = 20
MAX_TEXT = 2000
# Resolucao da pagina renderizada: 2x (cerca de 144 dpi), reduzida se passar do teto de pixels.
PDF_SCALE = 2.0

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode(image, source, page=None):
    """Os QR codes de uma imagem (Pillow), no formato da resposta."""
    found = []
    for result in zxingcpp.read_barcodes(
        image.convert("L"),
        formats=zxingcpp.BarcodeFormat.QRCode | zxingcpp.BarcodeFormat.MicroQRCode,
    ):
        text = (result.text or "").replace("\x00", "")
        if not text:
            continue
        found.append(
            {
                "text": text[:MAX_TEXT],
                "truncated": len(text) > MAX_TEXT,
                "source": source,
                "page": page,
            }
        )
    return found


def from_pdf(path):
    codes = []
    document = pdfium.PdfDocument(path)
    try:
        pages = len(document)
        for index in range(min(pages, MAX_PAGES)):
            page = document[index]
            width, height = page.get_size()
            scale = PDF_SCALE
            if width * height * scale * scale > MAX_PIXELS:
                scale = (MAX_PIXELS / (width * height)) ** 0.5
            image = page.render(scale=scale).to_pil()
            codes += decode(image, "pdf", index + 1)
            page.close()
            if len(codes) >= MAX_CODES:
                break
        return codes, pages
    finally:
        document.close()


def from_image(path):
    with Image.open(path) as image:
        # Imagem animada: so o primeiro quadro.
        image.seek(0)
        image.load()
        return decode(image, "image"), None


def main():
    path = sys.argv[1]
    with open(path, "rb") as f:
        head = f.read(8)
    try:
        if head.startswith(b"%PDF-"):
            codes, pages = from_pdf(path)
        else:
            codes, pages = from_image(path)
    except Image.DecompressionBombError:
        print(json.dumps({"ok": False, "error": f"imagem acima de {MAX_PIXELS} pixels"}))
        return
    except Exception as exc:  # noqa: BLE001 - arquivo que nao abre vira resposta legivel
        print(json.dumps({"ok": False, "error": f"não foi possível ler o arquivo: {type(exc).__name__}"}))
        return
    # O mesmo texto em varias paginas aparece uma vez (na primeira).
    unique = []
    seen = set()
    for code in codes:
        if code["text"] in seen:
            continue
        seen.add(code["text"])
        unique.append(code)
    print(
        json.dumps(
            {
                "ok": True,
                "codes": unique[:MAX_CODES],
                "pages": pages,
                "pagesRead": min(pages, MAX_PAGES) if pages is not None else None,
                "zxing": metadata.version("zxing-cpp"),
            }
        )
    )


if __name__ == "__main__":
    main()
