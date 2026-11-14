# 🧪 Sandbox test plan against the real Proxmox

> 🇧🇷 [Leia em português](teste-proxmox-real.pt-BR.md)

Item 5.5 of the [post-review plan](plano-2026-11.md).

The sandbox has tests against the mocked Proxmox (`PROXMOX_MOCK=true`), against a fake RouterOS and
against generated TZSP packets. This plan covers what only the real infrastructure confirms, in a
script you can follow in an afternoon. Each step's result goes in the
[results log](#7-results-log).

## 1. What only the real environment confirms

| # | Point | Why the automated tests miss it |
|---|---|---|
| R1 | The account's effective permissions in PVE (clone, config, console, agent) | the mock accepts everything |
| R2 | ISO upload, linked clone (or the fallback to a full copy) and real timings | the mock answers in milliseconds |
| R3 | Console from the browser → nginx → API → PVE (WebSocket and VNC password) | there is no real VNC in CI |
| R4 | Screenshot through the VNC console on PVE 9 (which removed the screenshot endpoint) | the mock has the endpoint |
| R5 | `qemu-guest-agent`: `get-osinfo`, `exec` and the process list on Windows | the mock returns a ready CSV |
| R6 | Sysmon: the Base64 `Get-WinEvent`, the UTF-8 encoding and the PowerShell 5.1 JSON | Linux has no `Get-WinEvent` |
| R7 | RouterOS 7 sniffer REST API: parameter names, stop, reconfigure and start | the test RouterOS is fake |
| R8 | TZSP leaving the CHR and reaching `netcap` (route, firewall, `DOCKER-USER`) | the test packets are born on the host itself |
| R9 | Real frames: VLAN, checksum offload, MTU | the test frames are built by hand |
| R10 | Suricata with the ET Open rules over real traffic | the test uses only the DeepLook rule |
| R11 | Pause in one environment's capture when another opens or closes | only happens with the real sniffer |
| R12 | Cleanup in PVE and in the CHR after failures (API dying halfway, stuck VM) | the mock keeps no state across restarts |

## 2. Prerequisites

### 2.1 Infrastructure

- [ ] PVE 8 or 9 with the template ready (`docs/proxmox.md`, section 2): Windows 10 or 11,
      `qemu-guest-agent` running, Sysmon with `sysmon-modular` and the `sysmon-sessao.bat` task, a
      snapshot and `qm template`.
- [ ] The VMs' isolated network behind the MikroTik CHR (RouterOS 7), with internet access only
      through it.
- [ ] CHR with `www-ssl` and the `deeplook` user set up (`docs/proxmox.md`, section 9.1).
- [ ] DeepLook host with `COMPOSE_PROFILES=netcap` and the `MIKROTIK_*`, `NETCAP_*` and `SURICATA_*`
      variables (section 9.2), and the TZSP firewall open only to the CHR IP.
- [ ] Wireshark (or `tshark`) on an analysis machine, to open the pcap.
- [ ] Access to the CHR's Winbox or SSH and to the PVE shell, to check from outside.

### 2.2 In DeepLook

- [ ] An admin and an analyst **just for the test** (the analyst opens the environments; the admin
      checks the status and the audit log).
- [ ] `SANDBOX_TTL_MINUTES` with room to spare (60) and `SANDBOX_ARTIFACT_INTERVAL_S=60`.
- [ ] **Administração > Status do sistema** with no error before starting (note the warnings).
- [ ] Suricata with the ET Open rules downloaded (the status shows the count; without them, step 5.4
      only has the test rule).

### 2.3 Test sample (harmless)

Save it as `deeplook-teste.ps1` and submit it through **Enviar Amostra**. It does nothing beyond
producing the events Sysmon and Suricata need to see:

```powershell
# Amostra inofensiva do teste real do DeepLook (docs/teste-proxmox-real.pt-BR.md).
# 1. Consulta DNS da regra de teste do DeepLook (o dominio .invalid nunca resolve). O nslookup
#    manda direto (o Suricata ve); o Resolve-DnsName passa pelo cliente DNS do Windows (o Sysmon ve).
nslookup deeplook-teste.invalid 2>$null | Out-Null
Resolve-DnsName deeplook-teste.invalid -ErrorAction SilentlyContinue | Out-Null
# 2. Pedido HTTP que dispara uma regra ET Open conhecida ("GPL ATTACK_RESPONSE id check
#    returned root"): o testmynids.org existe para testar IDS.
try { Invoke-WebRequest -UseBasicParsing http://testmynids.org/uid/index.html | Out-Null } catch {}
# 3. Um arquivo e uma chave de inicializacao (Sysmon 11 e 13). A VM e descartada no fim.
Set-Content -Path "$env:PUBLIC\deeplook-teste.txt" -Value 'teste do DeepLook'
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name DeepLookTeste -Value 'notepad.exe' -Force | Out-Null
# 4. Um processo filho (arvore de processos).
Start-Process notepad.exe
```

(The comments are in Portuguese, like the rest of the code.) `nslookup` sends the query directly
(Suricata sees it); `Resolve-DnsName` goes through the Windows DNS client (Sysmon sees it). In the VM
the sample is on the CD-ROM (usually `D:`). To run it:
`powershell -ExecutionPolicy Bypass -File D:\deeplook-teste.ps1`.

## 3. Script

Each step says what to do, what to expect and where to check. **R** marks a required criterion
(without it the sandbox is not ready for use); **N**, a nice-to-have (note it and move on).

### Phase 0 — Baseline

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 0.1 | `GET /api/sandbox/health` (as admin, or `scripts/smoke-sandbox.ps1` up to section 1) | `pve-acessivel`, `template` and the ISO storage ok | JSON answer | **R** |
| 0.2 | Effective permissions: `pveum user permissions deeplook@pve --path /vms` | `VM.Clone`, `VM.Config.*`, `VM.PowerMgmt`, `VM.Console` and `VM.GuestAgent.Unrestricted` (PVE 9) or `VM.Monitor` (PVE 8) | PVE shell | **R** |
| 0.3 | System status | "Ambiente isolado", "Network capture (MikroTik)" and "Suricata" with no error; the capture shows the RouterOS version | Administração > Status do sistema | **R** |
| 0.4 | Sniffer stopped before the test | `/tool/sniffer/print`: `running=no`, empty `filter-mac-address` | CHR Winbox or SSH | **R** |
| 0.5 | No orphan VM with the `SANDBOX_TAG` tag and no `deeplook-*` ISO in the storage | empty list | PVE (Datacenter > Search) | N |

### Phase 1 — Provisioning (R1, R2)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 1.1 | On the sample, **Análise** tab, "Abrir ambiente"; time it | phases: building the ISO, uploading, cloning, configuring, starting, running | environment panel | **R** |
| 1.2 | Total time until "running" | note it; with a linked clone, a few minutes at most | stopwatch | N |
| 1.3 | Clone type | linked clone (the VM disk points to the template); if it falls back to a full copy, the template snapshot is missing | PVE: VM Hardware | N |
| 1.4 | ISO as a read-only CD-ROM | `ide2` with the ISO, `media=cdrom` | PVE: VM Hardware | **R** |
| 1.5 | Capture opened before start | "Network traffic: capturing the VM traffic (MAC …)"; on the CHR, the VM MAC in `filter-mac-address` and `running=yes` | panel and `/tool/sniffer/print` | **R** |

### Phase 2 — Console (R3, R4)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 2.1 | "Abrir console (nova janela)" through the public address (with nginx) | VM screen, keyboard and mouse working | browser | **R** |
| 2.2 | `DEEPLOOK_BASE=https://<address> node scripts/ws-console-check.mjs <environment id> <dl_session cookie>` | RFB handshake and VNC authentication ok | terminal | N |
| 2.3 | Wait for two collections (2 min) | new screen thumbnails; on PVE 9, coming from the VNC console | "Environment artifacts" section | **R** |
| 2.4 | With the console open, check that the collection doesn't drop whoever is on it | the console stays connected | console window | **R** |

### Phase 3 — Agent and processes (R5)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 3.1 | After the first collection | process list with no agent warning; nothing under "appeared" | Environment artifacts | **R** |
| 3.2 | In the console, run the sample (section 2.3) | on the next collection, `notepad.exe` under "processes that appeared" (the sample's PowerShell has already finished; it shows in the Sysmon tree) | Environment artifacts | **R** |

### Phase 4 — Sysmon (R6)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 4.1 | After the collection following the sample | "VM Sysmon" section with events, no "unexpected format" | Environment artifacts | **R** |
| 4.2 | Process tree | `powershell.exe` with `notepad.exe` under it | tree | **R** |
| 4.3 | DNS queries | `deeplook-teste.invalid` (from `Resolve-DnsName`; `nslookup` bypasses the DNS client and Sysmon doesn't see it) and `testmynids.org` | DNS table | **R** |
| 4.4 | Connections, files and registry | connection to the `testmynids.org` IP:80; `C:\Users\Public\deeplook-teste.txt`; the `…\Run\DeepLookTeste` key | tables | N (the Sysmon configuration may filter some) |
| 4.5 | Accented path: create `C:\Users\Public\ação.txt` and wait for a collection | the name shows correctly, with no `?` or garbled characters | files table | N |
| 4.6 | Suggested IOCs | `testmynids.org` shows up in "Inserir IOCs sugeridos" in the new report | Relatórios tab | **R** |

### Phase 5 — Network capture and Suricata (R7 to R10)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 5.1 | During the environment | recent "Last packet" in the "Network capture (MikroTik)" component | System status | **R** |
| 5.2 | Close the environment ("Descartar ambiente") | "N packet(s), X MB" and the "Download the pcap" link | Network traffic | **R** |
| 5.3 | Download the pcap and open it in Wireshark; filter `dns.qry.name == "deeplook-teste.invalid"` and then `http.host == "testmynids.org"` | both show up; only the test VM's traffic (check the MACs in `eth.addr`) | Wireshark | **R** |
| 5.4 | Wait for Suricata (about 30 s with the ET Open rules) | the "DEEPLOOK teste da captura de rede" alert and the GPL/ET alert for `testmynids.org`; DNS and HTTP in the tables | Network traffic | **R** |
| 5.5 | Risk score | the `testmynids.org` alert adds to it (reason "Suricata"); the test rule doesn't | Detalhes tab, risk | **R** |
| 5.6 | Audit log | "Environment network capture downloaded" with the environment and the size | Administração > Auditoria | **R** |
| 5.7 | VLAN and checksum: if the VMs go out through a VLAN on the CHR, check that the pcap has the tagged frames and that Suricata still saw the DNS and HTTP | alerts and tables present | Wireshark and the section | N |

### Phase 6 — Closing and cleanup (R12)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 6.1 | After 5.2 | VM destroyed (no VMID in PVE) and the `deeplook-<id>.iso` ISO removed | PVE | **R** |
| 6.2 | Sniffer | `running=no` and empty `filter-mac-address` (it was the only environment) | `/tool/sniffer/print` | **R** |
| 6.3 | netcap | no open session: `docker compose exec netcap node -e "fetch('http://127.0.0.1:3700/health').then(r=>r.text()).then(console.log)"` shows `"sessions":0` | host | **R** |
| 6.4 | Artifacts after the end | screenshots, processes, Sysmon and traffic remain on the sample | Análise tab | **R** |

### Phase 7 — Two environments at once (R11)

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 7.1 | Open environment A; in the console, `ping -t <isolated network gateway>` | — | — | — |
| 7.2 | Open environment B (another sample); wait for it to start; close B | the sniffer gets both MACs and goes back to only A's | `/tool/sniffer/print` | **R** |
| 7.3 | Close A and open its pcap; filter `icmp` | the ping sequence with at most a few packets missing when B opened and closed; note how many | Wireshark | N |
| 7.4 | B's pcap | only frames with B's MAC | Wireshark (`eth.addr`) | **R** |

### Phase 8 — Induced failures (R12)

Do each one in a new environment and check that **the VM keeps working** and the reason shows on
screen.

| Step | Induce | Expected | |
|---|---|---|---|
| 8.1 | Stop the agent service in the VM (`Stop-Service QEMU-GA`) | "the qemu-guest-agent did not answer…" warning; screenshots continue | **R** |
| 8.2 | Change the `deeplook` user's password on the CHR and open an environment | "Network capture did not work: MikroTik sniffer: RouterOS refused the user or the password"; VM running; system status in error and a `status.down` line in the alert log (if on). Put the password back | **R** |
| 8.3 | `docker compose stop netcap` and open an environment | failed capture ("the netcap service did not answer"); VM running. `docker compose start netcap` | **R** |
| 8.4 | With an environment running, `docker compose restart api` | on startup the API checks: the environment goes on, the MAC stays in the sniffer and the capture keeps recording (pcap with packets from before and after) | **R** |
| 8.5 | With an environment running, `docker compose stop api`, destroy the VM by hand in PVE, `docker compose start api` | today the API does **not** notice the missing VM before the deadline: the environment stays "running" (with the agent warning in the artifacts) until the reaper closes it without error, removes the MAC from the sniffer and stores the pcap up to that point. Check that ending and note how long the MAC stayed in the sniffer | N |
| 8.6 | `SANDBOX_TTL_MINUTES=5` (just for this step), open one and wait | the reaper closes it on time; capture stored; VM and ISO removed | **R** |
| 8.7 | Open more environments than `SANDBOX_MAX_PER_USER` | refused with the limit message, no VM created | N |

### Phase 9 — Trash and backup

| Step | Action | Expected | Where to check | |
|---|---|---|---|---|
| 9.1 | Generate a backup with the files | the ZIP has `objects/sandbox/<sample>/<environment>/captura.pcap` and the screenshots | ZIP | N |
| 9.2 | Move the sample to the trash and empty it | the `sandbox/<sample>/…` objects leave MinIO | MinIO console (`127.0.0.1:9001`) | **R** |

## 4. Measurements to note

- Provisioning time (1.2) and closing time (from the click to "stopped").
- pcap size and packet count of a 10-minute environment with the sample.
- Suricata time with the ET Open rules (`idsMs` in the artifacts answer) and the container's peak
  memory (`docker stats suricata`).
- Packets lost in 7.3.

They are for tuning `NETCAP_MAX_MB`, `SURICATA_TIMEOUT_S`, `SURICATA_MEM_LIMIT` and
`SANDBOX_ARTIFACT_INTERVAL_S`.

## 5. Exit criteria

- **Ready for use:** every **R** step ok. Failing nice-to-haves become an item in the plan, with
  what was seen.
- **Not ready:** any **R** failing. What to do depends on the phase: permissions (0.2) and template
  (phase 1) belong to the environment; console, agent, Sysmon and capture with the right
  environment point to the code, and the step's log becomes the test case for the fix (in the
  mock, the fake RouterOS or the packet generator).

## 6. Precautions

- Use only the sample in section 2.3. Real malware comes after the script passes.
- The pcap holds the VM traffic: open it on the analysis machine, not on your everyday workstation.
- Undo what was changed in the induced failures (CHR password, `netcap` stopped, short TTL).
- At the end, repeat 0.4 and 0.5: no sniffer running, orphan VM or forgotten ISO.

## 7. Results log

Copy the table into the test log (date, the PVE, RouterOS and template Windows versions and the
DeepLook commit in the header):

| Step | R/N | Result (ok, failed, skipped) | Time / measurement | Note |
|---|---|---|---|---|
| 0.1 | R | | | |
| 0.2 | R | | | |
| … | | | | |

## 8. Automation

`scripts/sandbox-real-check.mjs` runs on its own the phases that need no hands in the VM:

```
node scripts/sandbox-real-check.mjs --read-only   # phase 0 only: checks PVE and DeepLook, creates nothing
node scripts/sandbox-real-check.mjs               # opens an environment, runs the sample through the agent and closes it
```

It reads the root `.env` and logs into DeepLook as `CHECK_EMAIL`/`CHECK_PASSWORD` (default: the
`.env` admin; with an analyst, the admin checks are "skipped"). `CHECK_BOOT_WAIT_S` (default 480)
is how long to wait for Windows to boot until the agent answers; if it doesn't, the script asks PVE
(`agent/info`) and records the raw message. In Proxmox it only reads; the only
write is the `agent/exec` that runs the sample in the test VM. **The template is never changed**:
writing to it is refused by the script and by DeepLook itself, and the end checks that the
template's configuration `digest` didn't change. If something fails halfway, the script closes the
environment it opened. It exits with an error if a required step fails and prints the section 7
table.

The original proposal, for reference: the script repeats on its own the part that needs no hands in the VM: phases 0, 1, 2.2, 3.1, 5.1, 6 and 9.2,
through the DeepLook API with an admin token, with a timeout on each step and the report in the
section 7 format. Running the sample in the VM (phases 3.2, 4 and 5.3 to 5.5) can come in too,
through PVE's `agent/exec`, if the account has the agent permission: the script runs the section
2.3 sample in the guest and waits for the events. Phases 7 and 8 stay manual (they change the
infrastructure).
