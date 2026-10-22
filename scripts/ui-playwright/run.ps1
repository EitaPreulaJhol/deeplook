# Testes visuais do front (Playwright em Docker, API simulada, sem banco).
# Pre-requisito: build do web (cd apps/web; npm run build).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1 -Scripts filters,account
#
# Screenshots em scripts/ui-playwright/out/. Sai com erro se alguma checagem falhar.
param(
  [string[]]$Scripts = @('screens', 'filters', 'account', 'actions', 'unsaved', 'copy-keyboard', 'queues-nav', 'filedrop-sandbox', 'assign-history', 'news-shortcuts-export', 'detail-pane', 'bulk-update', 'quick-search', 'validation', 'session-idle', 'shortcuts-help', 'favorites', 'related', 'comments', 'sla', 'more-print', 'validation-api')
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dist = Join-Path $root 'apps\web\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
  throw "Build do web nao encontrado em $dist. Rode 'npm run build' em apps/web."
}

$image = 'mcr.microsoft.com/playwright:v1.49.0-noble'
$steps = ($Scripts | ForEach-Object { "node $_.mjs" }) -join ' && '
$cmd = "npm i --no-save --no-package-lock --silent --no-audit --no-fund playwright@1.49.0 && $steps"

docker run --rm --ipc=host `
  -v "${PSScriptRoot}:/work" `
  -v "${dist}:/dist:ro" `
  -w /work $image sh -c $cmd
exit $LASTEXITCODE
