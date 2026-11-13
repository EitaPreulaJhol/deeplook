# 🔎 November 2026 review: findings, fixes and suggestions

> 🇧🇷 [Leia em português](revisao-2026-11.pt-BR.md)

A review of the whole project looking for problems and failures, done on 2026-11-12, with the
list of what would be worth adding. The code was read by sampling the highest-risk areas
(authentication, network, upload, sandbox, isolated services and compose), not line by line.

Status: ✅ fixed · ⬜ pending · ❓ depends on the owner's decision.

## 1. What was run

| Check | Result |
|---|---|
| `tsc`, ESLint and Prettier (API and web), test types | clean |
| Web unit tests (Vitest) | 120 passed |
| `capture` tests | 13 passed |
| API integration in Docker (Postgres, MinIO, OpenLDAP, capa, Ghidra, unpack) | 1478 checks in 41 files, all ok |
| `docker compose config` | valid |
| `npm audit` | `capture` with 0; API and web with 10 moderate each, all in the `typescript-eslint` chain (development only) |

Not run: `test:images`, `test:smoke` and the Playwright visual suite.

After the fixes: `tsc`, ESLint, Prettier and `typecheck:tests` clean on the API, the 13 `capture`
tests and the affected integration files (`console-access`, `login-security` and `unpack`,
71 checks) green. The full suite was not repeated after the fixes.

## 2. Findings and fixes

No serious failure. Except for 2.2, the findings come from reading the code, without reproducing
them before the fix.

### 2.1 The sandbox console took the API down when the database was out — ✅

In `apps/api/src/routes/sandbox.ts`, the console WebSocket ran in an async function with no
`catch`, with `loadUser` and `getSession` outside any `try`. With Postgres restarting, the promise
rejected unhandled and Node ended the process. It is the same class as item 8.1 of the
[improvement plan](plano-melhorias.md); this spot had been left out.

**Fix:** a `catch` on the function, which logs the error and closes the console with
`erro interno`. **Test:** `console-access.test.ts`, with the session `findUnique` rejecting: the
console closes with that reason and there is no unhandled rejection.

### 2.2 `.env` readable by any user on the machine — ✅

The file had mode 644; `docs/implantacao.md` asks for 600. **Fix:** `chmod 600 .env`. It belongs
to the machine, not to Git: whoever clones again repeats the step.

### 2.3 CI, Dependabot and Trivy do not run — ❓

The repository has no remote (item 8.9 of the plan, already pending). Meanwhile, the 10 moderate
`npm audit` findings and image CVEs raise no warning. Only the remote address is missing.

### 2.4 API wait times missing from compose — ✅

`CAPA_REQUEST_TIMEOUT_S`, `GHIDRA_REQUEST_TIMEOUT_S`, `UNPACK_REQUEST_TIMEOUT_S` and
`BACKUP_PG_DUMP` existed in `env.ts`, but `docker-compose.yml` did not pass them on: whoever
raised `CAPA_TIMEOUT_S` or `GHIDRA_TIMEOUT_S` in `.env` saw the API give up before the service.

**Fix:** the four variables are now in compose, with the same defaults as `env.ts`, and the three
wait times are in `.env.example`, along with `ALLOW_INSECURE_DEFAULTS` and `CLAMAV_IMAGE`, which
were also missing there.

### 2.5 nginx accepts `CF-Connecting-IP` from any private address — ✅

In `apps/web/nginx.conf`, `set_real_ip_from` covers every private range. Another container on the
network, or a local reverse proxy that forwards the client's header, allows forging the IP, which
defeats the per-IP login limits and pollutes the audit log.

**Fix (phase 0.1):** `cloudflared` runs on the host and arrives through the published port;
measured, nginx sees it as the gateway of the `deeplook` network. The header is now trusted only
from that address (`REAL_IP_FROM`, default `172.31.250.1`) and from loopback. `nginx.conf` became
a template that the image's entrypoint fills in and writes to `/tmp` (the root is read-only).
**Test:** in `test:images`, a forged header from another container is ignored and the tunnel
path still works.

### 2.6 An open console was not revalidated — ✅

The WebSocket only checked the session on connect: logging out, idle expiry or losing the role
did not close an already open console. The buffer for messages arriving before Proxmox answers
also had no ceiling (messages of up to 16 MB each).

**Fix:** every 30 s, on the same tick as the ping, the API checks whether the cookie's session is
still valid and whether the person may still operate the environment; if not, it closes with
`sessão encerrada`. A database failure during that check does not close the console: it repeats on
the next tick. The buffer got a 1 MB ceiling. **No automated test:** revalidation depends on a
console open against Proxmox.

### 2.7 Login limiter memory without cleanup — ✅

`FailureWindow` (`apps/api/src/lib/rate-limit.ts`) only removed a key when it was queried again:
random e-mails, tried once, stayed forever.

**Fix:** above 5,000 keys, each new failure sweeps the expired windows. **Test:** in
`console-access.test.ts`, 6,000 expired keys are gone on the next failure.

### 2.8 `unpack` service: broken link and a name coming from the sample — ✅

- In `apps/unpack/server.py`, `os.path.getsize` came before the symbolic link test: a broken link
  in the extraction made the whole job fail. **Fix:** the test comes first.
- In `unpackers/u20_pyinstaller.py`, the entry point name comes from the sample's index and was
  joined to the path unchecked. **Fix:** the resolved path must stay inside the extracted folder,
  and `server.py` now refuses, for any unpacker, a file outside the output folder. The impact was
  low: a disposable container, with no network and read-only.

### 2.9 Minor hardening

| Item | Status |
|---|---|
| `capture` token compared with `!==`; now constant-time, as in the Python services | ✅ |
| `PROXMOX_VERIFY_TLS` defaults to `false`: changing the default would break self-signed setups | ❓ |
| Dockerfile base images by tag, not digest (the compose ones are pinned); Dependabot would handle it, with the remote | ⬜ |
| CSP with `connect-src ws: wss:` open to any host: replaced by `'self'` (phase 0.2). The browser smoke test opens the console WebSocket through nginx and checks the CSP does not block it. Chromium only: Safari is left for a manual check | ✅ |
| `pe-ordinals.json` duplicated in `apps/api` and `apps/ghidra`: `scripts/check-pe-ordinals.mjs` fails CI on drift (phase 0.3) | ✅ |

### 2.10 `SESSION_SECRET` is the root of everything — ✅

It signs the cookies and the CAPTCHA and encrypts the 2FA secrets: changing it breaks 2FA for
every account. It was not a defect, it was design. **Solved in phase 1.1:** with `DATA_KEY` in `.env`,
2FA depends only on it, and `SESSION_SECRET` can be changed.

## 3. Suggested additions (to be validated)

Nothing here has been started. E-mail and webhooks were left out: the plan marks them as out of
scope.

### 3.1 Operations and security

- [ ] Repository on a private remote (item 8.9): turns on CI, Dependabot and Trivy at once.
- [ ] Restore script with an automated test; today restoring is a manual walkthrough.
- [ ] Data key separate from `SESSION_SECRET`, versioned, for rotation without breaking 2FA.
- [ ] Prometheus metrics (item 3.1 of the plan, pending).
- [ ] Shipping the audit log to syslog/SIEM.
- [ ] Hash-chained audit log, to make tampering evident.
- [ ] SBOM and image signing.
- [ ] OIDC/SSO login.
- [ ] Passkeys (WebAuthn) as a second factor.

### 3.2 Analysis

- [ ] Already planned items, in the suggested order: 7.5 (explainable risk score) and 7.14
      (Office/PDF with oletools) first, for the return on effort.
- [ ] Sandbox: automatic collection of VM artifacts (pcap, process list, periodic screenshots).
- [ ] Links: enrichment with WHOIS, passive DNS and Certificate Transparency.
- [ ] Links: perceptual hash of the screenshots, to cluster phishing kits.
- [ ] STIX bundle import and export per case.
- [ ] Active push of indicators to MISP.

### 3.3 Quality

- [ ] Fuzzing the parsers (PE, ELF, LNK, documents, ZIP, EML), which read hostile input.
- [ ] Unit tests for the API libraries; today there is only integration.
- [ ] More web coverage: the 95% counts only the modules that already have tests.
- [ ] Streaming upload straight to S3 with hashing in transit, instead of building the file in
      memory.
- [ ] English interface (i18n), since the documentation has an en-US version.

## 4. Next steps

1. Decide the three ❓ items: remote (2.3), `CF-Connecting-IP` range (2.5) and the
   `PROXMOX_VERIFY_TLS` default (2.9).
2. Validate which suggestions from section 3 go in, and in what order.
3. Run `test:images`, `test:smoke` and the full integration suite before publishing this review's
   fixes.

## 5. Action plan

Decided on 2026-11-12 by the owner: the `CF-Connecting-IP` range (2.5), the CSP and
`pe-ordinals.json` (2.9), three items from 3.1 (restore, data key, chained audit log) and every
suggestion from 3.2 and 3.3 go in. Left out for now: remote, metrics, syslog/SIEM, SBOM, OIDC and
passkeys.

How to work: one item per commit, straight on `main`; each one only closes with lint, types and
the affected tests green, and with its status updated in this note. The full suite (integration,
`test:images`, `test:smoke`) runs at the end of each phase. Sizes: **S** up to half a day, **M**
1–2 days, **L** several days.

### Phase 0 — Close the review — ✅

Done on 2026-11-12 (commits `ed36f2d` and `498104a`). The second fixes the first: when the commits
were split by hunk, the `REAL_IP_FROM` block landed a few lines out of place in
`docker-compose.yml` and `.env.example`. The working tree, which the tests ran against, was
correct; commits `ed36f2d`, `fffa85d` and `b9dd294` should not be used on their own.

| # | Item | How | Size |
|---|---|---|---|
| 0.1 | `CF-Connecting-IP` range (2.5) | `cloudflared` runs on the host, outside a container, and arrives through the port published on `127.0.0.1`; nginx should see it as the gateway of the `deeplook` network. Measure the real address before narrowing, and trust only it (and loopback), with a variable for whoever publishes differently. The `web` root is read-only: the generated configuration goes to `/tmp`. Test in `test:images`: a forged header from another container is ignored. | S |
| 0.2 | CSP `connect-src 'self'` (2.9) | Replace `ws: wss:` with `'self'` and validate the sandbox console through nginx (mock mode, `scripts/ws-console-check.mjs` and the browser smoke test). Limit: only Chromium is available here; Safari is left for a manual check. | S |
| 0.3 | `pe-ordinals.json` (2.9) | Keep both copies (each Dockerfile only sees its own folder) and fail on drift with a check script in CI, in the mould of `scripts/check-*.mjs`. | S |

### Phase 1 — Operations and security — ✅

Done on 2026-11-12: 1.1 in commit `fffa85d`, 1.2 in `b9dd294` and 1.3 in the next one.
Differences from the plan:

- **1.1:** besides `v2`, the encrypted value carries the key id, and `DATA_KEY_PREVIOUS` exists to
  change `DATA_KEY` itself. Without `DATA_KEY`, nothing changes (legacy mode).
- **1.2:** the restorer runs in the API image (`scripts/restore.sh` calls `docker compose run`),
  with `--check`, `--rehearsal` and the real restore. The script itself was only syntax-checked:
  the compose path was not exercised against a live installation. The rehearsal runs in the
  production image inside `test:images`.
- **1.3:** beyond the plan, the event keeps the id of the actor and of the target outside the
  foreign key (it goes into the hash and survives a deleted account), the Audit tab shows the
  chain state, and restore checks the restored database's chain against the head in the manifest.

| # | Item | How | Size |
|---|---|---|---|
| 1.1 | Separate data key | `DATA_KEY` in `.env`, with a version in the encrypted value (`v2`). 2FA secrets in `v1` (derived from `SESSION_SECRET`) stay readable and are re-encrypted on startup. Cookies and CAPTCHA stay on `SESSION_SECRET`, which can then be changed without breaking 2FA. System status warns if the key is missing. | M |
| 1.2 | Restore script | `scripts/restore.mjs`: takes the ZIP and the password, checks the manifest (SHA-256 of each file), restores the database with `pg_restore` and puts the objects back in the bucket; a rehearsal mode that restores into a separate database and bucket. Automated test: backup, restore and comparison of counts and hashes. It comes after 1.1 because the restored data depends on the same keys, and the backup README will say so. | M |
| 1.3 | Hash-chained audit log | Sequence number, previous hash and own hash on each event, written under a lock so the order is unique; the hash covers only fields that do not change (a deleted actor becomes null today). A migration that chains the history, a periodic check with a warning in system status, and the chain head in the backup manifest. Limit to record: it makes editing and removing rows evident, not a full rewrite by whoever controls the database and the backups. | M |

### Phase 2 — Quality — in progress

- **2.1 ✅** (commit `d8b708d`): 52 unit tests in `apps/api/tests/unit`, on `node:test`, in under a
  second and without Docker; its own CI step.
- **2.2 ✅**: fuzzer in `apps/api/tests/fuzz` (`npm run test:fuzz`), with seven targets, a short
  round in CI and a regression corpus. **Found and fixed:** a 1.5 KB OLE file with a looping FAT
  cost about 1 s of CPU and 100 MB per chain read in `doc-analysis.ts` (200 thousand iterations);
  reading no longer repeats a sector nor exceeds the file size, and the case takes 1 ms. After the
  fix, 280 thousand cases over two seeds with no finding. Limit: the fuzzer is not
  coverage-guided; the ZIP target, for example, rejects almost every mutation early.
- **2.3 ✅**: an upload goes to disk (the API's `/tmp`) while it arrives, with SHA-256 and size
  computed in transit, and only enters memory once complete, reserved by its real size. **What
  changes in practice:** memory used to be reserved at the start, by the declared size, and held
  while the body arrived: three slow 200 MB uploads left everyone getting 503. Now what is
  arriving takes disk (`MAX_UPLOAD_SPOOL_MB`), each person takes at most half of it, and whoever
  has already sent everything waits for memory for up to 30 s instead of being told to send
  again. **Difference from the plan:** analysis still reads the whole file into memory (the
  parsers work on a Buffer), and MinIO receives it from there; "streaming straight to S3" was not
  done. **Regression caught by the battery and fixed before the commit:** the first version
  capped a person at 4 simultaneous uploads, which broke the 30-file batch; the limit became disk
  space instead.
- **2.4 ✅**: tests for the web logic modules that had none (password policy, start page,
  Previous/Next sequence, sandbox states and countdowns, favorites, sample and case export,
  knowledge base, team views, "take next"): from 120 to 175 tests. **Difference from the plan:**
  the coverage floor now counts all logic outside components (the `.ts` files in `api`, `auth`
  and `components`), not every module: screens (`.tsx`) stay with the Playwright scenarios.
  Measured: 87.3% of statements; floor at 84%.
- **2.5 ✅ (interface)**: infrastructure without a new library (`apps/web/src/i18n`: one dictionary
  per area, with Portuguese and English side by side, each with its own `t()`; `localized()` for
  module-level tables; dates and numbers through `Intl` in the chosen language), language saved in
  the account preferences and, before sign-in, on the machine, and every screen translated, in 8
  stages (frame, lists and record, analysis, submission and cases, detection, management,
  administration, account and the rest). API errors come in English for whoever sends
  `Accept-Language: en` (the interface sends its own language): a hook translates `error` and
  `details` through a dictionary of over 300 messages, without touching the routes. **Decisions:**
  without a choice, Portuguese, even with the browser in English; each screen's Portuguese text did
  not change, so the UI scenarios still hold. **Still in Portuguese:** what the API stores as data
  (analysis alerts, findings, risk reasons, history and status details), the audit CSV and the
  OpenAPI specification.

It comes before the analysis features because tests and fuzzing protect what phase 3 touches.

| # | Item | How | Size |
|---|---|---|---|
| 2.1 | Unit tests for the API libraries | `node:test` with `tsx`, no Docker, for the pure libraries (IOC normalization, CSV, ZIP, entropy, TLSH, password policy, triage rules); its own CI job. | M |
| 2.2 | Parser fuzzing | Mutation from the existing fixtures (PE, ELF, LNK, documents, ZIP, EML), with three invariants: typed errors only, time and memory within the ceiling. Seeds that break become fixed tests. A short run in CI and a long one on demand. | M |
| 2.3 | Streaming upload | Today the whole file goes to memory (`part.toBuffer()`). It will go to disk (the API's `/tmp`) with the SHA-256 computed in transit, and the analyses read from there. It is the riskiest change in the plan: it touches upload, ZIP, quota, antivirus, YARA and static analysis. | L |
| 2.4 | Web coverage | Tests for the modules with logic that have none yet, and the coverage floor counting every module, not only the tested ones. | M |
| 2.5 | English interface (i18n) | 33 pages and about 90 components with Portuguese text, plus the API error messages. In stages: infrastructure and language switch, then extraction screen by screen; API errors carry a code and the text lives in the front end. Being the largest item, it goes last (after phase 3). | L |

### Phase 3 — Analysis — ✅ (except 3.6, deferred)

End-of-phase battery, on the tree of commit `c76b3b9`: 79 unit tests, the short fuzz round, 1,668
integration checks in 49 files, `test:images`, `test:smoke` and the 95 UI scenarios, all green.

- **3.1 ✅**: explainable risk score. The score (0 to 100) is computed on request by the API from
  the same signals the triage rules already read, plus external reputation; each reason shows on
  the record with the weight it had, and the weight table is in the README. Analysts only.
  **Decisions worth checking:** the suggestion is never "clean"; antivirus alone (60) suggests
  *Suspicious*, not *Malicious*; the weights are fixed in code, not configurable from the screen.
- **3.4 ✅**: perceptual hash (256-bit dHash) of the top of the screenshot, computed in the
  `capture` service with Chromium itself (the thumbnail is made in a new context, with no network
  and without the captured page's JavaScript), stored on the capture and compared in the Related
  tab (*Página com a mesma aparência*, from 90%) and in the relation map. An almost blank page gets
  no hash. **Difference from the plan:** no new library, neither in the API nor in the capture.
  **Found along the way:** `capture-recycle.test.ts` only passed because another test file created
  the bucket first; run alone, it failed with `NoSuchBucket`. The test now creates the bucket.
- **3.3 ✅**: link enrichment as three new rows of external reputation: **Registro (RDAP)**, asked
  directly of the TLD registry's server through IANA's list; **Certificados (crt.sh)**; and
  **DNS passivo**, through VirusTotal resolutions (the owner's decision). Only the domain or the IP
  leaves. **Difference from the plan:** RDAP and crt.sh need no key and are therefore **off by
  default** (`RDAP_ENABLED`, `CT_ENABLED`), so no domain goes to a service the person did not
  choose; passive DNS turns on with the VirusTotal key and shares its quota. A domain under 30 days
  old and a first certificate under 14 days old become *Suspicious* and count in the risk score.
  **Found along the way:** external reputation had no integration test; `reputation.test.ts` now
  covers the enrichment and what leaves DeepLook.
- **3.5 ✅**: case STIX package. The case IOC export already existed; the new `stix-case` format
  also carries the samples (observables), the ATT&CK techniques, the published reports (notes) and a
  case `report`. Import into a case (with a preview) creates samples for the links and brings in the
  samples that already exist by link or SHA-256. **Decisions worth checking:** a file in the package
  that was never submitted is left out (the package does not carry the file); domains, IPs and
  e-mails are only counted (following them already exists in Import indicators); at most 50 new
  links per import. Link sample creation moved from the route to `lib/entry-create.ts`, and
  submission from the screen and the import use the same path.
- **3.2 ✅**: oletools in a new service (`apps/oletools`), with capa's isolation (no network,
  read-only, no root, one container per analysis) and the analysis in a child process with a time
  limit. A persisted queue like capa's; every Office document or RTF goes by itself; the record gets
  the **Documento (oletools)** section; high alerts count in the risk score; system status gets the
  component. **Test limit:** without Office, a `.doc` with VBA could not be built here. The macro path
  was checked two ways: running the image's `analyze.py` on loose VBA code (MacroRaptor `A-X`, keywords
  and deobfuscation) and on a SYLK with XLM 4.0, and, in the API, with a fake service. With the real
  container, the integration test covers a DOCX with DDE and an RTF with the Equation Editor object.
  **Owner action:** set `OLETOOLS_TOKEN` in `.env` before bringing this version up; with the default
  value the API refuses to start in production (like the other tokens). **Found along the way:** the
  deployment checklist did not generate phase 1's `DATA_KEY`; now it does.
- **3.7 ✅** (without the pcap, deferred by the owner): while the environment runs, periodic
  screenshots and the process list through the `qemu-guest-agent`, and a last collection on closing;
  in the Analysis tab, the thumbnails and the processes that appeared since the start. **Finding that
  changed the design:** PVE 9 removed the screenshot endpoint (the README already noted it; the
  "Capturar tela" button reads the canvas in the browser). The API now takes the screenshot through
  the VNC console itself (`lib/vnc-snapshot.ts`, a minimal read-only, shared RFB client); the
  endpoint is still tried first, for PVE 8. **Test limit:** without a Proxmox here, the real path
  (PVE's vncwebsocket and `agent/exec`) was not exercised; the VNC reader was tested against an RFB
  server with a password and against the project's mock VNC, and the whole collection against the
  mock Proxmox. Worth confirming on your PVE that the `PVEVMAdmin` role grants agent use
  (`VM.GuestAgent.Unrestricted` on PVE 9).
- **3.6** deferred by the owner.

| # | Item | How | Size |
|---|---|---|---|
| 3.1 | Explainable risk score (7.5) | A score with the list of reasons and weights (YARA, ClamAV, PE alerts, capa, FLOSS, reputation); it suggests the verdict, the analyst decides. | M |
| 3.2 | Deeper Office and PDF (7.14) | `oletools` in an isolated service in the mould of `capa` and `unpack` (no network, read-only, one container per job). | M |
| 3.3 | Link enrichment | RDAP (today's WHOIS, no key) and Certificate Transparency next to reputation, with the same care: only the domain leaves. Passive DNS through VirusTotal resolutions, with the key that already exists. | M |
| 3.4 | Perceptual hash of screenshots | Computed in the capture container itself (the browser already downsizes the image), with no new library in the API; it shows in Related as "similar page". | S–M |
| 3.5 | STIX per case | Export and import a case's STIX 2.1 bundle, reusing what the TAXII feed already generates. | M |
| 3.6 | Push to MISP — ⏸ deferred by the owner | Send the indicators of a case or published report to a configured MISP (URL and key), on demand. | M |
| 3.7 | Sandbox artifacts | Process list through `qemu-guest-agent` (the template already requires it) and periodic screenshots through the Proxmox API, stored on the sample. The pcap is deferred (decision below). It can only be tested against mock mode: real validation needs the owner's Proxmox. | M–L |

### Decisions made (2026-11-12)

1. **Passive DNS (3.3):** starts with VirusTotal resolutions, with the key that already exists.
2. **Sandbox pcap (3.7):** deferred. The sandbox VM sits behind a Mikrotik CHR, which does the
   logical isolation; the capture may come from it, to be designed later. Processes and
   screenshots go in.
3. **Push to MISP (3.6):** deferred, no code.
4. **Section 2 fixes:** committed before phase 0.

## 6. Findings along the way (depend on the owner)

- **The visual suite has no reference screenshots.** Commit `7f4bb5d` (Nov 10, "remove obsolete UI
  screenshots") deleted the 14 PNGs in `scripts/ui-visual/__screenshots__`, which are the
  comparison baselines. Without them, `sh scripts/ui-visual/run.sh` fails all 14 tests (the first
  run writes the screenshots and fails), and the CI *Suíte visual* job would fail. They were not
  recreated here because the removal was a recent choice: if it was a mistake,
  `cd apps/web && npm run build && cd ../.. && sh scripts/ui-visual/run.sh --update-snapshots` and
  committing the PNGs is enough (the sample record already comes out with the risk score
  section); if it was deliberate, the CI job and the `scripts/ui-visual` folder can go together.
