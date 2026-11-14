# 🧰 Software for the sandbox Windows template

> 🇧🇷 [Leia em português](template-windows.pt-BR.md)

Suggestions for what to install on the VM that becomes the isolated environment template (step 2.1
of the [Proxmox guide](proxmox.md)). The template plays three roles at once:

- **look like an ordinary victim's machine**, so the sample does what it really would (a lot of
  malware gives up when it doesn't find Office, a browser or a runtime, or when the machine looks
  like a lab);
- **give the analyst observation tools** when they open the console;
- **leak nothing**: no real account, no automatic sample upload to the outside.

Everything is installed **before** the snapshot and the template conversion; each environment is
born from a clone and discarded at the end of its deadline, so nothing the sample does reaches the
template.

> **Licenses:** Office and WinRAR are paid; the rest of the list is free. Use licenses you are
> entitled to use on an analysis VM.

## 1. Base (DeepLook depends on this)

| Software | What for | Official download |
|---|---|---|
| VirtIO drivers and QEMU Guest Agent | paravirtualized disk and network; the agent is how DeepLook reads the processes, runs the sample and collects files | [Windows VirtIO Drivers](https://pve.proxmox.com/wiki/Windows_VirtIO_Drivers) · [Qemu-guest-agent](https://pve.proxmox.com/wiki/Qemu-guest-agent) |
| Sysmon (with `sysmon.bat`) | process tree, network, files, registry and DNS in the environment artifacts | [Sysmon](https://learn.microsoft.com/sysinternals/downloads/sysmon) · setup in the [Proxmox guide](proxmox.md), step 2.1 |
| Autologon | signs in to a regular user by itself: the automatic run happens in that session and shows on the console | [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon) |

## 2. So the sample runs

What a sample expects to find on an office machine. Without it, documents don't open, installers
fail and a lot of malware simply does nothing.

| Software | Why | Official download |
|---|---|---|
| Microsoft Office (Word, Excel, PowerPoint) | macros, DDE and embedded objects only run with Office; DeepLook's static analysis (oletools) shows the code, the VM shows the effect | [Office Deployment Tool](https://learn.microsoft.com/microsoft-365-apps/deploy/overview-office-deployment-tool) · [Office LTSC 2024](https://learn.microsoft.com/office/ltsc/2024/deploy) |
| Adobe Acrobat Reader | PDFs with JavaScript or posing as invoices | [Acrobat Reader](https://get.adobe.com/reader/) |
| Google Chrome and Mozilla Firefox (Edge is built in) | phishing links and payloads that look for browser profiles and saved passwords | [Chrome](https://www.google.com/chrome/) · [Firefox](https://www.mozilla.org/firefox/new/) |
| 7-Zip and WinRAR | password-protected archives (ZIP, RAR, 7z), the most common delivery format | [7-Zip](https://www.7-zip.org/) · [WinRAR](https://www.win-rar.com/download.html) |
| .NET Framework 3.5 and 4.8, .NET Desktop Runtime | many stealers and RATs are .NET; 3.5 is turned on through Windows (`DISM /Online /Enable-Feature /FeatureName:NetFx3 /All`) | [.NET Framework](https://dotnet.microsoft.com/download/dotnet-framework) · [.NET](https://dotnet.microsoft.com/download/dotnet) |
| Visual C++ Redistributable (x64 and x86) | a dependency of many native executables; without it, the sample fails before starting | [Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) |
| Java (JRE) | `.jar` files (DeepLook identifies the JAR, but it only runs with Java) | [Eclipse Temurin JRE](https://adoptium.net/temurin/releases/?os=windows&package=jre) |
| Python | `.py` scripts and PyInstaller executables that call the interpreter | [Python for Windows](https://www.python.org/downloads/windows/) |

## 3. Observation tools (from the console)

For the analyst to follow the run live. Static analysis (capa, Ghidra, Detect It Easy, oletools,
YARA) already runs on the DeepLook server; this is what only execution shows.

| Software | What for | Official download |
|---|---|---|
| Sysinternals Suite | the whole set, including the four below | [Sysinternals Suite](https://learn.microsoft.com/sysinternals/downloads/sysinternals-suite) |
| Process Explorer | processes, loaded DLLs, handles and the parent-child chain | [Process Explorer](https://learn.microsoft.com/sysinternals/downloads/process-explorer) |
| Process Monitor | every file, registry and process access, with filters | [Process Monitor](https://learn.microsoft.com/sysinternals/downloads/procmon) |
| Autoruns | what the sample left to start by itself (persistence) | [Autoruns](https://learn.microsoft.com/sysinternals/downloads/autoruns) |
| TCPView | open connections per process, in real time | [TCPView](https://learn.microsoft.com/sysinternals/downloads/tcpview) |
| System Informer | an alternative to Process Explorer, with memory, services and network on one screen | [System Informer](https://systeminformer.sourceforge.io/downloads.php) |
| Regshot | snapshots the registry before and after and lists what changed | [Regshot](https://sourceforge.net/projects/regshot/) |
| x64dbg | debugger, to follow the sample step by step | [x64dbg](https://x64dbg.com/) |

Network capture happens outside, on the MikroTik and Suricata (section 9 of the Proxmox guide): no
Wireshark is needed on the VM.

> **Keep these tools closed at boot.** A lot of malware looks for processes such as `procmon`,
> `procexp`, `x64dbg` and `regshot` and stops when it finds them. Installed and closed, they don't
> get in the way: the analyst opens them from the console when needed. Sysmon is the exception,
> because it must run all the time; to hide it, rename the executable before installing (the
> service takes the file's name) and adjust `sysmon.bat`.

## 4. Realism (against evasion)

Samples that check whether they are in a lab look at simple signs. A "used" VM passes more of those
checks:

- **Common user software**, beyond section 2: a media player and a text editor, for example
  [VLC](https://www.videolan.org/vlc/) and [Notepad++](https://notepad-plus-plus.org/downloads/).
- **Files and history**: a few documents in Documents and on the Desktop, old downloads, browser
  history and bookmarks, recent items in Office.
- **Common names**: user and machine named after a person and a company, never `sandbox`,
  `malware`, `analysis`, `test` or a tool's name.
- **Plausible hardware**: 2 or more cores, 4 GB or more of memory, a 60 GB or larger disk and a
  common resolution (the wallpaper in `scripts/template-windows/wallpaper` comes in the usual
  sizes). Replace QEMU's SMBIOS with a real manufacturer's through an `args:` line in the template's
  configuration file, covering the BIOS (type 0) and the system (type 1), which is where samples look
  for "QEMU", "SeaBIOS" or "Proxmox". As root on the PVE host, edit
  `/etc/pve/qemu-server/<template>.conf` and add the line, for example:
  ```
  args: -smbios type=0,vendor='Dell Inc.',version=2.18.0,date=03/15/2024 -smbios type=1,manufacturer='Dell Inc.',product='OptiPlex 7090',serial=4F2KJ53
  ```
  The linked clones inherit it.
  The `smbios1` option (Options › SMBIOS settings) does not need root, but only covers type 1.

## 5. Windows settings

- **Defender without sample submission:** with automatic submission on, the sample goes to
  Microsoft before you finish the analysis. In an administrator PowerShell:
  ```powershell
  Set-MpPreference -MAPSReporting Disabled -SubmitSamplesConsent NeverSend
  Get-MpPreference | Select-Object MAPSReporting, SubmitSamplesConsent   # 0 and 2
  ```
  Reference: [Set-MpPreference](https://learn.microsoft.com/powershell/module/defender/set-mppreference)
  and [cloud protection](https://learn.microsoft.com/defender-endpoint/enable-cloud-protection-microsoft-defender-antivirus).
- **Real-time protection:** on, Defender may delete the sample before it runs; off, you see the
  whole behavior. To turn it off, first disable **Tamper Protection** in Windows Security (otherwise
  Windows undoes the change), then run `Set-MpPreference -DisableRealtimeMonitoring $true` and, after
  a reboot, check with `Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled`. Whether to
  keep it on depends on what you want to see: with it on, the VM also shows whether Defender catches
  the sample.
- **Windows Update off:** the template must not change by itself between environments (and the
  isolated network won't let it update anyway). In `gpedit.msc`: Computer Configuration ›
  Administrative Templates › Windows Components › Windows Update › *Configure Automatic Updates* =
  Disabled. Update the template on purpose from time to time and redo the snapshot.
- **No real account:** a local account, with no Microsoft account, OneDrive, e-mail or synced
  browser. Passwords saved in the browser, if you want realism, only fake ones.

## 6. Closing the template

1. Close every observation tool and check that none of them starts at boot (Task Manager ›
   Startup).
2. Reboot once and check `sysmon.log` (step 2.1 of the Proxmox guide) and the automatic sign-in.
3. Shut the VM down, create the snapshot and convert it into a template (steps 3 and 4 of the
   Proxmox guide).
4. Open an environment through DeepLook and run `node scripts/sandbox-real-check.mjs`: it checks
   the console, agent, processes, Sysmon and the automatic run on a real clone.
