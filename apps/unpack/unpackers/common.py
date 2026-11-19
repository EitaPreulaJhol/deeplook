"""Pecas comuns aos desempacotadores (item 7.8). Ver o README.md desta pasta."""

import os
import signal
import subprocess


class UnpackError(Exception):
    """O desempacotador reconheceu o arquivo, mas nao conseguiu: a mensagem vai para a ficha."""


def run(cmd, timeout, cwd=None, env=None):
    """Roda a ferramenta num grupo de processos proprio; no tempo esgotado, mata o grupo inteiro."""
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise UnpackError(f"tempo esgotado ({timeout} s)")
    return proc.returncode, out.decode("utf-8", "replace")


def files_under(root):
    """Arquivos comuns sob a pasta (links simbolicos e especiais ficam de fora)."""
    found = []
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(base, d))]
        for name in names:
            path = os.path.join(base, name)
            if os.path.isfile(path) and not os.path.islink(path):
                found.append(path)
    return sorted(found)


def is_pe_or_elf(data):
    return data[:2] == b"MZ" or data[:4] == b"\x7fELF"
