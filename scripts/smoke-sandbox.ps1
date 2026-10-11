# Smoke test do sandbox de analise (VM isolada no Proxmox).
# Com PROXMOX_MOCK=true valida o fluxo inteiro sem precisar de um PVE real.
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:8080/api'
function StatusOf($e) { try { return [int]$e.Exception.Response.StatusCode } catch { return 'n/a' } }
function Say($m) { Write-Host $m }

# 1. Admin + saude da integracao
$admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$l = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $admin -ContentType 'application/json' -Body '{"email":"admin@deeplook.local","password":"admin12345"}'
Say "LOGIN ADMIN: $($l.user.email)"

$health = Invoke-RestMethod -Uri "$base/sandbox/health" -Method Get -WebSession $admin
Say "SANDBOX: enabled=$($health.enabled) mock=$($health.mock) node=$($health.node) template=$($health.templateVmid) isoStorage=$($health.isoStorage)"
foreach ($c in $health.checks) {
  $mark = if ($c.ok) { 'ok' } else { 'FALHOU' }
  Say ("  - {0}: {1} ({2})" -f $c.name, $mark, $c.detail)
}

# 2. Analista (cria chave, registra e entra; se ja existir, so faz login)
$k = Invoke-RestMethod -Uri "$base/admin/activation-keys" -Method Post -WebSession $admin -ContentType 'application/json' -Body '{"role":"ANALYST","maxUses":1,"expiresInDays":30}'
$analyst = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try {
  $r = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -WebSession $analyst -ContentType 'application/json' -Body (@{ email='sandbox@deeplook.local'; displayName='Analista Sandbox'; password='senha12345'; activationKey=$k.key.code } | ConvertTo-Json)
  Say "REGISTRO ANALYST: $($r.user.email) role=$($r.user.role)"
} catch {
  $r = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $analyst -ContentType 'application/json' -Body '{"email":"sandbox@deeplook.local","password":"senha12345"}'
  Say "LOGIN ANALYST: $($r.user.email) role=$($r.user.role)"
}

# 3. Envia uma amostra para analisar
$tmp = Join-Path $env:TEMP 'deeplook_sandbox_sample.txt'
Set-Content -Path $tmp -Value 'amostra para o sandbox do deeplook' -Encoding ascii
$cookie = ($analyst.Cookies.GetCookies('http://localhost:8080') | Where-Object { $_.Name -eq 'dl_session' }).Value
$entry = (& curl.exe -s -b "dl_session=$cookie" -F "file=@$tmp" -F "title=Amostra sandbox" -F "tags=sandbox" "$base/entries/file") | ConvertFrom-Json
Say "AMOSTRA ENVIADA: id=$($entry.entry.id) sha256=$($entry.entry.sha256.Substring(0,16)).."

# 4. Abre o ambiente isolado
$s = Invoke-RestMethod -Uri "$base/entries/$($entry.entry.id)/sandbox" -Method Post -WebSession $analyst -ContentType 'application/json' -Body '{}'
$sid = $s.session.id
Say "AMBIENTE CRIADO: id=$sid status=$($s.session.status) nome=$($s.session.name) expira=$($s.session.expiresAt)"

# 5. Acompanha o provisionamento (ISO -> upload -> clone -> config -> start)
$deadline = (Get-Date).AddSeconds(180)
do {
  Start-Sleep -Seconds 2
  $d = Invoke-RestMethod -Uri "$base/sandbox/$sid" -Method Get -WebSession $analyst
  Say ("  [{0}] status={1} fase={2} vmid={3} vmStatus={4}" -f (Get-Date -Format 'HH:mm:ss'), $d.session.status, $d.session.phase, $d.session.vmid, $d.vmStatus)
} while ($d.session.status -in @('REQUESTED', 'PROVISIONING') -and (Get-Date) -lt $deadline)

if ($d.session.status -ne 'RUNNING') {
  Say "FALHOU: ambiente terminou como $($d.session.status) - erro: $($d.session.lastError)"
  exit 1
}
Say "AMBIENTE PRONTO: vmid=$($d.session.vmid) iso=$($d.session.isoVolume) vmStatus=$($d.vmStatus)"

# 6. Console (a captura de tela no painel e feita no navegador, pelo canvas do noVNC)
$c = Invoke-RestMethod -Uri "$base/sandbox/$sid/console" -Method Get -WebSession $analyst
Say "CONSOLE: wsPath=$($c.wsPath)"
$png = Join-Path $env:TEMP 'deeplook_sandbox.png'
try {
  Invoke-WebRequest -Uri "$base/sandbox/$sid/screenshot" -Method Get -WebSession $analyst -OutFile $png -UseBasicParsing 2>$null
  Say "SCREENSHOT (endpoint server-side): bytes=$((Get-Item $png).Length)"
} catch {
  Say "SCREENSHOT (endpoint server-side): indisponivel neste PVE (no painel a captura e feita no navegador)"
}

# 7. Estende o prazo do ambiente
$ext = Invoke-RestMethod -Uri "$base/sandbox/$sid/extend" -Method Post -WebSession $analyst -ContentType 'application/json' -Body '{"minutes":10}'
Say "PRAZO ESTENDIDO: novo vencimento $($ext.session.expiresAt)"

# 7b. Tunel do console (WebSocket: navegador -> nginx -> API -> console)
$root = Split-Path -Parent $PSScriptRoot
node (Join-Path $root 'scripts\ws-console-check.mjs') $sid $cookie

# 8. Descarta o ambiente (destroi a VM e apaga o ISO)
Invoke-RestMethod -Uri "$base/sandbox/$sid" -Method Delete -WebSession $analyst | Out-Null
$final = Invoke-RestMethod -Uri "$base/sandbox/$sid" -Method Get -WebSession $analyst
Say "AMBIENTE DESCARTADO: status=$($final.session.status) stoppedAt=$($final.session.stoppedAt)"

$active = Invoke-RestMethod -Uri "$base/sandbox?active=true" -Method Get -WebSession $analyst
Say "AMBIENTES ATIVOS RESTANTES: $($active.sessions.Count)"

Say "==== FIM DO SMOKE TEST DO SANDBOX ===="
