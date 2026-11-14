#!/usr/bin/env bash
# Gera os PNGs dos papeis de parede a partir dos SVGs.
# Requer um Chromium/Chrome (headless) instalado.
#
#   ./render.sh              # gera os dois conjuntos (desktop e lock screen)
#   ./render.sh lock         # so o da tela de bloqueio
#   ./render.sh vm           # so o do desktop/VM
#   CHROMIUM=/caminho/chrome ./render.sh
#
# Os SVGs usam viewBox 1920x1080 com preserveAspectRatio="slice": em telas de
# outra proporcao o fundo preenche tudo e as bordas sao cortadas. No wallpaper
# normal o logo fica centralizado (meet); no de lock screen ele e ancorado no
# canto inferior esquerdo (xMinYMax meet).

set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROMIUM:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
if [ -z "$CHROME" ]; then
  echo "Chromium/Chrome nao encontrado. Defina CHROMIUM=/caminho/do/chrome." >&2
  exit 1
fi

# "svg:prefixo-do-png" — o prefixo tambem serve de filtro opcional no argv.
SOURCES=(
  "deeplook-wallpaper.svg:deeplook-vm"
  "deeplook-lock-wallpaper.svg:deeplook-lock"
)

SIZES=(
  1024x768
  1280x800
  1366x768
  1600x900
  1920x1080
  1920x1200
  2560x1440
  3840x2160
)

FILTER="${1:-}"
if [ -n "$FILTER" ] && [ "$FILTER" != "all" ]; then
  matched=0
  for entry in "${SOURCES[@]}"; do
    [[ "${entry%%:*}" == *"$FILTER"* || "${entry##*:}" == *"$FILTER"* ]] && matched=1
  done
  if [ "$matched" -eq 0 ]; then
    echo "Nada para gerar com o filtro '$FILTER'." >&2
    echo "Use: ./render.sh [all|vm|lock]" >&2
    exit 1
  fi
fi

for entry in "${SOURCES[@]}"; do
  svg="${entry%%:*}"
  prefix="${entry##*:}"

  if [ -n "$FILTER" ] && [ "$FILTER" != "all" ]; then
    [[ "$svg" == *"$FILTER"* || "$prefix" == *"$FILTER"* ]] || continue
  fi

  if [ ! -f "$svg" ]; then
    echo "faltando: $svg" >&2
    exit 1
  fi

  for size in "${SIZES[@]}"; do
    out="${prefix}-${size}.png"
    "$CHROME" \
      --headless=new \
      --no-sandbox \
      --disable-gpu \
      --hide-scrollbars \
      --force-device-scale-factor=1 \
      --window-size="${size/x/,}" \
      --screenshot="$PWD/$out" \
      "file://$PWD/$svg" >/dev/null 2>&1
    echo "gerado: $out"
  done
done
