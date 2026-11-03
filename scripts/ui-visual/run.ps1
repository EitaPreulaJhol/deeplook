# Suite visual no Windows (PowerShell), na MESMA imagem do Playwright usada nas baselines.
# Pre-requisito: build do web (cd apps/web; npm run build).
#
#   powershell -ExecutionPolicy Bypass -File scripts/ui-visual/run.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/ui-visual/run.ps1 -Update   # regrava as baselines
param([switch]$Update)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not (Test-Path (Join-Path $root 'apps\web\dist\index.html'))) {
  throw "Build do web nao encontrado. Rode 'npm run build' em apps/web."
}
$args = if ($Update) { '--update-snapshots' } else { '' }
docker run --rm --ipc=host `
  -v "${root}:/work" `
  -w /work/scripts/ui-visual `
  -e DIST_DIR=/work/apps/web/dist `
  -e NGINX_CONF=/work/apps/web/nginx.conf `
  -e OUT_DIR=/work/scripts/ui-visual/out `
  mcr.microsoft.com/playwright:v1.64.1-noble `
  sh -c "npm install --no-audit --no-fund && npx playwright test $args"
exit $LASTEXITCODE
