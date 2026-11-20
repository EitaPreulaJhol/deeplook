#!/bin/sh
# Bases do Function ID das bibliotecas do MinGW-w64 (plans/analise-estatica-ampliada, item 25):
# o runtime (libmingwex, libmingw32), o libgcc e a zlib, de 32 e de 64 bits, dos pacotes do Debian.
# O Ghidra ja traz as do Visual Studio (2012 a 2019 e anteriores); o malware compilado com o MinGW
# (o compilador do Linux para Windows) ficava com o runtime inteiro sem nome.
#
#   fid/build.sh <saida>      (no build da imagem; precisa do Ghidra e dos pacotes mingw-w64)
#
# Cada objeto (.o) das bibliotecas estaticas e importado e analisado com os scripts do proprio
# Ghidra para isso (FunctionIDHeadlessPrescript/Postscript), uma pasta por biblioteca, e o
# BuildFid.java junta tudo numa base .fidb por arquitetura.
set -eu
OUT=$1
G=/opt/ghidra/support/analyzeHeadless
S=/opt/ghidra/Ghidra/Features/FunctionID/ghidra_scripts
HERE=$(dirname "$0")
WORK=$(mktemp -d)
mkdir -p "$OUT" "$WORK/proj"
ver() { dpkg-query -W -f '${Version}' "$1"; }
CRT=$(ver mingw-w64-common)
ZLIB=$(ver libz-mingw-w64-dev)
for arch in x64 x86; do
  if [ "$arch" = x64 ]; then t=x86_64; lang=x86:LE:64:default; gcc=gcc-mingw-w64-x86-64-win32
  else t=i686; lang=x86:LE:32:default; gcc=gcc-mingw-w64-i686-win32; fi
  GCC=$(ver "$gcc")
  specs=""
  for lib in /usr/$t-w64-mingw32/lib/libmingwex.a /usr/$t-w64-mingw32/lib/libmingw32.a \
    /usr/$t-w64-mingw32/lib/libz.a /usr/lib/gcc/$t-w64-mingw32/*-win32/libgcc.a; do
    name=$(basename "$lib" .a)
    mkdir -p "$WORK/objs/$arch/$name"
    (cd "$WORK/objs/$arch/$name" && ar x "$lib")
    case $name in
      libz) v=$ZLIB ;;
      libgcc) v=$GCC ;;
      *) v=$CRT ;;
    esac
    "$G" "$WORK/proj" fid/$arch/$name -import "$WORK/objs/$arch/$name" -recursive \
      -preScript FunctionIDHeadlessPrescript.java -postScript FunctionIDHeadlessPostscript.java \
      -scriptPath "$S" -max-cpu 4 >"$WORK/import-$arch-$name.log" 2>&1
    specs="$specs $arch/$name=$name:$v:mingw-w64-$arch"
  done
  first=$(ls "$WORK/objs/$arch/libz" | head -1)
  # shellcheck disable=SC2086 # uma especificacao por biblioteca
  "$G" "$WORK/proj" fid -process "$first" -recursive -noanalysis -readOnly -scriptPath "$HERE" \
    -postScript BuildFid.java "$OUT/mingw-w64-$arch.fidb" "$lang" $specs >"$WORK/build-$arch.log" 2>&1
  grep "FID " "$WORK/build-$arch.log"
  test -s "$OUT/mingw-w64-$arch.fidb"
done
rm -rf "$WORK"
