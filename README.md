# 🔍 DeepLook

> 🇧🇷 [Leia em português (pt-BR)](README.pt-BR.md)

Self-hosted (homelab) tool so that friends and security specialists can centralize
**software samples and suspicious links** found on the web, with **triage and reports**
written by the analysts.

It is exposed to the Internet through a **Cloudflare Tunnel running on the host (outside Docker)**.

Special thanks to [Dudu](https://github.com/lluiseduardo-silva), who provided the means to
validate the application with Strix. Thank you ❤️.

---

## Architecture

```
                 Internet
                    │
        ┌───────────▼────────────┐
        │ Cloudflare Tunnel      │  (OUTSIDE Docker, on the host)
        │ cloudflared            │  points to http://localhost:8080
        └───────────┬────────────┘
                    │ 127.0.0.1:8080 (published only on the loopback)
   ┌────────────────▼──────────────────────────────────────────┐
   │                     docker compose                        │
   │  ┌────────┐  /api   ┌────────┐   SQL   ┌──────────────┐   │
   │  │ web    │────────▶│ api    │────────▶│ db (postgres)│   │
   │  │ nginx  │         │ Fastify│         └──────────────┘   │
   │  │ +React │         │ Prisma │   S3    ┌──────────────┐   │
   │  │ Carbon │         └───┬────┘────────▶│ minio        │   │
   │  └────────┘             │              └──────────────┘   │
   │                         │  clamd :3310 ┌──────────────┐   │
   │                         └─────────────▶│ clamav       │   │
   │                                        └──────────────┘   │
   └───────────────────────────────────────────────────────────┘
```

- **web**: nginx serving the build (React + Carbon) and proxying `/api` to the API. It runs
  **as non-root** (`nginx-unprivileged` image, internal port 8080), with a read-only filesystem,
  no capabilities and a memory limit; the host publishes `127.0.0.1:8080`.
- **api**: Fastify + Prisma. On boot it applies migrations, runs the admin seed and ensures the bucket exists in MinIO.
- **db**: PostgreSQL 16.
- **minio**: S3-compatible storage for the samples (never exposed publicly).
- **clamav**: ClamAV antivirus (`clamd` + `freshclam`), internal network only; it scans every
  uploaded file.
- **capa**: function analysis (capa and FLOSS) of the executables uploaded, on an internal network
  with only the API, no internet, non-root and with a read-only root. See
  [Function analysis](#function-analysis-capa-and-floss).
- **ghidra**: Ghidra headless, on demand, with the same isolation as capa. See
  [Ghidra analysis](#ghidra-analysis).
- **unpack**: identifies the executables with Detect It Easy and unpacks them (UPX, installers,
  PyInstaller), with the same isolation. See [Identify and unpack](#identify-and-unpack).
- Port published on the host: **`127.0.0.1:8080`** (consumed by the Cloudflare Tunnel).

---

## Requirements

- Docker + Docker Compose (the `docker compose` plugin).
- (Optional, for exposing it) `cloudflared` installed **on the host**.

---

## How to run

```bash
# 1) Configure the variables (passwords, session secret, admin)
cp .env.example .env
# edit .env, mainly: POSTGRES_PASSWORD, SESSION_SECRET, CAPTURE_TOKEN, CAPA_TOKEN,
# GHIDRA_TOKEN, UNPACK_TOKEN, ADMIN_PASSWORD, MINIO_ROOT_PASSWORD and S3_SECRET_KEY
# (with SESSION_SECRET, one of the tokens, or the database or MinIO password at the default value, the API will not start)

# 2) Bring everything up
docker compose build
docker compose up
```

Access: **http://localhost:8080**

> **To open it to other people** (homelab, pilot): follow the
> [deployment checklist](docs/implantacao.md), which covers Cloudflare Access, the capture VPN,
> the backup kept outside the restored disk, and monitoring.

> Tip: run in the background with `docker compose up -d` and view the logs with
> `docker compose logs -f`.

> **Updating an installation made before the trusted network:** the `deeplook` network gained a
> fixed subnet, and Docker does not change a network that already exists. Run `docker compose down`
> before `docker compose up -d --build` (the data stays in `./data`, nothing is lost). The migration
> swaps the session ids for hashes without logging anyone out.

---

## First access

The **admin** is created automatically on the first boot from the variables
`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`.

1. Log in at **/login** with those credentials and set a new password, requested on the first
   access. In production, login with the published default passwords (`admin12345`,
   `change-me-admin-password`) is refused, because anyone who knows them would change the password
   before you: set `ADMIN_PASSWORD` in `.env` and restart (the seed replaces the default password
   with the one from `.env`).
2. Go to **Administration → Activation keys** and **generate a key**.
3. Share the key with your friend — they sign up at **/register**
   providing the key (sign-up is only possible with a valid key).

---

## Roles

| Role | What it can do |
|---|---|
| **USER** (friend) | Submit samples, view the global history (read-only) and "My Uploads". |
| **ANALYST** | Everything a USER can do + create reports, set status/verdict. |
| **ADMIN** | Everything + manage users and activation keys. |

---

### Restrict what regular users see

By default, everyone sees and exports the samples of everyone. In **Administration > Settings**, the
option "Regular users only see the samples they submitted themselves" closes this immediately and
with a record in the Audit log. It also applies to the API token.

- **What is left out:** another person's sample answers "not found". Lists, CSV, search, indicator
  card, related items, map, alerts and favorites only show their own, and the Global History is
  removed from the menu.
- **What stays:** the knowledge base, in full. Analysts and admins still see everything.

## Password policy

- **Format:** minimum of 8 characters, with at least one number and one special character
  (anything that is not a letter, including accented letters, a number or a space), and at most 72 bytes
  (bcrypt ignores what comes after; accented characters count as 2). It applies to sign-up,
  Change password and the "Set new password" screen; old passwords outside the rule keep working
  until the next change.
- **Validity:** 90 days since the last change (`PASSWORD_MAX_AGE_DAYS`; `0` turns it off).
  Admins do not expire.
  - **Before it expires:** during the last 7 days, the top of the app shows "Your password expires in N
    days. Change password", and the Password tab shows the validity.
  - **Expired:** login leads to the "Set new password" screen. Until the change, the rest of the system
    and the person's API tokens are blocked.
- **Administration:** the Users tab shows "password expired".
- **When installing the version with the policy,** the validity of existing accounts starts counting
  from that day.

## Login with AD/LDAP (optional)

Without `LDAP_URL`, nothing changes. With AD configured, the activation key and the normal
sign-up still apply.

- **Who can sign in:**
  - those with a local account sign in as usual;
  - those without one sign in with the username (or email) and the network password. The account is
    created on the first access, with the name and email from AD.
- **Role through groups:** `LDAP_ADMIN_GROUP` grants admin, `LDAP_ANALYST_GROUP` grants analyst;
  without a group, a regular user. The role is updated on every login and the change goes to the
  Audit log.
- **Groups within groups:** only apply with `LDAP_NESTED_GROUPS=true`, because enabling it may give a
  role to more people. The service account must be able to read the `memberOf` of the groups. Limits: up to
  200 groups per login; the primary group ("Domain Users") and groups from another domain are not included.
- **Password and 2FA:** AD accounts have no local password. Change, validity and reset stay in
  AD; DeepLook's 2FA still applies.
- **Security:**
  - TLS only: `ldaps://`, or `ldap://` with `LDAP_STARTTLS=true`, and a verified certificate
    (`LDAP_TLS_CA` with the PEM of the internal CA, mounted in the API container);
  - the search uses the service account, with the typed value escaped in the filter;
  - every failure shows "Invalid credentials", and the real reason goes to the Audit log;
  - the same login attempt limit applies;
  - an account suspended in DeepLook cannot sign in, even with the right password;
  - if the AD email already belongs to a local account, AD does **not** take over that account.
- **Who leaves AD:** every hour, an account removed or disabled in AD is suspended, with its sessions
  and tokens revoked, and the event goes to the Audit log. Reactivation is done by the admin. With AD
  offline nothing changes; if most accounts seem to have disappeared, it is most likely a configuration
  error, and nobody is suspended.
- **Status:** the System status shows an "AD/LDAP" line (connection, TLS and how many AD
  accounts exist).

```env
LDAP_URL=ldaps://dc01.empresa.local:636
LDAP_TLS_CA=/run/secrets/ca-empresa.pem
LDAP_BIND_DN=CN=svc-deeplook,OU=Servicos,DC=empresa,DC=local
LDAP_BIND_PASSWORD=...
LDAP_BASE_DN=DC=empresa,DC=local
LDAP_ANALYST_GROUP=CN=SOC-Analistas,OU=Grupos,DC=empresa,DC=local
LDAP_ADMIN_GROUP=CN=SOC-Admins,OU=Grupos,DC=empresa,DC=local
# optional: LDAP_USER_FILTER (default: sAMAccountName, userPrincipalName or mail = {login})
```

## Two-factor authentication (2FA)

Optional, per user, in **My Account > 2FA**:

1. **Enable 2FA** shows a QR code (and the key to type by hand) for an authenticator app:
   Google Authenticator, Microsoft Authenticator, Aegis, 1Password etc.
2. A 6-digit code from the app confirms the activation.
3. **10 recovery codes** appear, only once, with Copy and Download. Each one replaces the app code
   in one login (e.g. lost phone).

- **Login:** with 2FA active, the password is followed by a "Code" step. The session is only created with
  the right code. Whoever signs in with a recovery code is taken to the 2FA tab with a warning.
- **Generate new codes** and **Disable 2FA** ask for the password and a code.
- **Admin:** the Users tab shows who has 2FA and has **Disable 2FA** for whoever lost the phone
  and the codes (confirm the identity first).
- **Security:**
  - TOTP standard (RFC 6238);
  - secret stored encrypted (AES-GCM) with the data key: `DATA_KEY` from `.env` or, without it, a key
    derived from `SESSION_SECRET`;
  - recovery codes stored only as hashes;
  - a code cannot be used twice;
  - 5 attempts every 5 minutes at the code step;
  - everything goes to the Audit log.
- **Data key (`DATA_KEY`):** set it (`openssl rand -hex 32`, different from `SESSION_SECRET`) and keep it
  with the backup. On the next startup the API re-encrypts the already enabled 2FA with it, and from then
  on `SESSION_SECRET` can be changed without affecting 2FA. To change `DATA_KEY` itself, put the new key in
  `DATA_KEY` and the old one in `DATA_KEY_PREVIOUS`, restart and, once system status (Configuration) says
  the change is done, delete `DATA_KEY_PREVIOUS`.
- **Without `DATA_KEY`** (legacy mode), changing `SESSION_SECRET` invalidates the 2FA already enabled,
  because the secret can no longer be decrypted; system status warns while any account is in that
  situation. Login warns that 2FA must be set up again; recovery codes keep working, and the admin can
  disable 2FA for the person so they can enable it again.
- **API tokens** do not go through 2FA (they are for scripts).

## API access (personal tokens)

Scripts can submit and query samples with a personal token, without going through the browser.

1. An **admin** enables the user in Administration > Users > **Enable API**. Without this
   enablement, no token works.
2. The user generates the token in **My Account > API tokens** (validity of up to 90 days).
   The token appears only once.
3. Use it in the `Authorization` header:

```bash
# list your own samples
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/entries?scope=mine"
# submit a file
curl -H "Authorization: Bearer dlk_..." -F file=@amostra.exe -F tags=phishing \
  "https://deeplook.exemplo/api/entries/file"
# submit a link
curl -H "Authorization: Bearer dlk_..." -H "Content-Type: application/json" \
  -d '{"url":"https://site-suspeito.exemplo","title":"Link do e-mail"}' \
  "https://deeplook.exemplo/api/entries/url"
```

- **Allowed:** submit files, `.zip` (`/api/entries/zip`) and links; list and query
  samples, reports, history and IOCs.
- **Outside the token (403):** downloading the file, triage, reports, account and administration.
- **Documentation:** My Account > API tokens > **API documentation** (`/user/api`)
  lists the routes, the fields and examples. The OpenAPI 3.1 specification is at
  `/api/openapi.json` (with session or token) and is generated from the route validations.
- **Limit:** 120 requests per minute per token.
- **Password change:** changing the password or having it reset by the admin revokes the tokens; a
  change due to expired validity does not.
- **Revocation:** the user revokes in My Account; the admin revokes a token in the API tokens tab
  or withdraws the enablement, which revokes all of them at once. Suspending the account also cuts
  off access.

### Monitoring: system status by token

An external monitor (Uptime Kuma, Zabbix...) reads the same status as the **Administration >
Status** screen, without scraping HTML, with a **Monitoring** purpose token:

1. An **admin** with "API access" enabled generates the token in **My Account > API
   tokens**, choosing the purpose *Monitoring: only read the system status* (only admins see
   this option).
2. The monitor queries:

```bash
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/status"
# 503 when the overall situation is "error" (for a monitor that only looks at the HTTP code)
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/status?strict=1"
```

- The response carries `overall` (`ok`, `warn` or `error`, the worst of the checks), `checkedAt` and the
  `checks` list (database, MinIO, antivirus, queues, **file integrity**...).
- **Read-only and only this route:** the status token does not reach samples, administration or
  any other route, and the samples token does not read the status. If the owner stops being an admin,
  the token stops working immediately.
- **10 s cache** (and one check at a time): `checkedAt` shows the age, and a monitor that asks every
  few seconds does not turn into a flood of queries to the database, MinIO, ClamAV and LDAP. Use `GET`;
  `HEAD` does not work for tokens.
- Do not confuse it with `/api/health/ready`, which is public and only says *ok* or *not ok* (used by
  compose): the token-based status is authenticated and carries the detail (addresses, versions, latencies).

### Indicator feed: TAXII 2.1 and MISP

Another tool fetches the indicators by itself, without anyone exporting a file, with a **Indicator
feed** purpose token (only an **admin** generates it, with "API access" enabled):

- **TAXII 2.1** (OpenCTI, Microsoft Sentinel and others): discovery at `/api/taxii2/`, root
  `/api/taxii2/deeplook/` and one collection, **DeepLook Indicators**. It has the objects (with
  `added_after`, `limit`, `next`, `match[type]` and `match[id]`), the object, the versions and the
  manifest. Authentication by `Authorization: Bearer <token>` or **Basic** with any username and
  the token as the password (the Sentinel TAXII connector only speaks Basic). Basic applies only to these routes.
- **MISP feed**: in MISP, *Sync Actions > Feeds > Add Feed*, format **MISP Feed**, URL
  `https://deeplook.exemplo/api/feeds/misp` and, under *Headers*, `Authorization: Bearer <token>`.
  MISP reads the `manifest.json` and fetches one event per sample.

```bash
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/taxii2/"
curl -u "feed:dlk_..." "https://deeplook.exemplo/api/taxii2/deeplook/collections/"
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/feeds/misp/manifest.json"
```

- **What goes out:** only the indicators of **malicious or suspicious** samples, outside the trash, and
  **never** those on the allowlist or the **company domains** (with their subdomains, emails and
  URLs). An indicator that also appears in a clean sample goes out with the verdict of the worst one.
- **The same ids** as the `.stix.json` and `.misp.json` files on the card: whoever has already imported a
  file does not get a duplicate.
- **Updates:** the version of each indicator is the latest change to its samples, so whoever fetches with
  `added_after` also receives the sample that **became** malicious later. The set is recalculated at most
  once a minute. When a sample stops being malicious, the indicator disappears from the collection, but
  TAXII does not notify whoever already had it.
- **Public address:** the discovery links use `https` when `COOKIE_SECURE=true` (behind the Tunnel, nginx
  receives `http`).
- **Limit:** 1200 requests per minute for this token (MISP fetches one file per event); the others keep
  120. If the owner stops being an admin, the token stops working.

## Antivirus (ClamAV)

The `clamav` service in `docker-compose.yml` runs `clamd` and `freshclam` (which updates the
signatures by itself; the database is kept in `./data/clamav`). The API talks to it over the internal
network (port 3310, not exposed outside), sending the content through the `INSTREAM`
protocol: nothing is written to disk by the API.

- **Automatic:** every uploaded file (including those extracted from a `.zip`) is scanned in the
  background, without delaying the upload.
- **On the card:** **Antivirus (ClamAV)** section with Clean / Infected (signature name) /
  Failure, engine, database and date. "Infected" also appears at the top. Analysts have
  "Scan again" (or "Scan now" for files older than the antivirus).
- **System status:** "Antivirus (ClamAV)" line with `clamd` responding, engine, signature
  database (alert when older than 2 days) and scans and infections in the last 24 h.
- **Memory:** ClamAV uses about 1.5 to 3 GB of RAM because of the database.
- **First start:** `freshclam` downloads the database (a few minutes). If `clamd` starts
  before the new database arrives, it keeps the previous one until it reloads by itself; the System
  status warns "signature database outdated" in the meantime. To reload right away:
  `docker compose exec clamav clamdscan --reload`.
- **Limit:** files above the `clamd` `StreamMaxLength` (100 MB in the current image,
  less than the default `MAX_UPLOAD_MB` of 200) appear as "Failure: file larger than the
  ClamAV limit". The rest of the upload proceeds normally.
- **Turn off:** `CLAMAV_HOST=` (empty) in `.env`; the `clamav` service can be removed from compose.
- The result does not change the verdict: the analyst still decides.

## Link page capture

For link-type samples, the analyst clicks **Capture page** and an isolated browser
(`capture` service, Playwright's Chromium) opens the link. The screenshot, the HTML, the redirects, the
certificate and what was blocked are stored.

- **Isolation:**
  - the `capture` container is only on the `capture` network, with no database, MinIO or ClamAV. The API
    calls it over that network, but refuses connections that come from it;
  - the `capture` network is **internal**: no route outside, no external DNS and, with the
    `inhibit_ipv4` option (Docker 28 or newer), no host IP on the bridge, so neither the LAN nor
    the host itself is reachable from there. The only exit is the **`egress`** service, a Node-only proxy
    (no browser) that sits on this network and on a network with outbound access. That way the rule below
    holds even if the browser is compromised and stops obeying its proxy. On a Docker older than 28 the
    option was not verified: the network remains internal, but the host may still be reachable through the
    bridge IP;
  - Chromium runs with **its own sandbox**: each page is rendered in a process with its own user, PID and
    network namespaces and with Chromium's seccomp filter, so an exploited flaw in the renderer stays
    trapped there, without reaching the container. For this, `capture` uses its own seccomp profile
    (`apps/capture/seccomp-chromium.json`): Docker's default plus only what the sandbox needs (creating
    user, PID and network namespaces, and `chroot`). Mounts and the other namespaces remain blocked. The
    profile is generated by `node scripts/seccomp-chromium.mjs`; do not edit it by hand;
  - all browser traffic goes through `egress`, which resolves the name once and **refuses private,
    loopback, link-local and cloud metadata addresses** (169.254.169.254), with no new DNS resolution.
    What it refuses comes back to the capture card;
  - WebRTC and QUIC disabled, no downloads, a new context for each capture;
  - runs as an unprivileged user, with `no-new-privileges`;
  - **one container per capture:** the root is read-only and Chromium writes only to `/tmp`
    (in memory, no executables). After responding, the process exits and Docker brings up a
    clean container, so neither a file nor a process left behind by a page reaches the next capture.
    While the container is swapped, the API waits its turn (up to 2 minutes). Two consecutive captures
    keep at least about 10 s between them, because Docker increasingly delays restarting a container that
    lived less than that.
- **Outbound access to the Internet:** the server needs to reach the links. Without a VPN, the capture opens
  malicious links **from your home IP**. The `capture-egress` network has a fixed subnet
  (`CAPTURE_EGRESS_SUBNET`) so the host can route it through a VPN with source-based routing; the step-by-step
  is in [docs/implantacao.md](docs/implantacao.md), step 3.
- **Updating an installation:** `docker compose down` before `up -d --build`, because Docker does not turn an
  existing network into an internal one.
- **HTML:** only downloaded as text (`.html.txt`), never opened in the browser.
- **Limits:** 20 s to open the page, screenshot up to 6,000 px high, HTML up to 2 MB, one capture
  at a time (per container).
- **Turn off:** `CAPTURE_URL=` (empty) in `.env`; the `capture` service can be removed from compose.
- **Host without user namespaces:** if the capture replies "the Chromium sandbox did not start on this
  host", the kernel does not allow creating unprivileged user namespaces. It can happen, for example, on
  Ubuntu 24.04 with `kernel.apparmor_restrict_unprivileged_userns=1`, or with
  `user.max_user_namespaces=0`. Enable it on the host. As an emergency exit only, `CAPTURE_CHROMIUM_SANDBOX=false`
  in `.env` goes back to the no-sandbox mode.
- **Token:** change `CAPTURE_TOKEN` (16+ characters), which is used by both the API and the
  service.

## Static analysis of Windows executables

Every uploaded file goes through static analysis (read-only access to the bytes, in a thread with a time
and memory limit). For Windows executables (PE), the **Static analysis** section of the card shows, in
addition to sections, imports and packer:

- **Alerts** by severity: a signature that does not match the file, an executable hidden in a resource,
  a writable and executable section, an entry point out of place, few imports with
  `GetProcAddress`/`LoadLibrary`, a compile date in the future, an edited Rich header, a manifest that
  requests administrator, "claims to be Microsoft" without a signature.
- **imphash** and **Rich header hash**, identical to those of `pefile` (and VirusTotal). The **Related**
  tab links samples with the same imphash or the same Rich header. The imphash only links with its own
  table: .NET (all of which imports only `_CorExeMain`) and packer tables (fewer than 10 functions) are
  left out, otherwise they would link samples with no relation at all.
- **Authenticode signature**: who signed, who issued, validity, fingerprint, timestamp and the chain that
  came in the file. The status says whether the file was **altered after being signed** and whether the
  signature matches the certificate. The chain is **not** checked against Windows' trusted roots (the API
  does not have them): "intact" means intact, not trusted.
- **Resources** (type, language, size, entropy and what is inside), **version information** (company, original
  name...), **manifest**, **exports** (with forwarders), **TLS callbacks**, **appended data** (overlay, apart
  from the signature) and **checksum**.
- **.NET**: runtime, assembly, references, the native functions called via **P/Invoke**, sensitive calls
  (`Assembly.Load`, `WebClient`, `Process.Start`...) and obfuscator markers.
- **UPX** is also recognized by the entry code, with the sections renamed.

Samples submitted earlier get the new analysis in the background, one at a time, after the
API starts; an analyst can also request **Analyze again** on the card. The sample comparison (A × B) shows
the imphash, the Rich header and who signed.

## Function analysis (capa and FLOSS)

Every Windows or Linux executable uploaded (up to `CAPA_MAX_MB`, 32 MB) goes into a queue, and the
`capa` service analyzes it in the background, one at a time. Nothing is executed: the two Mandiant tools
read and emulate the code.

- **[capa](https://github.com/mandiant/capa)** says what the functions do ("injects a thread into
  another process", "contains stack-built strings", "loads a .NET assembly"), with the namespace, the **ATT&CK**
  techniques, the **MBC** and the function addresses. The techniques become the **Insert techniques suggested
  by capa** button in New report.
- **[FLOSS](https://github.com/mandiant/flare-floss)** recovers the strings that only exist at runtime (built
  on the stack or decrypted), which the usual extraction does not see. The indicators in them go into the
  IOC suggestions. Only for Windows executables.
- **On the card:** **Function analysis (capa)** section with the status (queued, analyzing,
  completed, failed and why), the capabilities (the risky ones highlighted), the techniques and the hidden
  strings. Analysts request **Analyze again**; everyone who can see the sample sees the analysis. Via API
  token: `GET /api/entries/:id/capa`.
- **Time:** from seconds to minutes. Each tool has a ceiling (`CAPA_TIMEOUT_S`,
  `FLOSS_TIMEOUT_S`); an executable with thousands of functions may hit it, and the failure says
  "timed out".
- **Isolation:** a container with no network at all (internal `analysis` network, only with the API), non-root,
  no capabilities, read-only root and `/tmp` in memory without execution. Like the capture, a **new container for
  each analysis**: the API waits for the new one to be free before sending the next file. Service down: the
  analysis goes back into the queue and is retried (up to 3 times).
- **System status:** "Function analysis (capa)" line with the versions, the queue and the analyses
  in the last 24 h.
- **Versions:** capa 10.0.0 and FLOSS 3.2.0, with the rules and signatures of the same capa version, downloaded at
  build time and checked by hash. The Python dependencies are pinned with hashes in
  `apps/capa/requirements.txt` (generated from `requirements.in`). To upgrade capa, change the version in
  `requirements.in`, regenerate the lockfile and change the URLs, hashes and `CAPA_RULES_VERSION` in the
  `Dockerfile`; Dependabot does not upgrade capa or FLOSS on its own.
- **Turn off:** `CAPA_URL=` (empty) in `.env`; the `capa` service can be removed from compose.

## Ghidra analysis

An analyst requests **Analyze with Ghidra** in the card's section; the `ghidra` service runs Ghidra
headless (12.2) in the background, one at a time, and the card shows:

- the **program** (format, processor, compiler, base and entry) and how many functions there are;
- the **pseudo-C** of the entry point and of the functions that call the most **sensitive APIs** (injection,
  network, persistence, cryptography, anti-analysis; the list is in `apps/ghidra/sensitive-apis.txt`),
  with who calls each one. Ordinal import from ws2_32 becomes the name, using the same `pefile` table that
  imphash uses;
- the **largest functions**, with complexity and the APIs they call;
- the **`.gzf` project**, to open in a local Ghidra already analyzed.

Details:

- **Only Windows and Linux executables**, up to `GHIDRA_MAX_MB`. **.NET is left out**: Ghidra does not
  decompile intermediate code (IL), and the result would be just the CLR stub.
- **Time:** 12 to 20 s on the test executables (Java starts up on every analysis). On a large executable,
  the automatic analysis stops at 70% of `GHIDRA_TIMEOUT_S` and the summary still comes out, partial.
- **The `.gzf` contains the bytes of the sample.** Downloading it follows the rule for downloading the sample
  (whoever submitted it and the analysts) and is logged in the Audit log. It lives in MinIO alongside the
  samples: a backup without samples leaves it out, and retention and permanent deletion remove it along with the file.
- **Isolation:** like capa, internal network with only the API, non-root, no capabilities, read-only root,
  `/tmp` in memory without execution and a new container for each analysis.
- **Image:** 1.45 GB (Debian, OpenJDK 25 without the `jmods`, and Ghidra without documentation, extensions,
  server and debugger). The package is checked against the published SHA-256. The guava 32.1.3 that Ghidra 12.2
  ships with has a high CVE; the build replaces it with 33.7.2, checked by hash. When upgrading Ghidra, change the
  URL, the hash and `GHIDRA_VERSION` in the `Dockerfile`, and check whether the guava replacement is still needed.
- **Memory:** the container has a 6 GB ceiling, but it only uses it during an analysis (700 MB on the test
  executables).
- **Turn off:** `GHIDRA_URL=` (empty) in `.env`; the `ghidra` service can be removed from compose.

## YARA rules

### Rule packs


DeepLook ships with rules from trusted sources, in `apps/api/rules`, without downloading anything on startup:

| Pack | Author | License | Status |
|---|---|---|---|
| ReversingLabs (310 sets) | ReversingLabs | MIT | enabled |
| bartblaze (89, without the `generic` folder) | bartblaze | MIT | enabled |
| signature-base (752) | Florian Roth (Neo23x0) | DRL 1.1 | disabled |

- **Enable and disable:** in **Administration > Settings**. Disabling deletes nothing; the rules are only
  removed from the scan of the next files.
- **Installation:** each pack is installed once, on startup or when enabled. What is disabled or deleted on the
  YARA Rules screen does not come back on its own.
- **A pack rule is not edited:** to change it, write a team rule.
- **Authorship:** the card shows the author and the pack of each detection. DRL 1.1 requires this.
- **Rule variables:** `filename`, `extension` and `filetype` come from the sample. `filepath` and `owner`
  are empty, because a submission has no folder or owner: a rule that requires a path will not fire. The
  `Suspicious_Size_*` rules are ignored, because they flag legitimate Windows files. Team rules can also use
  these variables.
- **Automatic update:** on by default, in **Administration > Settings**. Every week the API
  checks GitHub (`api.github.com` and `codeload.github.com`) for the newest version, at least 7 days old, of the
  enabled packs. Without Internet access, nothing changes.
  - **Applied automatically** are updates that pass the filters: identical license; up to 20% of sets changed or
    removed; no new rule firing on the 100 recent samples with a Clean verdict; compilation up to 2x
    slower. A file that does not compile is left out.
  - **Held back** for an admin to approve or discard what does not pass, with the reason on screen.
  - **Rolling back a version:** the last applied one returns with one click, and that version is not reapplied automatically.
  - **Respects your choices:** a disabled rule stays disabled, and a deleted rule does not come back.
- **Factory version:** `node scripts/vendor-yara-packs.mjs <folder with the clones>` updates the copy in
  `apps/api/rules`, used only in new installations.
- **Old samples:** the packs apply to the next files. For the old ones, use "Apply to samples".

### Team rules

Analysts maintain YARA rules on the **YARA Rules** screen (Detection folder of the browser). The
API validates and applies the rules with **YARA-X** (`@virustotal/yara-x`, WebAssembly, no extra binary or
service). A rule with a syntax error is refused immediately, with the line of the error, and is never used.

- **Automatic:** every uploaded file goes through the active rules in the background. A new rule applies to
  the next submissions; for an old sample, use "Scan again".
- **On the card:** **YARA Rules** section with the rules that matched (set, tags,
  description, occurrences); the top shows "YARA: ...".
- **Limits:** 10 s per scan and 100 occurrences per string; each set is up to
  64 KB.
- Creating, changing and deleting rules is recorded in the Audit log.

## Identify and unpack

Every executable that arrives (Windows, Linux, macOS, APK and JAR, up to `UNPACK_MAX_MB`) goes through the
`unpack` service in the background:

1. **[Detect It Easy](https://github.com/horsicq/DIE-engine)** 3.21 (MIT) identifies it by its signatures: compiler
   ("MinGW", "Delphi 10.3"), packer ("UPX 4.24", including altered UPX), protector ("Themida"), installer
   ("NSIS 3.11"), digital signature, .NET. The card shows the list, with the packer and protector highlighted. It is
   a clue, not a verdict: DIE also gets things wrong (in a PyInstaller program, for example, it sees "Go").
2. If an unpacker recognizes it, it is unpacked, and **each file that comes out becomes a child sample**
   ("Extracted from:" on the card), with the full analysis again: static, antivirus, YARA, capa and Ghidra on
   demand. This is how capa and Ghidra see the real code, and not the UPX decompressor or the installer. The child
   comes out already identified in the same round and only goes back into the queue if there is something to unpack in it.
3. If nothing unpacks, the card says why, with what DIE saw: "protected with Themida: needs an unpacker that runs
   the sample", "packed with MPRESS: no static unpacker for it", or "nothing to unpack".

The triage rules gain the condition **Detect It Easy detected** (a fragment such as `Themida`, `Inno
Setup` or `Delphi`; empty = any packer or protector).

| Unpacker | Tool | What comes out |
|---|---|---|
| UPX | `upx -d` 4.2 | the original executable (functionally; see below) |
| PyInstaller | pyinstxtractor 2026.07 | only the author's script (`.pyc`), without the standard library or the bootstrap |
| Inno Setup | innoextract 1.9 | the files of the installer (format up to Inno Setup 6.2) |
| NSIS | 7-Zip 25 | the files and the script of the installer (`[NSIS].nsi`) |
| Embedded archive | 7-Zip 25 | what is in the ZIP, 7z, RAR or CAB attached to the executable |

- **Nothing is executed:** the tools only read and extract. Container with no network, non-root, no
  capabilities, read-only root and `/tmp` in memory without execution; one container per job.
- **Limits:** up to `UNPACK_MAX_FILES` files and `UNPACK_MAX_TOTAL_MB` combined per sample (the rest
  appears as "left out", with the reason), and two generations of unpacking (an installer with a UPX
  inside); beyond that the file is only identified.
- **What does not work, and the card says so:** disguised UPX (with the `UPX!` marker erased) — 7.1
  recognizes it by the code, but `upx` does not unpack it without the marker; Inno Setup 6.3 onward — innoextract
  1.9 (the latest release) cannot read it.
- **Unpacked UPX is the same program, not the same file:** `upx -d` zeroes the checksum and rebuilds the
  import table with the DLLs in another order. The set of functions is the same, but the imphash changes.
- Earlier samples: an analyst requests **Identify and unpack** in the card's section.
- **New unpackers** come in as a file in `apps/unpack/unpackers/`; the contract is in the
  `README.md` there. Those that need to **run** the sample (like most Themida and VMProtect ones) do not fit in
  this container: their place is the Proxmox sandbox.
- **Turn off:** `UNPACK_URL=` (empty) in `.env`; the `unpack` service can be removed from compose.

## Triage rules

Analysts maintain, on the **Triage rules** screen (Detection folder), rules of the type "when the analysis
finds X, add the tags Y and raise the priority to Z". All that match apply; none removes a tag or lowers
the priority, and each one is recorded in the sample's history.

| Condition | Value | Applies from |
|---|---|---|
| Real type, disguised executable, macro, script or document with high risk, suspicious shortcut | real type (only that one) | arrival |
| Link domain, email sender, lookalike of the company domain | domain or address | arrival |
| YARA rule matched, antivirus detected | part of the name (optional) | end of the scan |
| **Digital signature does not match** (tampered or invalid; unreadable does not count) | — | arrival |
| **Packed executable** | packer, e.g. UPX (optional) | arrival |
| **Executable alert** | fragment of the alert (empty = any high alert) | arrival |
| **capa found the capability** | part of the name (`inject`) or namespace (`persistence`); empty = any risky capability | end of the function analysis |
| **ATT&CK technique (via capa)** | code, e.g. `T1055` (also applies to sub-techniques) | end of the function analysis |
| **Indicator in hidden string (FLOSS)** | domain or fragment (optional) | end of the function analysis |
| **Detect It Easy detected** | fragment, e.g. `Themida` (empty = any packer or protector) | end of the identification |

The rules also run again when an analyst requests **Analyze again** on the static analysis.

## Cases

Analysts group samples from the same campaign into **cases** (`CASO-0001`), from the card
("More ▾ > Add to case…") or from the samples checked in the list. The case has a status,
an owner, its samples with their published reports and a timeline with comments. A sample can be in
several cases; a case is never left empty.

## Suspicious email (.eml)

Submit the `.eml` of a phishing email as a regular file. The card shows the **Email** section:
sender, Reply-To, recipients, SPF/DKIM/DMARC, the path of the servers, the links (text only) and the
body as text; the HTML is never displayed. Each attachment becomes its own sample ("Attachment of: …"),
with antivirus, reputation and YARA. Parsing uses `postal-mime` (no dependencies).

## Knowledge base

Articles in Markdown about malware families, scams, techniques and procedures
(**Knowledge base**, at the top of the browser). Everyone can read; analysts and admins write,
with preview. Reports cite articles, and each article lists the published reports that cite it. The
Markdown is rendered without HTML, and bare URLs do not become links.

## MITRE ATT&CK

Reports can cite **MITRE ATT&CK** techniques (Enterprise v20.0), by code or
name. The techniques become links and filters (`?attack=T1566`) in the lists and appear on the Dashboard
("most seen"). The list is embedded in `apps/api/src/lib/attack-enterprise.json`,
extracted from [mitre-attack/attack-stix-data](https://github.com/mitre-attack/attack-stix-data);
nothing is queried outside. To update the version, replace the file and publish the API.

ATT&CK® is a registered trademark of The MITRE Corporation; the content is © MITRE and used in accordance
with the [ATT&CK terms of use](https://attack.mitre.org/resources/legal-and-branding/terms-of-use/).

## External reputation

With the keys in `.env`, every submitted sample is **automatically** checked against the enabled services,
in the background, without delaying the upload. The result appears in the **External reputation** section of
the card and in a summary at the top, for example "malicious in 2 of 3 services".

| Indicator | Services |
|---|---|
| File: **SHA-256 only** | VirusTotal, MalwareBazaar, ThreatFox |
| Link: **domain only** | VirusTotal, URLhaus, ThreatFox |
| Link whose host is an IP | VirusTotal, URLhaus, ThreatFox, AbuseIPDB |

- **What leaves the server:** only the indicator. The file never leaves, nor the full URL (with the
  victim's path, email or token).
- **24 h cache** per service and indicator; analysts have "Check again".
- **Limits:** the free VirusTotal allows 4 queries per minute, and the queue respects that
  (batch submissions wait their turn). Its public API is for non-commercial use only.
- **Failures** (key refused, limit, timeout) appear on the service's line and in System status.
- **Warning:** even just the hash reveals to third parties that the sample is being analyzed.

## Backup and restore

In **Administration > Backup** (admin only), **Generate backup** builds in the background a ZIP
containing:
- the database (`pg_dump`, custom format);
- the MinIO files: evidence, captures and, if checked, the sample files;
- a `manifest.json` with version, date, counts and the SHA-256 of each part;
- a `LEIA-ME-RESTAURACAO.txt` (restore instructions).

How it works:
- One backup at a time. The screen shows the stage and the progress, and **Download** appears when
  it finishes.
- The ZIP stays until it expires (`BACKUP_RETENTION_DAYS`, default 7 days): in the **backup folder**, if
  `BACKUP_DIR` is set (below), or in the bucket (`backups/`), on the same disk as the data.
- It only downloads with an admin logged in (an API token does not work).
- **ZIP password:** provided when generating (12 characters or more), with AES-256 in the WinZip standard,
  which **7-Zip** opens (plain `unzip` does not). It is not stored: without it, the backup cannot be opened.
  The file names inside the ZIP are not encrypted. Exporting without a password requires ticking the option
  and confirming.
- Generating, downloading and deleting go to the Audit log.

> **With the sample files, the ZIP contains real malware.** Store it the same way as the samples.
> The manifest says what went in (`containsMalware`).

### Scheduled backup

In **Administration > Backup**, the **Scheduled backup** section enables automatic generation: days of the
week (every day means ticking all seven) or a day of the month (1 to 28), and the time. The time applies in the
time zone of the browser of whoever saved it. A calendar with this month and the next marks the days and lists
the upcoming runs before saving.

- **Password:** the scheduled ZIP is always created with the password `BACKUP_SCHEDULE_PASSWORD` from `.env`
  (12+ characters). The one on screen is not stored, so the schedule uses this one. Without it, the schedule
  does not turn on; with fewer than 12 characters, the API does not start and says why. **Keep the password
  outside the server**: without it, the backup cannot be opened.
- **Content:** includes the sample files (malware), protected by the password.
- **Destination:** the same as the others. With `BACKUP_DIR`, it goes to the folder outside the disk (below); without it,
  it stays in the bucket, on the same disk as the data.
- **API down at the scheduled time:** the backup goes out once when it comes back, and the calendar continues.
  With another backup running, it waits and goes out in the minute after the previous one ends.
- In the list, it appears as **Scheduled** under "By"; the schedule change goes to the Audit log.
- **When something goes wrong, it warns.** With the schedule on, the **Backup** check on the status page
  turns **error** (red) when:
  - the last scheduled one failed;
  - the scheduled time has passed (with 6 h of slack) without any backup ready;
  - the backup folder has a problem;
  - the password is missing.

  The Backup tab shows the same reason. A monitor with the status token and `?strict=1` gets
  **503**, so Uptime Kuma or Zabbix raise the alarm without new configuration. Times before the schedule was
  turned on do not count. With the schedule off, none of this becomes an error.

### Backup folder outside the disk

Without configuration, the ZIP stays in the bucket, and the bucket and Postgres share the same disk
(`./data`): losing the disk loses the data **and** the backup. With `BACKUP_DIR` in `.env`, the ZIP is
written to a host folder, which you point to an external disk or a mounted NAS. **Taking this folder off
the disk is the responsibility of whoever configures the environment**; DeepLook only writes to it.

```bash
sudo mkdir -p /mnt/externo/deeplook
sudo touch /mnt/externo/deeplook/.deeplook-backups   # the marker: see below
sudo chown -R 1000:1000 /mnt/externo/deeplook         # the API runs as uid 1000
echo 'BACKUP_DIR=/mnt/externo/deeplook' >> .env
docker compose up -d                                  # recreates the API with the folder mounted
```

- **The `.deeplook-backups` marker:** with the disk unmounted, the mount point becomes an empty folder
  **on the main disk**, and the backup would be written there without anyone noticing. Without the marker
  in the folder, the API refuses to write and says why, on the Backup tab and on the status page
  (**Backup**).
- **On the disk:** `deeplook-backup-AAAA-MM-DD-<id>.zip` and a `.sha256` beside it, to check a copy with
  `sha256sum -c`. Both are only readable by uid 1000. The ZIP is built under a temporary name
  (`.<name>.partial`) and renamed at the end, so whoever syncs the folder never copies a half-written ZIP
  (exclude `*.partial` from `rsync`).
- **Expiry and deletion** remove from the folder only the ZIP and the `.sha256` that the API wrote. The rest
  of the folder (your copies, other files) is not touched.
- **Backups made before the configuration** remain in the bucket and download normally until they expire.
- A file missing from the folder (disk unmounted, moved) makes **Download** respond with the reason, instead
  of an error.

To restore, with DeepLook stopped:

```bash
7z x deeplook-backup-AAAA-MM-DD-xxxxxx.zip -obackup && cd backup   # asks for the password, if any
sha256sum db/deeplook.dump            # check against manifest.json
docker compose up -d db minio
docker compose exec -T db createdb -U deeplook deeplook_restaurado
docker compose exec -T db pg_restore -U deeplook -d deeplook_restaurado --no-owner < db/deeplook.dump
# files: copy objects/ to the bucket keeping the paths (e.g. mc cp --recursive)
```

Then point `DATABASE_URL` to the restored database (or rename it) and bring up the rest. Newer
migrations run by themselves.

- **`SESSION_SECRET`:** use the same one as the source installation, because it is not in the ZIP. With
  a different one, the enabled 2FA stop working (only the recovery codes work).
- **Backup without the samples:** the cards come back, but the files do not. Download responds "file
  is not in storage"; the analysis already done stays on the card.

## File integrity

Every stored file must have the SHA-256 (and the size) that the card recorded at submission. This catches
silent storage corruption and tampering with the bucket from outside the API.

- **On download:** the SHA-256 is computed while the bytes go out, without reading the file twice.
  The file is **delivered regardless** (refusing would take away the analyst's only remaining copy); what
  changes is the record.
- **Mismatch:** the sample is flagged, the card shows a red warning (and the **Integrity** field, in Details,
  with the date of the last check), the **Audit log** records *File diverges from the SHA-256 on the card* with
  the expected and computed hashes, and subsequent downloads go out with the header
  `X-DeepLook-Integrity: mismatch`. The audit log only records a *change* of state: re-checking the same damaged
  file does not fill the trail.
- **Interrupted download** has no verdict and flags nothing.
- **Periodic verification:** in the background, the server reads the samples and checks the SHA-256, starting with
  those never checked and continuing with those checked longest ago, until the budget of the round is used up.
  It catches corruption without waiting for someone to download. An object that **went missing** from the bucket
  is also flagged. A read failure (MinIO down) does not flag anyone.
- **Verified again** (the object was restored): the flag is removed and the Audit log records it.
- **What to do with a flagged sample:** restore the object from the backup (the ZIP carries the SHA-256 of each
  file) or resubmit the sample; the scrub and the next download clear the flag.
- **Status:** the *File integrity* check turns orange with diverging samples and appears in the token-based
  status (`/api/status`).
- Adjust with `INTEGRITY_SCRUB_INTERVAL_MINUTES` (default 60; `0` turns it off) and
  `INTEGRITY_SCRUB_MAX_MB` (default 512 per round).

---

## Cloudflare Tunnel (on the host, outside Docker)

In production, with the Tunnel, set `COOKIE_SECURE=true`. On startup, the cookie is renamed to
`__Host-dl_session` and whoever was logged in signs in again once. The real IP comes from `CF-Connecting-IP`,
accepted only from the gateway of the `deeplook` network (that is how the host's `cloudflared` arrives through the
published port) and from loopback; from another container it is ignored. Changed `DEEPLOOK_SUBNET`, or running
`cloudflared` in a container? Adjust `REAL_IP_FROM` in `.env`. Do not publish the web port on any address other
than `127.0.0.1` without reviewing this (`set_real_ip_from` in `apps/web/nginx.conf`).

DeepLook only publishes `127.0.0.1:8080`, so install the official `cloudflared`
on the host and point the tunnel to that port:

```bash
# example (adjust to your OS/package manager)
cloudflared tunnel login
cloudflared tunnel create deeplook
cloudflared tunnel route dns deeplook deeplook.seu-dominio.com
```

`config.yml` (typically at `/etc/cloudflared/config.yml` or `~/.cloudflared/config.yml`):

```yaml
tunnel: deeplook
credentials-file: /etc/cloudflared/<UUID>.json
ingress:
  - hostname: deeplook.seu-dominio.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
cloudflared tunnel run deeplook
# or install it as a service:  cloudflared service install
```

As the traffic reaches Cloudflare over HTTPS, set in `.env`:

```
COOKIE_SECURE=true
```

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | PostgreSQL credentials. With the default password (`deeplook` or the one in `.env.example`) the API does not start in production; in an existing database, change it with `ALTER USER` before changing `.env` ([checklist](docs/implantacao.md)) | `deeplook` |
| `SESSION_SECRET` | Secret for the session cookies (long and random, minimum of 32 characters in production); with the default value the API does not start | — |
| `SESSION_TTL_HOURS` | Maximum session lifetime (hours), even with continuous use | `168` |
| `SESSION_IDLE_MINUTES` | Expires the session after N minutes without user activity (warning 2 min before) | `30` |
| `SLA_WARN_HOURS` | A sample not completed for more than N hours in its current status gets an orange dot (alert) | `24` |
| `SLA_LATE_HOURS` | Above N hours it turns red and enters the "Overdue" queue | `72` |
| `SLA_P1_HOURS` · `SLA_P2_HOURS` · `SLA_P4_HOURS` | deadlines for priorities P1, P2 and P4 ("alert/overdue" in hours); P3 uses `SLA_WARN_HOURS`/`SLA_LATE_HOURS` | `2/4` · `8/24` · `72/120` |
| `SLA_ESCALATE_PRIORITY` | on entering alert, the owner is notified (without an owner, the analysts); on going overdue, the admins too. `true`: on going overdue, the priority rises one level | `false` |
| `REPORT_REVIEW_REQUIRED` | `true`: a report is only published with the approval of another analyst (four eyes) | `false` |
| `RETENTION_DAYS` | deletes the **file** of completed samples older than N days (card, reports, IOCs and hash are kept); `0` turns it off | `0` |
| `BACKUP_RETENTION_DAYS` | days until the backup ZIP (Administration > Backup) expires and leaves the bucket or the folder | `7` |
| `BACKUP_PG_DUMP` | the `pg_dump` command used in the backup (version 16 or newer; the API image already includes it) | `pg_dump` |
| `BACKUP_SCHEDULE_PASSWORD` | password of the scheduled backup ZIP (12+ characters; days and time on the Backup tab). Empty, the schedule does not turn on | — |
| `DATA_KEY` | Data key: encrypts the 2FA secret in the database (32+ characters, different from `SESSION_SECRET`; keep it with the backup). Empty, the key is derived from `SESSION_SECRET` | — |
| `DATA_KEY_PREVIOUS` | Only while changing `DATA_KEY`: the old key, so startup re-encrypts with the new one | — |
| `BACKUP_DIR` | host folder where the backup ZIP is written (external disk, NAS); must be writable by uid 1000 and contain the `.deeplook-backups` file. Empty: the ZIP stays in the bucket, on the same disk as the data | — |
| `INTEGRITY_SCRUB_INTERVAL_MINUTES` | how often, in minutes, the server checks the SHA-256 of the stored files; `0` turns it off | `60` |
| `INTEGRITY_SCRUB_MAX_MB` | how much to read per round of the periodic check (a file larger than that is still checked, on its own) | `512` |
| `LDAP_URL` · `LDAP_STARTTLS` · `LDAP_TLS_CA` | AD login (empty turns it off); `ldaps://` or `ldap://` + StartTLS; PEM of the CA that signs the AD certificate | — · `false` · — |
| `LDAP_BIND_DN` · `LDAP_BIND_PASSWORD` · `LDAP_BASE_DN` | service account and search base | — |
| `LDAP_USER_FILTER` · `LDAP_ATTR_NAME` · `LDAP_ATTR_MAIL` | filter (`{login}` = what was typed) and the name and email attributes | AD default · `displayName` · `mail` |
| `LDAP_ANALYST_GROUP` · `LDAP_ADMIN_GROUP` | DNs of the groups that grant the role (without a group, regular user) | — |
| `LDAP_NESTED_GROUPS` | `true`: groups nested within these groups also grant the role | `false` |
| `PASSWORD_MAX_AGE_DAYS` | password validity in days (admins do not expire); `0` turns it off | `90` |
| `VT_API_KEY` | VirusTotal key (external reputation); empty turns it off | — |
| `ABUSECH_AUTH_KEY` | abuse.ch key: enables MalwareBazaar, URLhaus and ThreatFox | — |
| `ABUSEIPDB_API_KEY` | AbuseIPDB key (IPs) | — |
| `CLAMAV_HOST` | `clamd` host (`clamav` service of compose); empty turns the antivirus off | `clamav` |
| `CLAMAV_PORT` | `clamd` port | `3310` |
| `CAPTURE_URL` | isolated browser service (link page capture); empty turns it off | `http://capture:3100` |
| `CAPTURE_TOKEN` | token shared between the API and the `capture` service (16+ characters) | — |
| `CAPA_URL` | function analysis service (capa and FLOSS); empty turns it off | `http://capa:3200` |
| `CAPA_TOKEN` | token shared between the API and the `capa` service (16+ characters) | — |
| `CAPA_MAX_MB` | executables larger than this do not go to capa (the service has the same ceiling) | `32` |
| `CAPA_TIMEOUT_S` / `FLOSS_TIMEOUT_S` | maximum time of each tool, in the service | `600` / `300` |
| `CAPA_REQUEST_TIMEOUT_S` | how long the API waits for an analysis (above the sum of the two) | `1000` |
| `CAPA_MEM_LIMIT` | memory of the `capa` container | `3g` |
| `CAPA_RECYCLE` | a new container for each analysis; `false` = long-lived process | `true` |
| `GHIDRA_URL` | Ghidra service (on demand); empty turns it off | `http://ghidra:3300` |
| `GHIDRA_TOKEN` | token shared between the API and the `ghidra` service (16+ characters) | — |
| `GHIDRA_MAX_MB` | executables larger than this do not go to Ghidra | `32` |
| `GHIDRA_TIMEOUT_S` | ceiling of the analysis in the service (the automatic analysis stops at 70% of it and the summary still comes out) | `900` |
| `GHIDRA_REQUEST_TIMEOUT_S` | how long the API waits for an analysis | `1300` |
| `GHIDRA_HEADLESS_MAXMEM` / `GHIDRA_MEM_LIMIT` | Java heap and container memory | `3G` / `6g` |
| `GHIDRA_RECYCLE` | a new container for each analysis; `false` = long-lived process | `true` |
| `UNPACK_URL` | unpacking service; empty turns it off | `http://unpack:3400` |
| `UNPACK_TOKEN` | token shared between the API and the `unpack` service (16+ characters) | — |
| `UNPACK_MAX_MB` | executables larger than this do not go to the unpacker | `64` |
| `UNPACK_TIMEOUT_S` | maximum time of an unpacker, in the service | `180` |
| `UNPACK_MAX_FILES` / `UNPACK_MAX_TOTAL_MB` | how many files (from 1 to 100, the maximum the API accepts in one response; beyond that the service adjusts and warns in the log) and how many combined MB come out of a sample | `50` / `256` |
| `UNPACK_MEM_LIMIT` / `UNPACK_RECYCLE` | container memory; a new container for each job | `2g` / `true` |
| `CAPTURE_RECYCLE` | a new container for each capture; `false` goes back to the long-lived process, which serves queued captures without swapping | `true` |
| `CAPTURE_CHROMIUM_SANDBOX` | Chromium's own sandbox in the capture; `false` only as an emergency exit on a host without user namespaces | `true` |
| `CLAMAV_IMAGE` | ClamAV container image, pinned by tag and digest (like the Postgres one; `node scripts/pin-images.mjs` checks and `--write` updates) | `clamav/clamav:1.5@sha256:…` |
| `COOKIE_SECURE` | `true` when served only over HTTPS; the session cookie becomes `__Host-dl_session` (whoever was logged in signs in again once) | `false` |
| `CAPTURE_EGRESS_SUBNET` | Fixed subnet of the capture's outbound network (`capture-egress`), so the host can route it through a VPN with source-based routing (`docs/implantacao.md`, step 3). Changing it requires `docker compose down` before `up` | `172.31.252.0/24` |
| `DEEPLOOK_SUBNET` | Fixed subnet of the internal `deeplook` network, the only one from which the API accepts connections and the client IP (becomes the API's `TRUSTED_NETWORK`). Change it only if it collides with another host network, and run `docker compose down` before `up` to recreate the network | `172.31.250.0/24` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin seeded on the first boot; change the password on first access. With the default password, its login is refused in production | — |
| `ALLOW_INSECURE_DEFAULTS` | `true`: starts even with the default `SESSION_SECRET`/`CAPTURE_TOKEN`/`CAPA_TOKEN`/`GHIDRA_TOKEN`/`UNPACK_TOKEN`, with the default database or MinIO password, and accepts the admin login with the default password (local demonstration only) | `false` |
| `MAX_UPLOAD_MB` | Maximum upload size | `200` |
| `MAX_UPLOAD_MEMORY_MB` | sum of simultaneous uploads in memory; above it, responds 503 "try again shortly" | `600` |
| `API_MEM_LIMIT` | memory limit of the API container | `4g` |
| `API_PIDS_LIMIT` | limit of processes and threads for the API (measured peak: 32, with sample and backup) | `256` |
| `WEB_MEM_LIMIT` | memory limit of the web container (nginx) | `256m` |
| `LOG_MAX_SIZE` · `LOG_MAX_FILE` | Docker log rotation, for all services: size of each file and how many are kept | `10m` · `3` |
| `UPLOAD_DAILY_LIMIT` | Uploads per regular user in the last 24 hours (file, link, each file of a `.zip`); analysts and admins have no limit; `0` turns it off | `20` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO credentials | `deeplook` |
| `MINIO_CONSOLE_PORT` | Port (loopback) of the MinIO console on the host | `9001` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | Bucket used by the API | `http://minio:9000` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | API S3 credentials | = MinIO root |
| `WEB_PORT` | Port published on the host | `8080` |
| `SANDBOX_ENABLED` | Enables the sandbox (isolated VM on Proxmox) | `false` |
| `SANDBOX_CONSOLE_ENABLED` | Enables the noVNC console (dedicated window) for the analyst | `true` |
| `PROXMOX_MOCK` | Simulates Proxmox in memory (without a real PVE) | `false` |
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

MinIO console (administration, loopback only): http://localhost:9001

---

## Project structure

```
deeplook/
├─ docker-compose.yml
├─ .env.example
├─ README.md          # English (main)
├─ README.pt-BR.md    # Português (pt-BR)
├─ .github/           # CI (ci.yml), image CVE scanning (security-scan.yml) and Dependabot
├─ apps/
│  ├─ api/            # Fastify + Prisma + S3 (MinIO)
│  │  ├─ prisma/      # schema, migrations, seed (configuration in prisma.config.ts)
│  │  ├─ rules/       # built-in YARA rule packs
│  │  ├─ tests/       # integration (real Postgres, MinIO and OpenLDAP)
│  │  └─ src/         # env, lib, routes (generated/prisma: generated client, outside git)
│  ├─ capa/           # capa and FLOSS (Python) for function analysis, no network
│  ├─ ghidra/         # Ghidra headless (Java 25), export scripts and the server, no network
│  ├─ unpack/         # Detect It Easy and the unpackers (one plugin per file in unpackers/)
│  ├─ capture/        # isolated browser that captures a link's page, and the egress
│  └─ web/            # React + Vite + @carbon/react
│     ├─ nginx.conf   # build server and /api proxy (the real configuration)
│     ├─ vitest.config.ts # unit tests and coverage floor
│     └─ src/         # api, auth, components, pages, styles
├─ docs/              # guides (English: *.md; pt-BR: *.pt-BR.md): implantacao, interface-hpsm, ux-backlog, plano-melhorias, proxmox
├─ icons/             # icon library (HPSM style)
├─ scripts/           # visual tests (ui-playwright/), Trivy (trivy.mjs) and Playwright check
├─ trivy.yaml         # severity, justified exceptions and what fails the image scan
└─ data/              # volumes (git-ignored): pgdata/, minio/, clamav/
```

---

## Local development (without Docker)

```bash
# API (Prisma 7: variables come from the environment; .env is not read automatically)
cd apps/api
npm install
export DATABASE_URL=postgresql://deeplook:deeplook@localhost:5432/deeplook
export SESSION_SECRET=change-to-a-secret-with-20-chars
npx prisma generate         # client in src/generated/prisma (run after changing the schema)
npx prisma migrate deploy   # needs a reachable Postgres
npx prisma db seed          # creates the admin (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run dev                 # http://localhost:3000

# Web
cd apps/web
npm install
npm run dev                 # http://localhost:5173 (proxy /api -> :3000)
```

**New migration:** change `schema.prisma` and generate the SQL against an empty shadow database
(`SHADOW_DATABASE_URL`, used only here):

```bash
export SHADOW_DATABASE_URL=postgresql://postgres:pg@localhost:55432/shadow
mkdir prisma/migrations/AAAAMMDDHHMMSS_nome
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma \
  --script > prisma/migrations/AAAAMMDDHHMMSS_nome/migration.sql
npx prisma generate
```

---

## Security and warnings

- ⚠️ DeepLook **does not execute** the samples. It is storage/triage, not a sandbox.
  Handle downloaded files in an isolated environment.
- The objects are kept in a **private** bucket in MinIO; download only happens through an
  authenticated API endpoint.
- Sign-up requires an **activation key** generated by an admin.
- Passwords use **bcrypt hashing**; the session uses an **httpOnly cookie**. The database stores only the SHA-256
  of the cookie (as with API tokens), so neither the database nor a backup yields valid sessions.
  With `COOKIE_SECURE=true` the cookie is called `__Host-dl_session`: another subdomain of the same
  domain cannot write or replace it.
- A request that changes something coming from **another site**, including another subdomain of your
  domain, is refused with 403 (the browser reports this in `Sec-Fetch-Site`). The same applies to
  the console's WebSocket. Scripts with an API token do not send this header and are not affected.
- The API only accepts connections from the **internal `deeplook` network** (fixed subnet, `DEEPLOOK_SUBNET`) and from
  its own container. The isolated capture browser is on another network and cannot reach the API,
  even if a malicious page compromises it; only that network's nginx reports the client IP.
- The capture network is internal and exits only through `egress`: a compromised browser cannot reach the
  LAN, the host or an internal address, because there is no route outside the proxy.
- The logs of the API and nginx keep the path without the query string, because search and the indicator card carry
  victim URLs, with tokens or emails.
- `web`, the API, capture and egress run **as non-root and with no capabilities**, with a **read-only** filesystem
  and a process limit. The API writes only to `/tmp`, which is a disk volume (`api-tmp`) and not memory, because without
  `BACKUP_DIR` the whole backup ZIP is assembled there. Leftovers from an interrupted backup or ISO are deleted on
  startup. Prisma CLI telemetry is disabled (`CHECKPOINT_DISABLE`). The final images do not include `npm`. nginx does not
  reveal its version, sends `Permissions-Policy`, `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy`, and hashed assets are cached for one year.
- The database, MinIO and ClamAV run with `no-new-privileges` and **only the capabilities that each one's
  entrypoint needs** (measured one by one: starting, writing and restarting with their own data). The database keeps
  `CHOWN`, `DAC_OVERRIDE`, `SETGID` and `SETUID`. MinIO keeps only `DAC_OVERRIDE`. ClamAV, which reads malicious files,
  keeps those four plus `FOWNER`. The other default Docker capabilities, such as `NET_RAW`, `MKNOD` and `SYS_CHROOT`,
  are dropped.
- `egress` refuses the 80 ports that Chromium itself refuses (SMTP, SSH, IRC, NFS...), measured in the image's
  browser, even if the browser is compromised. No other port is blocked, because phishing on a high port needs to be captured.
- `Cross-Origin-Opener-Policy` only applies to a trusted origin (HTTPS or `localhost`), which are the two access paths
  (the Tunnel and the port on `127.0.0.1`). Over HTTP under another name the browser ignores it and writes a warning to the
  console, with no functional effect.
- HSTS `includeSubDomains` applies to the subdomains of the address that serves DeepLook: use a dedicated name
  (for example, `deeplook.exemplo`), and not the root domain, if other subdomains are still served over HTTP.

---

## Code quality (lint & format)

Each app has **ESLint** (flat config) + **Prettier** configured:

```bash
# run inside apps/web or apps/api
npm run lint          # checks (exits with error if there are problems)
npm run lint:fix      # fixes automatically (e.g. import order)
npm run format        # formats with Prettier
npm run format:check  # only checks the formatting
```

Active rules: `typescript-eslint` (recommended), import ordering
(`simple-import-sort`), `react-hooks` (in web) and `eslint-config-prettier`
(turns off style rules that conflict with Prettier).

In addition, `tsc` runs with **`noUnusedLocals`** and **`noUnusedParameters`** —
that is, `npm run build` **fails** if an unused variable/import/parameter is left over.

Carbon's CSS is **selective** (`app.scss` imports only the modules of the components in use):
`node scripts/check-carbon-css.mjs` fails if an imported component is left without its
corresponding module — CI runs this step in the `check` job.

---

## Interface (HP Service Manager 9 style)

The interface imitates the **HP Service Manager 9 web client**, without modernizing it: light theme,
Tahoma 12px, 24px controls, blue masthead, the **System Navigator** as a tree,
**document tabs** for each open screen, a single message bar,
per-record action toolbar and forms with the label on the left. The behavior of the
controls comes from the Carbon Design System; the look comes from the tokens and the skin:

| File | Role |
| --- | --- |
| `src/styles/_tokens.scss` | `--dl-*` tokens (colors, typography, measures) — single source of truth |
| `src/styles/hpsm.scss` | skin of the logged-in app: realigns Carbon's `--cds-*` tokens and styles the `hpsm-*`/`dl-*` components |
| `src/styles/auth.scss` | public pages (home, login, sign-up) |
| `src/styles/app.scss` | styles entry point + shell layout; lists the Carbon modules in use (selective CSS) |
| `src/styles/_carbon-theme.scss` | tokens of the light `g10` theme, emitted before the HPSM skin |

Components, conventions (what to use and avoid from Carbon), routes, user preferences and visual
verification are in **[`docs/interface-hpsm.md`](docs/interface-hpsm.md)**. Prioritized UX ideas:
**[`docs/ux-backlog.md`](docs/ux-backlog.md)**.

### My Account and preferences

The user's name at the top opens a submenu (My account, Change password, Preferences,
Sign out). At `/user` the user sees their data (read-only), changes the password — which
**ends all sessions** and requires a new login — and adjusts the preferences: home page (default: the
**Home Page** welcome screen, `/inicio`), records per page and reopening the tabs from the previous session. On the
**Notifications** tab, each person chooses which alerts reach the Inbox; those that require action (assignment, overdue,
report returned, resolution, YARA packs) always arrive.

| Method | Route | Function |
|---|---|---|
| PATCH | `/api/me/preferences` | Updates preferences (partial) |
| POST | `/api/me/password` | Changes the password and ends all sessions |

---

## Analysis sandbox (Proxmox VE)

Analysts can open an **isolated VM per sample**: a clone of the template is created
on Proxmox, receives the sample as a **read-only CD-ROM** (an ISO9660 generated on the spot, with the file,
the SHA-256 and a README) and is accessed through a **noVNC console in a dedicated window** (popup with the VM control
toolbar). When it ends — or when the deadline passes — the VM is powered off, destroyed and the ISO is deleted.

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

### Why ISO (and not uploading the file)?

The Proxmox API has no endpoint to "put a file inside the guest": the official path
is to mount a volume with `content=iso` and attach it as a CD-ROM. A
`.exe` renamed to `.iso` **does not** mount — that is why the API generates a real ISO9660
with `genisoimage` (already installed in the API image).

### Console: why a PVE user/password?

The console endpoints (`vncproxy`/`vncwebsocket`) **do not accept an API token**, only
a user ticket. The API then:

1. authenticates with `PROXMOX_USER`/`PROXMOX_PASSWORD` (`POST /access/ticket`);
2. caches the ticket (~2h, renewed automatically);
3. opens the `vncwebsocket` with the cookie + `CSRFPreventionToken` **on the backend**;
4. exposes to the browser only `/api/sandbox/<id>/console/ws`, a WebSocket of ours
   (nginx has a `location /api/sandbox/` with `Upgrade`/`Connection`).

The ticket never reaches the front end. As the PVE ticket is bound to the IP, the proxy needs to
leave from the **same container** that requested the ticket.

**VNC auth:** `vncproxy` also returns a console **password**; `vncwebsocket`
requires VNC auth (the password never goes to the front end before it is needed: noVNC fetches it from
`GET /api/sandbox/:id/console/credentials` during the handshake).

**Console window:** the *Analysis* tab only manages the environment; the console opens in a
**separate window** (`/sandbox/entry/:id/console`, via `window.open`) that has the
**VM control toolbar**: extend the deadline, capture the screen and discard the environment. The
window is reused by name (clicking again focuses the same window) and, as provisioning takes a few seconds, it already opens
showing the stages and joins the console by itself when the VM comes up. If the browser blocks the pop-up, the panel
says how to allow it.

**Screen capture:** the "Capture screen" button (in the console window toolbar) reads the
**noVNC canvas** in the browser itself and opens the PNG in a new tab — PVE removed the
server-side screenshot endpoint in PVE 9, which now responds `501`.

### Preparing the template in Proxmox

1. Create a VM (Windows/Linux) with `qemu-guest-agent`, **isolated network** (bridge with no
   route to the LAN) and no corporate credentials.
2. Install the analysis tools you use.
3. **Create a snapshot** (the linked clone uses this state as the base; without a snapshot
   DeepLook automatically falls back to a full copy, which is slower).
4. Convert it to a template (`qm template <vmid>`).
5. Create a dedicated user (`deeplook@pve`) with `PVEVMAdmin` on `/vms` (the clone
   gets a new VMID, so the permission goes on `/vms`, not on `/vms/<template vmid>`),
   `PVEDatastoreAdmin` on the ISO storage and on every storage that holds a template
   disk, and `PVESDNUser` on the template bridge. Details in
   [`docs/proxmox.md`](docs/proxmox.md).
6. Fill in the `PROXMOX_*` variables in `.env` and turn it on with `SANDBOX_ENABLED=true`.

> 📖 Full step by step — template, permissions (including **Datastore** for the
> ISO upload), `.env`, Docker→PVE network, validation and troubleshooting:
> **[`docs/proxmox.md`](docs/proxmox.md)**.

### Mock mode (development without PVE)

With `PROXMOX_MOCK=true` the API simulates Proxmox in memory (clone, start, tasks,
vncproxy, screenshot): the full flow — provision, console, discard — runs
without a real PVE. Validate with `scripts/smoke-sandbox.ps1`.

### Limits, TTL and cleanup

- `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` limit how many environments exist.
- `SANDBOX_TTL_MINUTES` sets the deadline; the **reaper** runs every minute and ends
  whatever has expired.
- On boot the API marks interrupted provisionings as failed, removes VMs with the
  `SANDBOX_TAG` label that have no active session, and orphan `deeplook-*` ISOs.
- `GET /api/sandbox/health` (admin) shows the diagnostics: PVE reachable, template,
  storage with `content iso`, console user and configured limits.

### Endpoints

| Method | Route | Function |
|---|---|---|
| GET | `/api/sandbox/health` | Integration diagnostics (admin) |
| GET | `/api/entries/:id/sandbox` | Active session of the sample (used in the panel) |
| POST | `/api/entries/:id/sandbox` | Opens the environment (analyst) |
| GET | `/api/sandbox` | Lists environments (`?active=true`, `?scope=all` for admin) |
| GET | `/api/sandbox/:id` | Details + current VM state (panel polling) |
| POST | `/api/sandbox/:id/extend` | Extends the deadline |
| POST | `/api/sandbox/:id/power` | Turns the VM on/off (`{"action":"on"\|"off"}`) |
| DELETE | `/api/sandbox/:id` | Discards (destroys the VM and deletes the ISO) |
| GET | `/api/sandbox/:id/console` | Path of the console WebSocket |
| GET | `/api/sandbox/:id/console/credentials` | Ephemeral console password (VNC auth in the handshake) |
| GET | `/api/sandbox/:id/console/ws` | WebSocket (authenticated proxy to PVE) |
| GET | `/api/sandbox/:id/screenshot` | Screen capture (PNG) — removed in PVE 9; the panel captures in the browser |

---

## Tests

They only need Docker running; they bring up what they use and do not touch the running stack.

```bash
cd apps/api
npm run test:integration            # API against real Postgres, MinIO and OpenLDAP
npm run test:integration -- ldap    # only the files with "ldap" in the name
npm run typecheck:tests             # test types (the tsx that runs them does not check types)
npm run test:images                 # real images: lockfile, web and API non-root, headers, capture
npm run test:smoke                  # real browser against the web and API images

cd ../web
npm run test:unit                   # Vitest: pure logic, hooks and components (jsdom)
npm run test:coverage               # the same, with the coverage floor from vitest.config.ts

# from the repository root
node scripts/check-playwright-version.mjs   # package, image and tests on the same Playwright version
node scripts/trivy.mjs image deeplook-api   # CVE in an image (the same command as CI)
```

- **Integration** (`apps/api/tests/integration`): each file runs on a new database. The disk images
  and the certificates are generated on the spot, in `tests/.tmp`. `--clean` removes the
  containers when finished.
  The `pe-analysis` executables are compiled on Debian (mingw-w64, mcs, upx, osslsigncode)
  with the reference output of `pefile`, `dnfile` and `osslsigncode` (`tests/fixtures/pe/gen.sh`); the
  first run takes about 40 s longer, and they are only rebuilt when the sources change.
- **Quick test** (`test:smoke`): with real Postgres and MinIO, it runs the main path (first access,
  upload, bulk triage, regular user) and opens the screens. An unexpected API, console or CSP error fails it. It catches what the
  mocked API of the screens hides.
- **Screens** (`scripts/ui-playwright/run.ps1`): browser scenarios with the mocked API. Runs
  all of them and lists the ones that failed.
- **Visual suite** (`scripts/ui-visual`): compares the critical-layout screens with versioned
  screenshots. It does not check behavior (that belongs to the scenarios above), but what the screen
  *looks like*: spacing, alignment, table, typography, density. Ten screens on desktop and four
  of them also at 1024 px. It runs in the Playwright image, the same one that generated the baselines, with a
  frozen clock, no animation and no cursor: the result does not depend on the machine.

```bash
cd apps/web && npm run build        # the dist is what the suite serves
sh scripts/ui-visual/run.sh         # compares (on Windows: run.ps1)
sh scripts/ui-visual/run.sh --update-snapshots   # rewrites the baselines on purpose
```

  If a screenshot diverges, `test-results/` holds the `actual`, the `expected` and the `diff`; in CI they
  are uploaded as an artifact. An intentional screen change updates the baseline **in the same PR**, and the
  review of the diff is the review of the visual change.
- **Images** (`test:images`): `web` runs with the configuration **read from compose** (read-only, no
  capabilities, limits, healthcheck): the test exercises what goes to production.
  It checks the security headers on `/`, on an asset and on an error response, the cache, the
  gzip and the 404 for a missing asset.
- **Web unit** (Vitest): `api/client.ts`, the logic modules, the hooks and the
  `ErrorBoundary`. The coverage floor only applies to modules that already have tests; when a module gains
  a test, it joins the list in `vitest.config.ts`.
- **CI** (`.github/workflows`): `ci.yml` runs the lint, formatting, build and tests of web and API,
  the capture tests (with the Playwright check), the integration tests, the image tests
  (`images`, on every PR) and the quick browser test (`smoke`, outside PRs); `audit` blocks high-severity
  vulnerabilities. `security-scan.yml` runs **Trivy** every Monday on the three project images, the third-party
  images in compose and the Dockerfiles. It fails on high or critical severity **with a fix available**; an exception is justified in `trivy.yaml`.

## Smoke test (with the stack running)

After `docker compose up`, sign in once as admin to change the password, and run the end-to-end test
with it in `SMOKE_ADMIN_PASSWORD`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
```

It checks: frontend (SPA), health, admin login, generation of activation keys,
sign-up with a key (user and analyst), file/link submission (MinIO),
listings and search (including by tag), permission blocks (403/401),
report creation, verdict/status update and authenticated download.

For the sandbox (with `SANDBOX_ENABLED=true`), the specific test opens an environment,
follows the provisioning, checks console/screenshot, validates the console
WebSocket, extends the deadline and discards the VM:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-sandbox.ps1
```

Visual check (screenshot of an authenticated page via CDP, no dependencies):

```powershell
node scripts/ui-shot.mjs "http://localhost:8080/entries/<id>" data/ui.png "<cookie dl_session>"
```

Visual tests without a database (front-end build + mocked API, Playwright in Docker):
screenshots of all screens and checks of the filters and the My Account flow.

```powershell
cd apps/web; npm run build; cd ../..
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
```

Details in [`docs/interface-hpsm.md`](docs/interface-hpsm.md#7-visual-verification-playwright).

---

## Roadmap (next steps)

UI and usability improvements are prioritized in
[`docs/ux-backlog.md`](docs/ux-backlog.md). Other next steps:

- Email notifications (SMTP).

Already delivered from this list: ClamAV and external reputation (VirusTotal and others),
bulk submission, report export (Markdown; PDF via the printed card), optional 2FA,
password policy, the backup folder outside the disk (`BACKUP_DIR`) and scheduled backup.

---

## Credits

- **Icons:** the [`icons/`](icons/) folder originated from the **Silk** icons, by Mark James,
  from [FamFamFam](http://www.famfamfam.com/lab/icons/silk/), licensed under
  [Creative Commons Attribution 2.5](https://creativecommons.org/licenses/by/2.5/). Thank you!
