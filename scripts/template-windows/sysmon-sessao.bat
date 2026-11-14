@echo off
rem ---------------------------------------------------------------------------------------------
rem DeepLook: Sysmon a cada sessao do sandbox (docs/proxmox.pt-BR.md, secao 2.1).
rem
rem Fica no template, na mesma pasta do Sysmon64.exe e do sysmonconfig.xml, e roda como SYSTEM a
rem cada boot por uma tarefa agendada:
rem
rem   schtasks /create /tn "DeepLook\Sysmon a cada sessao" /tr "\"C:\Tools\Sysmon\sysmon-sessao.bat\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
rem
rem A cada boot: instala o Sysmon se o servico nao existir (ou so reaplica a configuracao), aumenta
rem o log, o limpa (o ambiente comeca sem os eventos de quando o template foi preparado) e confere
rem que o servico esta rodando. O que fez fica em sysmon-sessao.log, na mesma pasta.
rem ---------------------------------------------------------------------------------------------
setlocal
set "DIR=%~dp0"
set "SYSMON=%DIR%Sysmon64.exe"
set "CONFIG=%DIR%sysmonconfig.xml"
set "LOG=%DIR%sysmon-sessao.log"
set "CHANNEL=Microsoft-Windows-Sysmon/Operational"
rem Tamanho do log do Sysmon: 64 MB.
set "LOGSIZE=67108864"

echo [%date% %time%] inicio > "%LOG%"
if not exist "%SYSMON%" (
  echo ERRO: Sysmon64.exe nao encontrado em %DIR% >> "%LOG%"
  exit /b 1
)
if not exist "%CONFIG%" (
  echo ERRO: sysmonconfig.xml nao encontrado em %DIR% >> "%LOG%"
  exit /b 1
)

sc query Sysmon64 >nul 2>&1
if errorlevel 1 (
  echo instalando o Sysmon >> "%LOG%"
  "%SYSMON%" -accepteula -i "%CONFIG%" >> "%LOG%" 2>&1
) else (
  echo reaplicando a configuracao >> "%LOG%"
  "%SYSMON%" -c "%CONFIG%" >> "%LOG%" 2>&1
)

wevtutil sl "%CHANNEL%" /ms:%LOGSIZE% >> "%LOG%" 2>&1
wevtutil cl "%CHANNEL%" >> "%LOG%" 2>&1
sc config Sysmon64 start= auto >> "%LOG%" 2>&1
sc start Sysmon64 >nul 2>&1

sc query Sysmon64 | find "RUNNING" >nul
if errorlevel 1 (
  echo ERRO: o servico Sysmon64 nao esta rodando >> "%LOG%"
  exit /b 1
)
echo [%date% %time%] Sysmon rodando, log limpo >> "%LOG%"
exit /b 0
