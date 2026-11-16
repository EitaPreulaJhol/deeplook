#!/bin/sh
# Teto de memoria de cada processo nativo do descompilador do Ghidra (plans/ajustes-usabilidade,
# item 2). O Dockerfile poe isto no lugar do binario `decompile` (o original vira decompile.real).
# Em algumas funcoes (no python3.13, 6,8 MB) o descompilador cresce sem limite: dois deles passavam
# de 10 GB, o conteiner matava o Java e nao saia nada. Com o teto, so a funcao problematica falha
# ("Decompiler process died") e o Ghidra abre outro processo para a proxima. 0 desliga.
limit=${GHIDRA_DECOMPILER_MAX_MB:-1024}
if [ "$limit" -gt 0 ]; then
  ulimit -v $((limit * 1024))
fi
exec "$(dirname "$0")/decompile.real" "$@"
