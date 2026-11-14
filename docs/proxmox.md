# 🔌 Communicating with Proxmox VE (analysis sandbox)

> 🇧🇷 [Leia em português](proxmox.pt-BR.md)

This guide explains how to configure DeepLook to talk to a real **Proxmox VE (PVE)** and open the
**analysis VM** (sandbox) from a sample.

> The integration **is already implemented in the code**. To "turn on" PVE you only need to
> **prepare Proxmox** and **fill in the `.env`** — there is no new code to write.

---

## 1. How it works

A sample becomes an **isolated VM per sample**: a clone of the template is created on
Proxmox, receives the sample as a **read-only CD-ROM** (an ISO9660 generated on the spot) and is
accessed through the **noVNC console** embedded in the sample's page. When it ends — or when the
deadline passes — the VM is destroyed and the ISO is deleted.

```
Analyst -> POST /api/entries/:id/sandbox
              │
              ├─ 1. MinIO: downloads the sample
              ├─ 2. genisoimage: builds the ISO (sample + SHA256.txt + LEIA-ME.txt)
              ├─ 3. PVE: uploads the ISO to the storage (streaming multipart)
              ├─ 4. PVE: clones the template (linked clone; falls back to a full copy if it fails)
              ├─ 5. PVE: config (tags + ide2=<iso>,media=cdrom)  # cdrom is already read-only
              └─ 6. PVE: start -> status RUNNING (console released)
```

Components involved (none needs to be changed):

| Component | File |
|---|---|
| PVE HTTP client (ticket, `pve()`, ISO upload, tasks, VNC) | `apps/api/src/lib/proxmox.ts` |
| Provisioning pipeline + reaper/cleanup | `apps/api/src/lib/sandbox.ts` |
| REST routes + console WebSocket | `apps/api/src/routes/sandbox.ts` |
| Simulator (without PVE) | `apps/api/src/lib/proxmox-mock.ts` |
| Console WebSocket proxy | `apps/web/nginx.conf` (`location /api/sandbox`) |
| `genisoimage` in the API image | `apps/api/Dockerfile` |
| Variables injected into the container | `docker-compose.yml` |
| Variable validation | `apps/api/src/env.ts` |

### Why ISO (and not uploading the file)?

The Proxmox API has no endpoint to "put a file inside the guest": the official path is to
mount a volume with `content=iso` and attach it as a CD-ROM. A `.exe` renamed to `.iso`
**does not** mount — that is why the API generates a real ISO9660 with `genisoimage` (already
installed in the API image).

### Console: why user/password and not an API token?

The console endpoints (`vncproxy`/`vncwebsocket`) **do not accept an API token**, only a user
ticket. The API then authenticates with `PROXMOX_USER`/`PROXMOX_PASSWORD` (`POST /access/ticket`),
caches the ticket (~2h) and opens the `vncwebsocket` **on the backend**. The browser only sees
`/api/sandbox/<id>/console/ws` (our WebSocket, proxied by nginx). The ticket never reaches the front end.

As the PVE ticket is bound to the IP, the proxy must leave from the **same container** that
requested the ticket — which is why the console tunnel is handled by the API, not by the browser.

**VNC auth:** `vncproxy` also returns a **password** (`data.password`), and PVE's `vncwebsocket`
requires **VNC auth** (type 2: DES over the challenge). The backend keeps that password per session,
and noVNC fetches it from `GET /api/sandbox/<id>/console/credentials` during the handshake; the
ticket stays only on the backend.

### Screen capture (screenshot)

The **"Capture screen"** button in the console window toolbar reads the pixels of the **noVNC canvas**
directly in the browser and opens the PNG in a new tab. This is deliberate: PVE **removed the
server-side screenshot endpoint** (on PVE 9 the route `/nodes/{node}/qemu/{vmid}/screenshot` responds
`501 Not implemented`), so client-side capture works on any PVE version. (DeepLook's
`GET /api/sandbox/:id/screenshot` endpoint still exists for PVE ≤ 8.)

---

## 2. Preparing Proxmox VE

### 2.1 Analysis VM template

1. Create a VM (Windows/Linux) with `qemu-guest-agent`, an **isolated network** (bridge with no
   route to the LAN) and **no corporate credentials**.
2. Install the analysis tools you use.
   - **Sysmon (optional, Windows):** with it, the environment artifacts include the process tree,
     the connections, the files created, the registry changes and the DNS queries. Download Sysmon
     from Microsoft (Sysinternals) and a ready-made configuration: we recommend
     [sysmon-modular](https://github.com/olafhartong/sysmon-modular) (`sysmonconfig.xml`), by Olaf
     Hartong; the [SwiftOnSecurity](https://github.com/SwiftOnSecurity/sysmon-config) one also works.
     In an administrator PowerShell:
     ```powershell
     .\Sysmon64.exe -accepteula -i sysmonconfig.xml
     # the channel must exist (DeepLook reads events 1, 3, 11, 12, 13, 14 and 22)
     Get-WinEvent -ListLog Microsoft-Windows-Sysmon/Operational
     ```
     The configuration must log event 22 (DNS) and 3 (network): both of the ones above do. Increase
     the log size if the sample is noisy
     (`wevtutil sl Microsoft-Windows-Sysmon/Operational /ms:67108864`). DeepLook installs nothing in
     the VM: without Sysmon, the screenshots and the process list remain.
   - **Sysmon on every session (recommended):** installed with `-i`, Sysmon is already a service
     that starts on every boot, but the log keeps what happened while the template was being
     prepared, and a stopped service would go unnoticed.
     [`scripts/template-windows/sysmon.bat`](../scripts/template-windows/sysmon.bat)
     runs on every boot of every environment and: installs Sysmon if the service doesn't exist (up to
     3 attempts, undoing the failed one), or just reapplies the configuration (changing the XML
     doesn't require reinstalling), raises the
     log to 64 MB, clears the log, so the environment starts with no old events, and checks that the
     service is running. What it did goes to `sysmon.log`, in the same folder.
     1. Put in a template folder with no spaces or parentheses in the path (e.g.
        `C:\Tools\Sysmon\`): `Sysmon64.exe`, `sysmonconfig.xml` and `sysmon.bat`.
     2. In an administrator prompt, register the task that runs at startup, as SYSTEM. The
        `/delay` and the wait inside the `.bat` exist because, at boot, the task can run before the
        Windows Event Log service, which Sysmon needs to register its channel (without it, the
        install fails with code 13):
        ```bat
        schtasks /create /tn "DeepLook\Sysmon" /tr "\"C:\Tools\Sysmon\sysmon.bat\"" /sc onstart /delay 0000:30 /ru SYSTEM /rl HIGHEST /f
        ```
     3. Run it once to check (`schtasks /run /tn "DeepLook\Sysmon"`), see
        `sysmon.log` end with "Sysmon running, log cleared" and restart the VM to check that it
        runs on its own at boot.
     4. Shut the VM down and convert it to a template. `node scripts/sandbox-real-check.mjs` checks
        the Sysmon read in a real environment (phase 4).

     The clearing is only to start from scratch: DeepLook reads the events since each environment
     started.
   - **Automatic logon (recommended):** with the template logging in to a regular user (no
     administrator privilege) on its own, the automatic sample run happens in that user's session
     and shows in the console. Set it up with `netplwiz` or with Sysinternals
     [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon). With no user logged
     in, the sample runs as SYSTEM, off screen.
3. **Create a snapshot** (the linked clone uses this state as its base; without a snapshot DeepLook
   automatically falls back to a full copy, which is slower).
4. Convert it to a template: `qm template <vmid>`. Note the `<vmid>`.

### 2.2 Dedicated user and permissions

Create a dedicated user (e.g. `deeplook@pve`) with a **password** — the console requires
user/password, **an API token does not work**.

Grant the permissions below (**Datastore** is the most often forgotten — without it the ISO upload
**or** the clone fails with `403`):

| Path | Suggested role | Covers |
|---|---|---|
| `/` | `PVEAuditor` | `GET /version` (health) and general auditing |
| `/vms` (propagate) | `PVEVMAdmin` | `VM.Audit`, `VM.Allocate` (clone/delete), `VM.Clone`, `VM.Config.*`, `VM.PowerMgmt` (start/stop), `VM.Console` (vncproxy/screenshot), use of the VM agent (`VM.GuestAgent.Unrestricted` on PVE 9, `VM.Monitor` on 8) for the artifacts' process list |
| `/storage/<PROXMOX_ISO_STORAGE>` | `PVEDatastoreAdmin` | `Datastore.Audit`, `Datastore.AllocateTemplate` (ISO upload), `Datastore.Allocate` (ISO delete) |
| `/storage/<storage of the template disks>` | `PVEDatastoreAdmin` | `Datastore.AllocateSpace` so the clone can create its disks |
| `/sdn/zones/<zone>/<template bridge>` | `PVESDNUser` | `SDN.Use` so the clone can reuse the template network |

> **`/vms`, never `/vms/<vmid>`.** The clone gets a **new VMID** and PVE checks
> `VM.Allocate` on `/vms/<new vmid>`; a permission granted only on the template
> (`/vms/1000`) does not apply to the clone. In that case PVE answers just
> `Permission check failed` (no path), because the `clone` check is an `or`.

> **Network:** the `SDN.Use` check uses the `localnetwork` zone for classic bridges
> (`vmbr1` → `/sdn/zones/localnetwork/vmbr1`). The template's bridge is in
> `qm config <template>` (line `net0`).

With your template values (replace `<template>`, the storages and the bridge with
the ones from `qm config <template>`):

```bash
# 1. VMs: the clone uses a new VMID, so the permission goes on /vms (propagate).
pveum acl modify /vms --users deeplook@pve --roles PVEVMAdmin --propagate 1
# 2. Template network (net0 line): a classic bridge lives in the localnetwork zone.
pveum acl modify /sdn/zones/localnetwork/<bridge> --users deeplook@pve --roles PVESDNUser
# 3. ISO storage and every storage that holds a template disk.
pveum acl modify /storage/<iso-storage> --users deeplook@pve --roles PVEDatastoreAdmin
pveum acl modify /storage/<disk-storage> --users deeplook@pve --roles PVEDatastoreAdmin
```

To check what the account really sees (PVE lists the effective privileges per
path):

```bash
pvesh get /access/permissions --output-format json | grep -A20 '"/vms"'
```

Calls the API makes to PVE (reference for the permissions above):

- `GET /version`
- `GET /nodes/{node}/qemu` and `GET /nodes/{node}/qemu/{vmid}/status/current`
- `GET /cluster/nextid`
- `POST /nodes/{node}/qemu/{tpl}/clone`
- `PUT /nodes/{node}/qemu/{vmid}/config`
- `POST /nodes/{node}/qemu/{vmid}/status/start` (and `shutdown`)
- `DELETE /nodes/{node}/qemu/{vmid}`
- `POST /nodes/{node}/storage/{storage}/upload`
- `GET/DELETE /nodes/{node}/storage/{storage}/content`
- `GET /nodes/{node}/storage/{storage}/status`
- `POST /nodes/{node}/qemu/{vmid}/vncproxy` + `vncwebsocket`
- `POST /nodes/{node}/qemu/{vmid}/screenshot` *(removed in PVE 9 — the panel's capture was moved to the browser)*

### 2.3 Storage with `content iso`

The storage where the ISO will be written must accept `content=iso` (e.g. `local`).
In PVE: **Datacenter → Storage → <storage> → Content → tick "ISO image"**.
The `/api/sandbox/health` endpoint validates this.

---

## 3. Configuring the `.env`

The root `.env` is read automatically by `docker-compose.yml` (no need to edit the compose file).
Start from `.env.example` (`cp .env.example .env`) and adjust the sandbox block. **Real mode** (points to PVE):

```dotenv
# ---- Sandbox (isolated VM on Proxmox VE) ----
SANDBOX_ENABLED=true
SANDBOX_CONSOLE_ENABLED=true
PROXMOX_MOCK=false                            # turns off the simulator

PROXMOX_API_URL=https://192.168.0.10:8006     # real PVE IP (port 8006)
PROXMOX_NODE=pve                              # cluster node
PROXMOX_USER=deeplook@pve                     # user+password (a token will NOT work for the console)
PROXMOX_PASSWORD=<strong-password>
PROXMOX_TEMPLATE_VMID=9000                    # template vmid (section 2.1)
PROXMOX_ISO_STORAGE=local                     # storage with content "iso"
PROXMOX_VERIFY_TLS=false                      # false if the PVE certificate is self-signed

SANDBOX_TAG=deeplook-sandbox
SANDBOX_TTL_MINUTES=60
SANDBOX_MAX_ACTIVE=4
SANDBOX_MAX_PER_USER=2
```

> ⚠️ The repository's development `.env` usually comes with `PROXMOX_MOCK=true` (in-memory
> simulator). While it is `true`, **nothing touches the real PVE**. The first change is to switch it to `false`.

**Mandatory validation:** when `SANDBOX_ENABLED=true` and `PROXMOX_MOCK=false`, `apps/api/src/env.ts`
requires `PROXMOX_API_URL`, `PROXMOX_USER`, `PROXMOX_PASSWORD` and `PROXMOX_TEMPLATE_VMID`. If any of
them is missing, the API **does not start** and logs the validation error at boot.

---

## 4. Network (Docker → PVE)

The `api` container runs on the `deeplook` bridge and must reach `https://<pve>:8006`:

- Traffic leaves NATed through the Docker host, so PVE sees the **IP of the Docker host**. The PVE
  ticket is bound to that IP — and since **all** calls (ticket + `vncwebsocket`) leave from the same
  container, this is consistent.
- If there is a **firewall** on PVE, allow port **8006** from the Docker host's IP.
- Use the **LAN IP** of PVE (not `localhost`, which inside the container points to the container itself).
- `PROXMOX_VERIFY_TLS=false` (default) avoids the self-signed certificate error; only use `true` if
  the PVE certificate is trusted.

---

## 5. Starting up and validating

```powershell
docker compose up -d --build api web
docker compose logs -f api
```

The logs should show something like:
`[sandbox] habilitado (node pve, template 9000, ttl 60min)` (enabled).

Validation:

1. **Diagnostics** — `GET /api/sandbox/health` (admin) returns the checks `pve-acessivel`,
   `template`, `storage-iso` and `usuario-console`, plus `enabled`, `mock`, `node`, `templateVmid`,
   `isoStorage` and the limits.
2. **Full flow**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/smoke-sandbox.ps1
   ```
   The script opens the environment, follows the stages (`gerando-iso` → `enviando-iso` → `clonando`
   → `configurando` → `iniciando`), tests the screenshot, validates the console WebSocket
   (`scripts/ws-console-check.mjs`), extends the deadline and discards the VM.

---

## 6. Quick reference of the variables

| Variable | Description | Default |
|---|---|---|
| `SANDBOX_ENABLED` | Enables the sandbox (isolated VM on Proxmox) | `false` |
| `SANDBOX_CONSOLE_ENABLED` | Enables the noVNC console (dedicated window) for the analyst | `true` |
| `PROXMOX_MOCK` | Simulates Proxmox in memory (no real PVE) | `false` |
| `PROXMOX_API_URL` | PVE API URL (e.g. `https://192.168.0.10:8006`) | — |
| `PROXMOX_NODE` | Cluster node where the VMs are created | `pve` |
| `PROXMOX_USER` / `PROXMOX_PASSWORD` | Dedicated PVE user (the console does not accept an API token) | — |
| `PROXMOX_TEMPLATE_VMID` | VMID of the template with `qemu-guest-agent` and isolated network | `0` |
| `PROXMOX_ISO_STORAGE` | Storage that accepts `content iso` (where the sample becomes an ISO) | `local` |
| `PROXMOX_VERIFY_TLS` | `true` only if the PVE certificate is trusted | `false` |
| `SANDBOX_TAG` | Tag of the DeepLook VMs (used in cleanup) | `deeplook-sandbox` |
| `SANDBOX_TTL_MINUTES` | Lifetime of the environment before automatic disposal | `60` |
| `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` | Limit of active environments (total / per analyst) | `4` / `2` |
| `SANDBOX_MOCK_VNC_URL` | (mock mode) test VNC to validate the console | — |

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| API does not start / env error at boot | Missing `PROXMOX_API_URL`/`USER`/`PASSWORD`/`TEMPLATE_VMID` with `SANDBOX_ENABLED=true` and `MOCK=false` |
| `sandbox/health` → `pve-acessivel: FALHOU` (failed) | Wrong IP/port, PVE unreachable from the container, or firewall on 8006 |
| ISO upload fails with `403` | Missing `PVEDatastoreAdmin` on the ISO storage: `Datastore.AllocateTemplate` for upload and `Datastore.Allocate` for delete |
| Clone fails with `403` and the message is only `Permission check failed` (no path) | Missing `VM.Allocate` on `/vms`: the permission was granted on `/vms/<template>`. The clone uses a new VMID and PVE's `or` check does not detail the path |
| Clone fails with `403 (/sdn/zones/..., SDN.Use)` | Missing `PVESDNUser` (or `SDN.Use`) on the template bridge — classic bridges live in the `localnetwork` zone |
| Clone fails with `403 (/storage/<id>, Datastore.AllocateSpace)` | Missing `PVEDatastoreAdmin` on the storage of the template disks (`qm config <template>`: `sata0`, `scsi0`, `efidisk0`, `tpmstate0`...), not only on the ISO storage |
| Clone fails with `500 (only root can set 'hostpci0' …)` (or `'args'`) | The template has an option that only `root@pam` can apply in PVE: unmapped PCI passthrough (`hostpci`, e.g. a GVT-g vGPU) or `args` (e.g. fake SMBIOS against VM detection). For `hostpci`, create a mapping in Datacenter > Resource Mappings, use `mapping=<name>` in the template and give `Mapping.Use` to the DeepLook user on `/mapping/pci/<name>`. For `args`, remove it from the template (`smbios1` covers part of the SMBIOS without root) or use a template just for DeepLook. Don't use `root@pam` in DeepLook |
| `template: false` | Wrong `PROXMOX_TEMPLATE_VMID`, template does not exist, or missing `VM.Audit`/`VM.Clone` |
| `storage-iso: false` | The storage does not have `content "iso"` enabled |
| Console does not open | Missing user/password (`usuario-console`) or the `nginx` WebSocket was changed; check `location /api/sandbox` |
| Slow clone | Template without a snapshot → falls back to a full copy. Create a snapshot |
| VM "stuck" in PROVISIONING | The API recovers it on boot (marks it FAILED after 15 min) and the reaper cleans up orphans every minute |

Always start with diagnostics: **`GET /api/sandbox/health`** (admin).

---

## 8. Mock mode and shutting down

- **Without PVE (development):** `SANDBOX_ENABLED=true` + `PROXMOX_MOCK=true` simulates clone,
  start, tasks, vncproxy and screenshot in memory. Validate with `scripts/smoke-sandbox.ps1`.
- **Turning the feature off:** `SANDBOX_ENABLED=false`. The analyst panel shows "not enabled" and the
  endpoints respond `503`, without requiring anything from PVE.

### Limits, TTL and cleanup

- `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` limit how many environments exist.
- `SANDBOX_TTL_MINUTES` sets the deadline; the **reaper** runs every minute and ends whatever has expired.
- On boot the API marks interrupted provisionings as failed, removes VMs with the `SANDBOX_TAG` label
  that have no active session, and orphan `deeplook-*` ISOs.
- `GET /api/sandbox/health` (admin) shows the full diagnostics.

## 9. Network capture through the MikroTik CHR (optional)

With the VM traffic going through a MikroTik CHR (RouterOS 7), DeepLook records **one pcap per
environment** and hands it to **Suricata** with the **ET Open** rules. The result shows up in the
environment section: alerts, DNS queries, HTTP requests, TLS connections and the pcap download.
Domains and IPs go into the suggested IOCs, and an alert adds to the risk score. Without this
configuration, the sandbox stays the same.

```
analysis VM ──(isolated bridge)── CHR ──► controlled internet
                                   │ sniffer (TZSP, UDP 37008)
                                   ▼
                 DeepLook host: netcap ──pcap──► MinIO ──► suricata
```

How it works: when an environment opens, before the VM starts, the API reads its MAC (`net0` of the
clone), opens a session in the `netcap` service and puts the MAC in the `filter-mac-address` of the
CHR `/tool/sniffer`, through the REST API, streaming over TZSP to `netcap`. On closing, it removes the
MAC, fetches the pcap, stores it in MinIO (it is in the backup and leaves with the sample when the
trash is emptied) and sends it to Suricata. There is one sniffer per router: each change stops it,
reconfigures it and starts it again with the list of every environment capturing, which pauses the
others' capture for a few milliseconds.

### 9.1 On RouterOS

1. Turn on the REST API (`www-ssl` service, with a certificate) only for the DeepLook IP:
   ```
   /certificate add name=rest common-name=chr.lab days-valid=3650 key-usage=tls-server
   /certificate sign rest
   /ip service set www-ssl disabled=no certificate=rest address=<DeepLook IP>/32
   ```
2. A group and a user just for DeepLook. REST requires `read` and `write` (which apply to the whole
   configuration), so restrict the user to the DeepLook IP:
   ```
   /user group add name=deeplook policy=read,write,rest-api,sniff,!local,!telnet,!ssh,!ftp,!reboot,!policy,!test,!winbox,!password,!web,!sensitive,!api,!romon
   /user add name=deeplook group=deeplook address=<DeepLook IP>/32 password=<strong password>
   ```
3. If the VMs go out through a single interface, name it in `MIKROTIK_SNIFFER_INTERFACE` (e.g.
   `ether2`); empty, the sniffer listens on all of them.

DeepLook only touches `/tool/sniffer`. Don't keep another capture configured there: the MAC list is
replaced for every environment.

### 9.2 On the DeepLook host

1. In `.env`:
   ```
   COMPOSE_PROFILES=netcap
   MIKROTIK_URL=https://<CHR IP>
   MIKROTIK_USER=deeplook
   MIKROTIK_PASSWORD=<password>
   NETCAP_URL=http://netcap:3700
   NETCAP_TOKEN=<openssl rand -hex 24>
   NETCAP_STREAM_TARGET=<this host's IP, as the CHR sees it>:37008
   NETCAP_TZSP_SOURCES=<CHR IP>
   SURICATA_URL=http://suricata:3800
   SURICATA_TOKEN=<openssl rand -hex 24>
   ```
   The password and the tokens accept `NAME_FILE` (Docker secrets).
2. **Firewall:** TZSP is UDP without authentication. A port published by Docker bypasses the host
   `ufw`, so restrict it three ways:
   - `NETCAP_TZSP_BIND=<IP of the interface facing the CHR>` publishes the port only there;
   - `NETCAP_TZSP_SOURCES` makes netcap drop anything not coming from the CHR;
   - a rule in the `DOCKER-USER` chain:
     ```
     iptables -I DOCKER-USER -p udp --dport 37008 ! -s <CHR IP> -j DROP
     ```
3. `docker compose up -d --build`. On the first start, `suricata` downloads the ET Open rules through
   `egress` (the controlled way out); after that, once a day. Until then it runs with only the
   DeepLook test rule and still extracts DNS, HTTP and TLS from the traffic.

### 9.3 Validating

1. **Administração > Status do sistema:** "Network capture (MikroTik)" shows the RouterOS version,
   and "Suricata" shows how many ET Open rules were downloaded.
2. Open an environment. In the VM, run `nslookup deeplook-teste.invalid` (the domain never resolves).
3. Close the environment. The "Network traffic" section shows the pcap and the **"DEEPLOOK teste da
   captura de rede"** alert. It checks the whole path (sniffer, netcap, MinIO and Suricata) and does
   not add to the risk.

The automatable part of the test against the real Proxmox (console, agent, processes, Sysmon,
automatic run and cleanup) runs with `node scripts/sandbox-real-check.mjs`; the options are in the
script's header.

Common problems:

| Symptom | Likely cause |
|---|---|
| "RouterOS refused the user or the password" | user, password or the user's `address` on RouterOS |
| "no connection to RouterOS" | `www-ssl` off, the service `address`, or a certificate with `MIKROTIK_VERIFY_TLS=true` |
| pcap with 0 packets | the CHR can't reach `NETCAP_STREAM_TARGET`, firewall, or `NETCAP_TZSP_SOURCES` with another IP (the status shows the last packet received) |
| Suricata "without the ET Open rules" | `egress` has no way out to `rules.emergingthreats.net` |

Limits: `NETCAP_MAX_MB` per environment (default 200 MB; past it, the end is left out and the screen
says so), `SURICATA_MAX_MB` (256 MB) and `SURICATA_TIMEOUT_S` (600 s).
