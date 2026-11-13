# 🚀 Deployment checklist (homelab pilot)

> 🇧🇷 [Leia em português](implantacao.pt-BR.md)

Runbook for bringing DeepLook up on the homelab and opening it to a small group of people to test.
Each step says **what to do**, **how to check it** and, when one already exists, **where the detail is** in the
[README](../README.md). Follow the order: the first steps protect what comes after.

> Convention: `deeplook.seu-dominio.com` is the public address; `/srv/deeplook` is where the project
> lives on the host; `/mnt/externo` is the external backup disk. Replace them with yours.

---

## 0. Before you start

- [ ] **Linux host with Docker 28 or newer.** The full network isolation of the capture
  (`inhibit_ipv4`, item 6.19) depends on this; on an older Docker, the network remains internal, but
  the host itself may still be reachable through the bridge.
  ```bash
  docker version --format '{{.Server.Version}}'   # 28.x or newer
  docker compose version
  ```
- [ ] **Memory:** about 10 GB free. ClamAV uses 1.5 to 3 GB (the signature database is kept in
  memory), the API has a 4 GB ceiling (`API_MEM_LIMIT`), function analysis (capa and FLOSS) 3 GB
  (`CAPA_MEM_LIMIT`; it only uses that during an analysis), Ghidra 6 GB (`GHIDRA_MEM_LIMIT`; only when
  an analyst asks) and the capture 1 GB. Disk: the images add up to about 3.5 GB (Ghidra alone, 1.45 GB).
- [ ] **Disk:** the one for the data (`./data`) and an **external disk** (or NAS) for the backup.
- [ ] **User namespaces enabled** (the Chromium sandbox of the capture needs them):
  ```bash
  sysctl user.max_user_namespaces                          # greater than 0
  sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null   # 0, or absent
  ```
  Details in the README > [Link page capture](../README.md#link-page-capture).

## 1. Code and secrets

- [ ] Clone and prepare the `.env`:
  ```bash
  cd /srv && git clone git@github.com:<you>/deeplook.git && cd deeplook
  cp .env.example .env && chmod 600 .env
  ```
  Edit `.env` as UTF-8 **without a BOM**: with a BOM, the shell's `. ./.env` misreads the first
  line (old Windows Notepad saves with a BOM). Copies such as `.env.bak` stay out of Git (`.env.*`
  in `.gitignore`), but keep them outside the project folder, with `chmod 600`.
- [ ] **Generate the secrets** (one per line; never reuse them across variables):
  ```bash
  for v in POSTGRES_PASSWORD SESSION_SECRET DATA_KEY CAPTURE_TOKEN CAPA_TOKEN GHIDRA_TOKEN \
    UNPACK_TOKEN OLETOOLS_TOKEN MINIO_ROOT_PASSWORD; do
    echo "$v=$(openssl rand -hex 32)"; done
  ```
  `S3_SECRET_KEY` must be **equal** to `MINIO_ROOT_PASSWORD`. Also set `ADMIN_EMAIL` and your own
  `ADMIN_PASSWORD`: the published default passwords are refused in production.
  The same goes for the database and MinIO passwords: with the value from compose or `.env.example`,
  the API **will not start** and says which variable to change.
- [ ] **Only for an installation that already has data** and still uses the default database password: Postgres
  stores the password when the volume is created, and changing `.env` alone would leave the API unable to connect.
  Change it in the database first, then in `.env`:
  ```bash
  docker compose exec db psql -U deeplook -d deeplook   # the values of POSTGRES_USER and POSTGRES_DB
  # in psql, type:  \password deeplook     (asks for the new password twice, without showing it)
  # then put the same password in POSTGRES_PASSWORD in .env and:
  docker compose up -d api
  ```
  MinIO does not need this: it reads `MINIO_ROOT_PASSWORD` on every start; just change both
  variables (`MINIO_ROOT_PASSWORD` and `S3_SECRET_KEY`) together and start again.
- [ ] **Permissions:** if the files came from a Windows copy, remove write access for "others"
  (item 6.21):
  ```bash
  find . \( -type f -o -type d \) -perm -o+w -user "$(id -un)" -exec chmod o-w {} +
  ```

## 2. Internet access: Tunnel, secure cookie and Cloudflare Access

- [ ] **Cloudflare Tunnel** on the host pointing to `http://localhost:8080`. Step by step in the
  README > [Cloudflare Tunnel](../README.md#cloudflare-tunnel-on-the-host-outside-docker).
- [ ] **`COOKIE_SECURE=true`** in `.env` (the Tunnel serves HTTPS). Without it, the session cookie
  is sent without `Secure` and without the `__Host-` prefix.
- [ ] **Cloudflare Access in front** (Zero Trust > Access > Applications > *Self-hosted*,
  domain `deeplook.seu-dominio.com`):
  - an *Allow* policy only with the emails of the pilot people (login by code sent to the email);
  - session duration of, for example, 24 h.

  DeepLook has login, 2FA and CAPTCHA, but it receives malware: it should not be open to the whole
  Internet. With Access, whoever is not on the list does not even reach the login screen.
- [ ] **Machine clients go through an Access service token.** Uptime Kuma, a MISP or a TIP do not
  do the email login; without this, the monitor and the feed get stuck at Access:
  - Zero Trust > Access > Service Auth > *Create Service Token*;
  - in the application, a second policy, **Service Auth**, with this token;
  - the client sends the two headers **in addition to** the DeepLook token:
    ```
    CF-Access-Client-Id: <id>.access
    CF-Access-Client-Secret: <secret>
    Authorization: Bearer dlk_...
    ```
    (MISP accepts extra headers on the feed; Uptime Kuma, under *Headers*).

## 3. Link capture: exit through a VPN

The capture browser opens malicious links. Without a VPN, it opens them **from your home IP**: the
owner of the page sees that IP, and your ISP may receive an abuse complaint.

- [ ] **Choose:** a VPN for the capture, **or** the capture turned off in the pilot (`CAPTURE_URL=` empty
  in `.env`; the rest of DeepLook works).
- [ ] **With a VPN (WireGuard on the host, interface `wg0`):** the `capture-egress` network has a fixed subnet
  (`CAPTURE_EGRESS_SUBNET`, default `172.31.252.0/24`). Send only it through the VPN, with source-based routing:
  ```bash
  sudo ip route add default dev wg0 table 252
  sudo ip rule add from 172.31.252.0/24 table 252 priority 252
  ```
  (make it permanent in the `PostUp`/`PostDown` of `wg0` or in the host's network manager).
- [ ] **Check** after starting it up (step 6): the capture's outbound IP is the VPN's, not yours.
  ```bash
  docker compose exec egress node -e "require('https').get('https://ifconfig.me/ip',r=>r.pipe(process.stdout))"
  curl -s https://ifconfig.me/ip   # the host's: must be DIFFERENT
  ```
  The `egress` DNS goes through Docker's embedded resolver and **may** leave through the host's resolver,
  outside the VPN (not measured). If your ISP should not see the captured domains, check with
  `sudo tcpdump -ni <home interface> port 53` during a capture and, if it leaks, point `egress` to a VPN
  DNS (`dns:` in compose).

## 4. Sandbox (Proxmox): off in the pilot

- [ ] **`SANDBOX_ENABLED=false`**, unless the analysis VMs are on a **VLAN with no route to
  your LAN** and with controlled outbound access. Details in [docs/proxmox.md](proxmox.md).
- [ ] **If you are going to enable the sandbox**, prepare the dedicated user in PVE **before**
  starting the API. Replace `<template>`, `<bridge>`, `<iso-storage>` and `<disk-storage>` with the
  values from `qm config <template>` (`net0`; `sata0`/`scsi0`/`efidisk0`/`tpmstate0`):
  ```bash
  # the clone uses a new VMID: VM.Allocate goes on /vms (propagate), not on /vms/<template>
  pveum acl modify /vms --users deeplook@pve --roles PVEVMAdmin --propagate 1
  pveum acl modify /sdn/zones/localnetwork/<bridge> --users deeplook@pve --roles PVESDNUser
  pveum acl modify /storage/<iso-storage> --users deeplook@pve --roles PVEDatastoreAdmin
  pveum acl modify /storage/<disk-storage> --users deeplook@pve --roles PVEDatastoreAdmin
  ```
- [ ] **Check** what the PVE account sees (the list must contain `VM.Allocate` on `/vms`) and the
  integration through `GET /api/sandbox/health` (admin), before opening the first environment:
  ```bash
  pvesh get /access/permissions --output-format json | grep -A20 '"/vms"'
  ```
  Without `VM.Allocate` on `/vms`, the clone fails with `403 Permission check failed` **without a
  path** in the body (PVE's `or` check does not detail the privilege); the rest is in
  [docs/proxmox.md](proxmox.md).

## 5. Backup outside the disk, scheduled and restored once

- [ ] **External disk mounted** with `nofail` (the host boots even without it) and the DeepLook folder:
  ```bash
  sudo mkdir -p /mnt/externo/deeplook
  sudo touch /mnt/externo/deeplook/.deeplook-backups   # the marker: without it the API refuses to write
  sudo chown -R 1000:1000 /mnt/externo/deeplook
  ```
  The marker exists for the case of an unmounted disk: the mount point becomes an empty folder **on the
  main disk**, and without the marker the backup would be written there without anyone noticing.
- [ ] In `.env`:
  ```bash
  BACKUP_DIR=/mnt/externo/deeplook
  BACKUP_SCHEDULE_PASSWORD=<openssl rand -base64 24>
  ```
  **Keep the `BACKUP_SCHEDULE_PASSWORD` outside the server** (password manager): without it, the
  backup cannot be opened, and a backup that only opens with something that was on the lost disk is useless.
- [ ] After starting it up (step 6): **Administration > Backup > Scheduled backup**, choose the days and
  the time (the calendar shows the upcoming runs) and save.
- [ ] **Rehearse the restore once**, before inviting anyone. Generate a manual backup and run the
  rehearsal, which restores into a temporary database and bucket, compares the counts with those in
  `manifest.json` and deletes both (README > [Backup and restore](../README.md#backup-and-restore)):
  ```bash
  scripts/restore.sh /mnt/externo/deeplook/deeplook-backup-*.zip --rehearsal
  ```
  It must end with `ensaio concluído: o backup volta`.

## 6. Start up

- [ ] Start and wait for everything to be healthy:
  ```bash
  docker compose up -d --build
  docker compose ps        # api, web and egress "healthy"; db, minio, clamav and capture "running"
  curl -fsS http://127.0.0.1:8080/api/health/ready && echo ready
  ```
  ClamAV takes a few minutes the first time (it downloads the signature database).

## 7. First access and accounts

- [ ] Sign in with `ADMIN_EMAIL` and change the password (requested on first access).
- [ ] **Turn on the admin's 2FA** (My Account > 2FA). Details in the
  README > [2FA](../README.md#two-factor-authentication-2fa).
- [ ] Decide in **Administration > Settings** whether a regular user only sees their own samples.
- [ ] **Administration > Activation keys:** one key per person. Testers join as **user**; promote to
  **analyst** only those who will triage and write reports.
- [ ] If you will use the feed (TAXII/MISP) or the monitor, enable "API access" only for the admin who
  generates those tokens.

## 8. Monitoring

- [ ] **Status token** (My Account > API tokens > *Monitoring* purpose).
- [ ] **Uptime Kuma** (or Zabbix): HTTP monitor at
  `https://deeplook.seu-dominio.com/api/status?strict=1`, with the `Authorization: Bearer` of the
  token and the Access service token headers (step 2). `strict=1` responds **503**
  when something is in error: database, MinIO, antivirus, **scheduled backup that failed or fell behind**.

## 9. Final check

- [ ] **Administration > Status:** nothing in error, and no "Configuration" alert (default password,
  `COOKIE_SECURE` off or `TRUSTED_NETWORK` empty).
- [ ] **Antivirus:** upload a file with the EICAR test string; the card shows the detection.
- [ ] **Capture** (if on): capture `https://example.com/`; you get a screenshot, status 200 and the
  certificate, and the outbound IP is the VPN's (step 3).
- [ ] **Backup:** generate a manual one; it appears in the external disk folder with the `.sha256` beside it
  (`sha256sum -c` checks it).
- [ ] **From outside, not on the Access list** (phone on 4G, for example): the address asks for the Access
  login and does not show the DeepLook screen.
- [ ] **Monitor:** take the API down for a minute (`docker compose stop api`) and see the alert arrive;
  start it again.

## 10. Operation

- [ ] **Update:**
  ```bash
  git pull
  docker compose down && docker compose up -d --build   # down recreates the networks when they change
  ```
  Database migrations run by themselves when the API starts; the data stays in `./data`.
- [ ] **After each Playwright update** (Dependabot PR):
  `node scripts/chromium-unsafe-ports.mjs` checks the `egress` port list.
- [ ] **On GitHub:** follow the CI of each push, the **weekly Trivy** (*Security scan*) and the
  **Dependabot** PRs. A new CVE in a base image shows up there.
- [ ] **Logs:** `docker compose logs -f api` (rotation of 10 MB × 3 per service, item 6.6).

## 11. Agreed with the testers

- [ ] What is submitted is treated as **real malware** (it is stored, scanned and, if checked,
  goes into the backup).
- [ ] It is a **pilot**: there may be instability, and the data may be deleted at the end.
- [ ] A channel for reports (group, GitHub issue) and who responds.
- [ ] Do not submit personal or client documents that must not be kept on the server.
