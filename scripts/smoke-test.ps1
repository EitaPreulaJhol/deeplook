$ErrorActionPreference = 'Continue'
$base = 'http://localhost:8080/api'
function StatusOf($e) { try { return [int]$e.Exception.Response.StatusCode } catch { return 'n/a' } }
function Say($m) { Write-Host $m }

# 0. Frontend (SPA)
$fe = & curl.exe -s -o NUL -w "%{http_code}" http://localhost:8080/
Say "FRONTEND (/) HTTP $fe"

# 1. Health
$h = Invoke-RestMethod -Uri "$base/health" -Method Get
Say "HEALTH: $($h.status) / $($h.service)"

# 2. Login admin
$admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession
# O admin troca a senha no primeiro acesso: informe a atual em SMOKE_ADMIN_PASSWORD.
$adminBody = @{ email = 'admin@deeplook.local'; password = $(if ($env:SMOKE_ADMIN_PASSWORD) { $env:SMOKE_ADMIN_PASSWORD } else { 'admin12345' }) } | ConvertTo-Json
$l = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -WebSession $admin -ContentType 'application/json' -Body $adminBody
if ($l.user.mustChangePassword) { throw 'O admin precisa trocar a senha: entre pela tela, troque e defina SMOKE_ADMIN_PASSWORD.' }
Say "LOGIN ADMIN: $($l.user.email) role=$($l.user.role)"

# 3. Chaves de ativacao (USER e ANALYST)
$kUser = Invoke-RestMethod -Uri "$base/admin/activation-keys" -Method Post -WebSession $admin -ContentType 'application/json' -Body '{"role":"USER","maxUses":5,"expiresInDays":30}'
$kAnalyst = Invoke-RestMethod -Uri "$base/admin/activation-keys" -Method Post -WebSession $admin -ContentType 'application/json' -Body '{"role":"ANALYST","maxUses":1,"expiresInDays":30}'
Say "CHAVE USER: $($kUser.key.code) role=$($kUser.key.role)"
Say "CHAVE ANALYST: $($kAnalyst.key.code) role=$($kAnalyst.key.role)"

# 4. Registrar usuario comum (USER)
$u1 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r1 = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -WebSession $u1 -ContentType 'application/json' -Body (@{ email='amigo@deeplook.local'; displayName='Amigo Comum'; password='senha12345'; activationKey=$kUser.key.code } | ConvertTo-Json)
Say "REGISTRO USER: $($r1.user.email) role=$($r1.user.role)"

# 5. Registrar analista
$u2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$r2 = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -WebSession $u2 -ContentType 'application/json' -Body (@{ email='analista@deeplook.local'; displayName='Analista Teste'; password='senha12345'; activationKey=$kAnalyst.key.code } | ConvertTo-Json)
Say "REGISTRO ANALYST: $($r2.user.email) role=$($r2.user.role)"

# 5b. Chave invalida deve falhar
try { Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body '{"email":"x@x.com","displayName":"x","password":"senha12345","activationKey":"DL-AAAA-BBBB-CCCC"}' | Out-Null; Say "CHAVE INVALIDA: FALHA (aceitou)" } catch { Say "CHAVE INVALIDA rejeitada: HTTP $(StatusOf $_)" }

# 6. Usuario comum envia LINK
$eUrl = Invoke-RestMethod -Uri "$base/entries/url" -Method Post -WebSession $u1 -ContentType 'application/json' -Body '{"url":"https://exemplo-suspeito.com/login","title":"Site suspeito","description":"Recebido por email","tags":"phishing,scam"}'
Say "LINK ENVIADO: id=$($eUrl.entry.id) domain=$($eUrl.entry.urlDomain) tags=$($eUrl.entry.tags.Count)"

# 7. Usuario comum envia ARQUIVO (curl com o cookie da sessao)
$tmp = Join-Path $env:TEMP 'deeplook_sample.txt'
Set-Content -Path $tmp -Value 'amostra de teste do deeplook' -Encoding ascii
$cookie = ($u1.Cookies.GetCookies('http://localhost:8080') | Where-Object { $_.Name -eq 'dl_session' }).Value
$eFile = (& curl.exe -s -b "dl_session=$cookie" -F "file=@$tmp" -F "title=Amostra de teste" -F "tags=teste" "$base/entries/file") | ConvertFrom-Json
Say "ARQUIVO ENVIADO: id=$($eFile.entry.id) size=$($eFile.entry.fileSize) sha256=$($eFile.entry.sha256.Substring(0,16)).."

# 8. Listagens
$all = Invoke-RestMethod -Uri "$base/entries?scope=all" -Method Get -WebSession $u1
$mine = Invoke-RestMethod -Uri "$base/entries?scope=mine" -Method Get -WebSession $u1
$search = Invoke-RestMethod -Uri "$base/entries?q=phishing&scope=all" -Method Get -WebSession $u1
Say "LISTA GLOBAL=$($all.total) MEUS=$($mine.total) BUSCA(tag phishing)=$($search.total)"

# 9. Usuario comum NAO cria relatorio
try { Invoke-RestMethod -Uri "$base/entries/$($eUrl.entry.id)/reports" -Method Post -WebSession $u1 -ContentType 'application/json' -Body '{"summary":"tentativa"}' | Out-Null; Say "USER->RELATORIO: FALHA (permitiu)" } catch { Say "USER->RELATORIO bloqueado: HTTP $(StatusOf $_)" }

# 9b. Usuario comum NAO acessa admin
try { Invoke-RestMethod -Uri "$base/admin/users" -Method Get -WebSession $u1 | Out-Null; Say "USER->ADMIN: FALHA (permitiu)" } catch { Say "USER->ADMIN bloqueado: HTTP $(StatusOf $_)" }

# 10. Analista cria relatorio publicado
$rep = Invoke-RestMethod -Uri "$base/entries/$($eUrl.entry.id)/reports" -Method Post -WebSession $u2 -ContentType 'application/json' -Body '{"summary":"Link de phishing confirmado","findings":"Formulario falso coletando credenciais","iocs":"exemplo-suspeito.com","verdict":"MALICIOUS","published":true}'
Say "ANALYST CRIOU RELATORIO: verdict=$($rep.report.verdict) published=$($rep.report.published)"

# 10b. Analista NAO acessa painel admin
try { Invoke-RestMethod -Uri "$base/admin/activation-keys" -Method Get -WebSession $u2 | Out-Null; Say "ANALYST->ADMIN: FALHA (permitiu)" } catch { Say "ANALYST->ADMIN bloqueado: HTTP $(StatusOf $_)" }

# 11. Estado da amostra apos publicacao
$e = Invoke-RestMethod -Uri "$base/entries/$($eUrl.entry.id)" -Method Get -WebSession $u1
Say "AMOSTRA: verdict=$($e.entry.verdict) status=$($e.entry.status) reports=$($e.entry.reports.Count)"

# 12. Download do arquivo
$dl = Join-Path $env:TEMP 'deeplook_dl.txt'
Invoke-WebRequest -Uri "$base/entries/$($eFile.entry.id)/download" -Method Get -WebSession $u1 -OutFile $dl -UseBasicParsing
Say "DOWNLOAD: bytes=$((Get-Item $dl).Length) conteudo='$((Get-Content $dl -Raw).Trim())'"

# 13. Admin: usuarios e chaves
$users = Invoke-RestMethod -Uri "$base/admin/users" -Method Get -WebSession $admin
$keys = Invoke-RestMethod -Uri "$base/admin/activation-keys" -Method Get -WebSession $admin
Say "ADMIN: users=$($users.users.Count) keys=$($keys.keys.Count)"

# 14. Logout
Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -WebSession $u1 -ContentType 'application/json' -Body '{}' | Out-Null
try { Invoke-RestMethod -Uri "$base/auth/me" -Method Get -WebSession $u1 | Out-Null; Say "ME APOS LOGOUT: FALHA" } catch { Say "ME APOS LOGOUT bloqueado: HTTP $(StatusOf $_)" }

Say "==== FIM DOS TESTES ===="
