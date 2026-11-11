#!/usr/bin/env bash
# Gera os PNGs do papel de parede a partir de deeplook-wallpaper.svg.
# Requer um Chromium/Chrome (headless) instalado.
#
#   ./render.sh                 # usa chromium/chromium-browser/google-chrome do PATH
#   CHROMIUM=/caminho/chrome ./render.sh
#
# O SVG usa viewBox 1920x1080 com preserveAspectRatio="slice": em telas de
# outra proporção o fundo preenche tudo e as bordas são cortadas (o logo
# permanece centralizado).

set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROMIUM:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
if [ -z "$CHROME" ]; then
  echo "Chromium/Chrome não encontrado. Defina CHROMIUM=/caminho/do/chrome." >&2
  exit 1
fi

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

for size in "${SIZES[@]}"; do
  out="deeplook-vm-${size}.png"
  "$CHROME" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="${size/x/,}" \
    --screenshot="$PWD/$out" \
    "file://$PWD/deeplook-wallpaper.svg" >/dev/null 2>&1
  echo "gerado: $out"
done
