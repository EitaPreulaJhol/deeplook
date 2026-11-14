@echo off
rem ---------------------------------------------------------------------------------------------
rem DeepLook: Sysmon on every sandbox session (docs/proxmox.md, section 2.1).
rem
rem Lives in the template, in the same folder as Sysmon64.exe and sysmonconfig.xml, and runs as
rem SYSTEM on every boot through a scheduled task:
rem
rem   schtasks /create /tn "DeepLook\Sysmon" /tr "\"C:\Tools\Sysmon\sysmon.bat\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
rem
rem On every boot: installs Sysmon if the service does not exist (or just reapplies the
rem configuration), raises the log size, clears the log (the environment starts without the events
rem from when the template was prepared) and checks that the service is running. What it did goes
rem to sysmon.log, in the same folder.
rem ---------------------------------------------------------------------------------------------
setlocal
set "DIR=%~dp0"
set "SYSMON=%DIR%Sysmon64.exe"
set "CONFIG=%DIR%sysmonconfig.xml"
set "LOG=%DIR%sysmon.log"
set "CHANNEL=Microsoft-Windows-Sysmon/Operational"
rem Sysmon log size: 64 MB.
set "LOGSIZE=67108864"

echo [%date% %time%] start > "%LOG%"
if not exist "%SYSMON%" (
  echo ERROR: Sysmon64.exe not found in %DIR% >> "%LOG%"
  exit /b 1
)
if not exist "%CONFIG%" (
  echo ERROR: sysmonconfig.xml not found in %DIR% >> "%LOG%"
  exit /b 1
)

sc query Sysmon64 >nul 2>&1
if errorlevel 1 (
  echo installing Sysmon >> "%LOG%"
  "%SYSMON%" -accepteula -i "%CONFIG%" >> "%LOG%" 2>&1
) else (
  echo reapplying the configuration >> "%LOG%"
  "%SYSMON%" -c "%CONFIG%" >> "%LOG%" 2>&1
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
