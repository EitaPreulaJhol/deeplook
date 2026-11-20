"""O unicorn do unipacker (item 17) so usa isto do pkg_resources, que o setuptools 81+ nao traz mais:
o caminho de um arquivo dentro de um pacote instalado (a libunicorn.so)."""

import importlib
import os


def resource_filename(package, name):
    return os.path.join(os.path.dirname(importlib.import_module(package).__file__), name)
