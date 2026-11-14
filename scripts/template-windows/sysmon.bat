@echo off
rem ---------------------------------------------------------------------------------------------
rem DeepLook: Sysmon on every sandbox session (docs/proxmox.md, section 2.1).
rem
rem Lives in the template, in the same folder as Sysmon64.exe and sysmonconfig.xml, and runs as
rem SYSTEM on every boot through a scheduled task:
rem
rem   schtasks /create /tn "DeepLook\Sysmon" /tr "\"C:\Tools\Sysmon\sysmon.bat\"" /sc onstart /delay 0000:30 /ru SYSTEM /rl HIGHEST /f
rem
rem Run by the task, as SYSTEM: the script moves to its own folder (the task starts in
rem C:\Windows\System32) and retries a failed install up to 3 times, undoing it in between.
rem
rem At boot the task can start before the Windows Event Log service, which Sysmon needs to register
rem its channel (wevtutil): the script waits for that service first (up to 120 s), and the task
rem starts 30 s after boot.
rem
rem On every boot: installs Sysmon if the service does not exist (or just reapplies the
rem configuration), raises the log size, clears the log (the environment starts without the events
rem from when the template was prepared) and checks that the service is running. What it did goes
rem to sysmon.log, in the same folder.
rem ---------------------------------------------------------------------------------------------
setlocal
set "DIR=%~dp0"
rem As SYSTEM the task starts in C:\Windows\System32: run from this folder, as by hand.
cd /d "%DIR%"
set "SYSMON=%DIR%Sysmon64.exe"
set "CONFIG=%DIR%sysmonconfig.xml"
set "LOG=%DIR%sysmon.log"
set "CHANNEL=Microsoft-Windows-Sysmon/Operational"
rem Sysmon log size: 64 MB.
set "LOGSIZE=67108864"

echo [%date% %time%] start > "%LOG%"
for /f "delims=" %%U in ('whoami') do echo running as %%U in %CD% >> "%LOG%"

rem Wait for the Windows Event Log service. ping is the sleep: timeout fails without a console.
set /a WAITED=0
:waitlog
sc query EventLog | find "RUNNING" >nul
if not errorlevel 1 goto logready
if %WAITED% geq 120 goto lognotready
set /a WAITED+=5
ping -n 6 127.0.0.1 >nul
goto waitlog
:lognotready
echo ERROR: the Windows Event Log service is not running after 120 s >> "%LOG%"
exit /b 1
:logready
echo Windows Event Log service running, waited %WAITED% s >> "%LOG%"
if not exist "%SYSMON%" (
  echo ERROR: Sysmon64.exe not found in %DIR% >> "%LOG%"
  exit /b 1
)
if not exist "%CONFIG%" (
  echo ERROR: sysmonconfig.xml not found in %DIR% >> "%LOG%"
  exit /b 1
)

sc query Sysmon64 >nul 2>&1
if errorlevel 1 goto install
echo reapplying the configuration >> "%LOG%"
"%SYSMON%" -c "%CONFIG%" >> "%LOG%" 2>&1
set "RC=%errorlevel%"
goto applied

:install
rem Up to 3 attempts: a failed install is undone (-u force) before trying again 15 s later.
set /a TRY=0
:installtry
set /a TRY+=1
echo installing Sysmon, attempt %TRY% of 3 >> "%LOG%"
"%SYSMON%" -accepteula -i "%CONFIG%" >> "%LOG%" 2>&1
set "RC=%errorlevel%"
if "%RC%"=="0" goto applied
if %TRY% geq 3 goto applied
echo install failed with code %RC%: undoing it and trying again in 15 s >> "%LOG%"
"%SYSMON%" -u force >> "%LOG%" 2>&1
ping -n 16 127.0.0.1 >nul
goto installtry

:applied
echo Sysmon exit code: %RC% >> "%LOG%"
if not "%RC%"=="0" (
  echo ERROR: Sysmon refused the configuration or the install. Run it by hand in an administrator prompt to see the message: >> "%LOG%"
  echo   "%SYSMON%" -accepteula -i "%CONFIG%" >> "%LOG%"
  exit /b 1
)

wevtutil sl "%CHANNEL%" /ms:%LOGSIZE% >> "%LOG%" 2>&1
wevtutil cl "%CHANNEL%" >> "%LOG%" 2>&1
sc config Sysmon64 start= auto >> "%LOG%" 2>&1
sc start Sysmon64 >nul 2>&1

sc query Sysmon64 | find "RUNNING" >nul
if errorlevel 1 (
  echo ERROR: the Sysmon64 service is not running >> "%LOG%"
  exit /b 1
)
echo [%date% %time%] Sysmon running, log cleared >> "%LOG%"
exit /b 0
