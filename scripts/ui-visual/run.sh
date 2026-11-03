#!/bin/sh
# Suite visual no Linux/macOS (e no CI): roda na MESMA imagem do Playwright usada nas baselines.
# Pre-requisito: build do web (cd apps/web; npm run build).
#
#   sh scripts/ui-visual/run.sh                     compara
#   sh scripts/ui-visual/run.sh --update-snapshots   regrava as baselines (commite os PNGs)
#   sh scripts/ui-visual/run.sh --grep 'ficha'       um teste so
#
# Os argumentos vao com "$@" (e nao interpolados) para um padrao com espaco nao se partir.
set -e
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
[ -f "$root/apps/web/dist/index.html" ] || { echo "sem build em apps/web/dist (rode npm run build)"; exit 1; }
# --user: os arquivos que o container grava (baselines novas, node_modules) ficam com o dono
# certo, senao a proxima rodada local nao consegue nem sobrescrever.
docker run --rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$root:/work" \
  -w /work/scripts/ui-visual \
  -e DIST_DIR=/work/apps/web/dist \
  -e NGINX_CONF=/work/apps/web/nginx.conf \
  -e OUT_DIR=/work/scripts/ui-visual/out \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  sh -c 'npm install --no-audit --no-fund && exec npx playwright test "$@"' sh "$@"
