# Testes visuais do front (Playwright em Docker, API simulada, sem banco).
# Pre-requisito: build do web (cd apps/web; npm run build).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1 -Scripts filters,account
#
# Screenshots em scripts/ui-playwright/out/. Sai com erro se alguma checagem falhar.
param(
  [string[]]$Scripts = @('screens', 'filters', 'account', 'actions', 'unsaved', 'copy-keyboard', 'queues-nav', 'filedrop-sandbox', 'assign-history', 'news-shortcuts-export', 'detail-pane', 'bulk-update', 'quick-search', 'validation', 'session-idle', 'shortcuts-help', 'favorites', 'related', 'comments', 'sla', 'more-print', 'validation-api', 'iocs', 'notifications', 'report-templates', 'duplicates', 'admin-status', 'dashboard', 'static-analysis', 'report-review', 'admin-audit', 'batch-upload', 'retention-trash', 'api-tokens', 'reputation', 'logout-unsaved', 'force-password', 'antivirus', 'two-factor', 'topbar-center', 'password-policy', 'take-next', 'hex-viewer', 'priority', 'sessions', 'ioc-watch', 'yara', 'attack', 'compare', 'team-views', 'quota', 'kb', 'email', 'cases', 'api-down', 'yara-retro', 'allowlist', 'search', 'document', 'similar', 'sla-escalation', 'case-export', 'report-versions', 'evidence', 'management', 'ioc-import', 'assignment', 'capture', 'script', 'decoder', 'disk', 'triage-rules', 'broadcasts', 'resolution', 'case-notifications', 'relation-map', 'lookalike', 'api-docs', 'backup', 'ldap-login', 'sample-access', 'long-names', 'upload-feedback', 'navigation-a11y', 'sidebar-folders', 'plain-language', 'own-samples', 'yara-packs', 'yara-updates', 'notification-prefs', 'ioc-url', 'capa', 'ghidra', 'unpack', 'risk', 'case-stix', 'office')
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dist = Join-Path $root 'apps\web\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
  throw "Build do web nao encontrado em $dist. Rode 'npm run build' em apps/web."
}

$image = 'mcr.microsoft.com/playwright:v1.64.1-noble'
# run-all.sh roda todos, mesmo com falha, e no fim lista os que falharam (saida 1).
$names = $Scripts -join ' '
$cmd = "npm i --no-save --no-package-lock --silent --no-audit --no-fund playwright@1.64.1 && sh run-all.sh $names"

docker run --rm --ipc=host `
  -v "${PSScriptRoot}:/work" `
  -v "${dist}:/dist:ro" `
  -v "${root}\apps\web\nginx.conf:/nginx.conf:ro" `
  -w /work $image sh -c $cmd
exit $LASTEXITCODE
