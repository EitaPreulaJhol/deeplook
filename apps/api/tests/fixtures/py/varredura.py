# Amostra de teste (item 15): o laco for para o pycdc no 3.9; sai o parcial e o disassembly.
import os

ALVOS = ("wallet.dat", "key4.db")


def procura(raiz):
    achados = []
    for pasta, _, arquivos in os.walk(raiz):
        for nome in arquivos:
            if nome in ALVOS:
                achados.append(os.path.join(pasta, nome))
    return achados
