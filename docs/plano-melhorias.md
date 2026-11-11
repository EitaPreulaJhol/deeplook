# 🧱 Technical improvement plan

> 🇧🇷 [Leia em português](plano-melhorias.pt-BR.md)

A survey made after the [UX backlog](ux-backlog.md) reached its end (251 items)
and the four Strix rounds closed the security holes. What is left is not screen
functionality: it is **robustness, automation and operation**.

**Legend** — Priority: 🔴 high · 🟡 medium · ⚪ low. Effort: **P** (hours),
**M** (1–2 days), **G** (several days). Status: ✅ done · ⬜ pending · ⏸ deferred (recorded, not started) · 🚫 out of scope.

## Summary

| # | Item | Priority | Effort | Area | Status |
|---|---|---|---|---|---|
| 1.1 | Global ErrorBoundary in the frontend | 🔴 | P | Web | ✅ |
| 1.2 | Real *readiness* health check | 🔴 | P–M | API / Compose | ✅ |
| 1.3 | Structured logger in the background jobs | 🟡 | P | API | ✅ |
| 2.1 | CI (GitHub Actions): lint, typecheck, build, tests | 🔴 | M | Repository | ✅ |
| 2.2 | Frontend unit tests (Vitest) | 🟡 | M | Web | ✅ |
| 2.3 | Dependency updates and `npm audit` in CI | 🟡 | P | Repository | ✅ |
| 2.4 | Cleanup: empty `infra/nginx/` | ⚪ | P | Repository | ✅ |
| 3.1 | Prometheus metrics (`/metrics`) | ⚪ | M | API | ⬜ |
| 3.2 | Machine-readable system status | ⚪ | P | API | ✅ |
| 4.1 | Fine-tune the nginx headers | 🟡 | P | Web | ✅ |
| 4.2 | Integrity check (SHA-256) on download and in the background | ⚪ | P–M | API | ✅ |
| 5.1 | Email notifications (SMTP) | — | G | API | 🚫 |
| 5.2 | Outbound webhooks | — | M–G | API | 🚫 |
| 5.3 | Indicator feed: TAXII 2.1 and MISP feed | ⚪ | M | API / Web | ✅ |
| 6.1 | Small fixes: API `.dockerignore`, `@types/node`, Node 22 leftover | 🟡 | P | API | ✅ |
| 6.2 | Playwright version in lockstep (CI + Dependabot) | 🟡 | P | Repository | ✅ |
| 6.3 | Dependabot ignores the `node` major (Current, not LTS) | ⚪ | P | Repository | ✅ |
| 6.4 | Weekly CVE scan of the images (Trivy) | 🔴 | P–M | Repository | ✅ |
| 6.5 | `web` without root and hardened compose | 🟡 | P–M | Web / Compose | ✅ |
| 6.6 | Docker log rotation | 🟡 | P | Compose | ✅ |
| 6.7 | nginx: asset cache, asset 404 and COOP/CORP | 🟡 | P | Web | ✅ |
| 6.8 | CI runs `test:images` and `test:smoke` | 🔴 | P | Repository | ✅ |
| 6.9 | Vitest: `client.ts`, `cases.ts`, list hook, ErrorBoundary, coverage | 🟡 | M | Web | ✅ |
| 6.10 | Frontend: code splitting (routes and noVNC) and Carbon CSS | 🟡 | M | Web | ✅ |
| 6.11 | API dependencies: majors of `postal-mime`, multipart, rate-limit and bcryptjs | 🟡 | M | API | ✅ |
| 6.12 | Web dependencies: React 19, Vite 8, TypeScript 7 | ⚪ | M–G | Web | ✅ (React and Vite; TypeScript 7 is blocked) |
| 6.13 | Backup folder outside the disk (`BACKUP_DIR`) and scheduled backup | 🔴 | M | API / Web / Operation | ✅ |
| 6.14 | Visual suite (Playwright) in CI | 🟡 | M | Repository | ✅ |
| 6.15 | API boundaries: trusted network, session by hash, CSRF and `.env` | 🔴 | M | API / Compose | ✅ |
| 6.16 | Chromium sandbox for the capture (own seccomp profile) | 🔴 | M | Capture / Compose | ✅ |
| 6.17 | Read-only capture and one container per capture | 🟡 | P–M | Capture / API / Compose | ✅ |
| 6.18 | Verification battery: capture retry, sample download and test ports | 🟡 | P | API / Tests | ✅ |
| 6.19 | Capture network without direct egress (outbound proxy in its own container) | 🔴 | M | Capture / Compose | ✅ |
| 6.20 | Minimal capabilities in `db`, `minio` and `clamav`; forbidden ports in `egress` | 🟡 | P–M | Compose / Capture | ✅ |
| 6.21 | Scheduled backup alert in the status and machine file permissions | 🔴 | P | API / Web / Operation | ✅ |
| 6.22 | API with read-only root, `/tmp` on disk and process limit; deployment checklist | 🟡 | P–M | API / Compose / Operation | ✅ |
| 7.1 | PE static analysis: imphash, Rich header, exports, resources, overlay, signature, .NET and anomalies | 🟡 | M–G | API / Web | ✅ |
| 7.2 | capa and FLOSS in an isolated container (capabilities per function, with ATT&CK, and obfuscated strings) | 🟡 | M | API / Compose / Web | ✅ |
| 7.3 | Ghidra headless on demand (functions, references to suspicious imports, pseudo-C) | 🟡 | G | API / Compose / Web | ✅ |
| 7.4 | Triage rules with the signals from 7.1 and 7.2 | 🔴 | P | API / Web | ✅ |
| 7.5 | Explainable risk score (suggests the verdict) | 🟡 | P–M | API / Web | ⬜ |
| 7.6 | Related: same certificate and same behavior (capa capabilities) | 🟡 | P | API / Web | ⬜ |
| 7.7 | Retro-hunt with capa when the rules are updated | ⚪ | P | API | ⬜ |
| 7.8 | Unpack and extract (UPX, NSIS/Inno, PyInstaller) into child samples | 🔴 | M | API / Compose / Web | ✅ |
| 7.9 | Detect It Easy: compiler, packer, installer and obfuscator | 🟡 | P–M | API / Compose | ✅ |
| 7.10 | Decompile .NET (ilspycmd) | 🟡 | M | API / Compose / Web | ⬜ |
| 7.11 | Configuration extraction from known families (maco/CAPE extractors) | 🟡 | M–G | API / Compose | ⬜ |
| 7.12 | Emulation with Speakeasy (API sequence without a VM) | ⚪ | M | API / Compose | ⬜ |
| 7.13 | APK, JAR and Mach-O | ⚪ | M | API | ⬜ |
| 7.14 | Deeper Office and PDF (oletools, XLM 4.0) | ⚪ | P–M | API / Compose | ⬜ |
| 7.15 | Suggest a YARA rule from the sample | ⚪ | M | API / Web | ⬜ |
| 8.1 | Analysis and capture queues: a database outage no longer brings the API down | 🔴 | P | API | ✅ |
| 8.2 | Unpacking that fails halfway no longer duplicates the children | 🟡 | P | API | ✅ |
| 8.3 | `unpack` service ceilings aligned with what the API accepts | 🟡 | P | Unpack | ✅ |
| 8.4 | Default database and MinIO password refused in production | 🟡 | P | API / Operation | ✅ |
| 8.5 | Integration test types in CI (closes Finding J) | 🟡 | P | API / Repository | ✅ |
| 8.6 | Postgres and ClamAV pinned by digest, with an update script | ⚪ | P | Compose / Repository | ✅ |
| 8.7 | Sample creation outside `routes/entries.ts` | ⚪ | P | API | ✅ |
| 8.8 | Commit message: short subject, the rest in the body | ⚪ | P | Repository | ✅ (from now on) |
| 8.9 | Repository on a private remote (turns on CI, Dependabot and Trivy) | 🔴 | P | Repository | ⬜ (depends on the owner) |

Items **5.1** and **5.2** were left **out of scope** by decision of the project owner;
they stay recorded for when they come back to the table.

**Agreed execution order:** 1.1 → 1.2 → 2.1 → 1.3 → 2.3 → 2.4 → then the rest.

**First batch delivered** (1.1, 1.2, 1.3, 2.1, 2.3 and 2.4): each item below carries an
**Implemented** block with what changed and what was left out. Two findings showed up along the way
and are at the end, in [Findings along the way](#findings-along-the-way).

Batch validation: `format:check`, `lint` and `build` clean in the API and the web, and **917 checks
in 29 files** of integration, all green.

**Third batch delivered** (3.2, 4.2 and 6.1 to 6.12; 6.13, backup outside the disk, was left out and
is **deferred by the owner**, recorded without code). Five new findings are in [Findings along the way](#findings-along-the-way) (D to H).
Validation: `format:check`, `lint` and `build` clean in the API and the web; **1014 checks in 33
files** of integration (they were 917 in 29); **113 web unit tests** in 11 files (they were
55 in 5), with 95.7% coverage; `test:images` with 45 checks and `test:smoke` with 100; the **91
screen scenarios**; `npm audit --audit-level=high` and Trivy (six images and the Dockerfiles) at
zero; `actionlint` on the workflows. Main web bundle: from 1,076 kB (383 kB on the wire) to
268 kB (82 kB).

---

## ⏸ Where we stopped

Five batches. The **first** (1.1, 1.2, 1.3, 2.1, 2.3, 2.4), the **second** (2.2 Vitest,
4.1 nginx headers and Node 26 LTS), the **third** (3.2, 4.2 and 6.1 to 6.22: hardening,
CI, performance, dependencies, backup and the API boundaries, which closed vuln-0008), the
**fourth** (static analysis: 7.1 to 7.4, 7.8 and 7.9 delivered; 7.5 to 7.7 and 7.10 to 7.15 recorded)
and the **fifth** (8.1 to 8.8: the November review, fixes and tidying). What is missing is below,
in the suggested order.

| Next | Item | Why in this order | Effort |
|---|---|---|---|
| 1st | [8.9 Private remote](#89-repository-on-a-private-remote) | Without it CI, Dependabot and the weekly Trivy do not run, and the code only exists on this disk | **P** |
| 2nd | [7.11 Configuration extraction](#711-configuration-extraction-from-known-families) | Biggest IOC gain; DIE (7.9) already shows which families and tools appear | **M–G** |
| 3rd | [3.1 Prometheus metrics](#31-prometheus-metrics) | Worth it with Grafana; the status by token (3.2) already covers the basics | **M** |
| — | TypeScript 7 (leftover from [6.12](#612-web-dependencies-majors)) | Blocked: `typescript-eslint` only accepts `<6.1.0`; review when it accepts | **P** |

**6.13 left the deferral** at the owner's request, in his design: a folder in `.env`, and taking it
off the disk is up to whoever configures the environment. Then came the **scheduled backup**, with his
decisions: password in `.env`, ZIP with the samples and the days chosen in a calendar on the
Backup tab.

### To resume

```bash
# the Detect It Easy identification (7.9) left everything green; confirm before touching anything
cd apps/api && npm run format:check && npm run lint && npm run build
cd ../web   && npm run format:check && npm run lint && npm run build && npm run test:coverage
cd ../api   && npm run test:integration          # 1478 checks in 41 files (brings up the real capa, Ghidra and unpack)
cd ../api   && npm run test:images && npm run test:smoke   # 102 and 101 checks
cd ../api   && npm run typecheck:tests            # test types (item 8.5)
cd ../capture && npm test                         # 13 proxy tests (without network)
# when changing Playwright: node scripts/chromium-unsafe-ports.mjs (egress port list)
cd ../..    && node scripts/check-playwright-version.mjs && node scripts/check-carbon-css.mjs \
            && node scripts/seccomp-chromium.mjs --check
node scripts/pin-images.mjs                       # are Postgres and ClamAV still on the digest? (8.6)
# the repository has no remote: the CI steps only run if someone runs them here
```

### Known pitfalls (they cost time in the first batch)

- **`prisma generate` before lint/build in the API.** `apps/api/src/generated/` is in
  `.gitignore`; without it, ESLint and `tsc` cannot find the types.
- **Line endings.** The repository has about 144 CRLF files, because the project is
  developed on Windows. `.prettierrc.json` uses `endOfLine: "auto"` because of that —
  **do not switch to `lf`** unless you want a 144-file diff.
- **`format:check` only covers `apps/api` and `apps/web`.** `README.md` and the `.md` files in `docs/`
  never went through Prettier: it is correct that they report a deviation if you run it at the root.
- **Node 26 LTS** in CI and in the images (`apps/api/Dockerfile` and `apps/web/Dockerfile`), the
  same as the development machine. Careful: the `npm` 11 that comes with it **does not run a dependency
  install script** without approval — in `npm ci` it is only a warning, and the build does not depend
  on it (Finding C, at the end).
- **The integration tests only need Docker** and bring up what they use. `-- <filter>` runs a single
  file; `--clean` tears down the containers at the end.
- **The web Vitest (`npm run test:unit`) brings up nothing.** It is pure logic, `environment: 'node'`,
  and the `*.test.ts` are type-checked by `build` (the `tsconfig` includes `src`): a type error in the
  test fails CI even without running Vitest.
- **Vitest with DOM.** The `*.test.tsx` declare `// @vitest-environment jsdom` at the top; without
  globals, each one calls `cleanup()` and, when the `ErrorBoundary` catches an error on purpose,
  cancels the window `error` event (otherwise jsdom prints the stack of each one).
- **Do not cut the `test:images` output with `head`.** SIGPIPE kills the test halfway and leaves the
  `dl-test-capt-net` network orphaned: the next round dies with "network already exists".
- **`images.mjs` and `smoke.mjs` read the `web` service from compose** (`tests/compose-service.mjs`):
  if the service hardening in `docker-compose.yml` changes, the test already exercises it. The smoke
  browser accesses through `localhost` (sharing the network of the `web` container) because
  Cross-Origin-Opener-Policy only applies to a trusted origin.
- **The screen test mock is part of the contract.** A new field in a web table requires the data in
  `scripts/ui-playwright/mock-api.mjs` and the scenario column indexes (it was `api-tokens`).
- **The final images do not have `npm`.** `docker compose exec api npm ...` no longer exists; use
  `node`. The `prisma` of the entrypoint runs through `node_modules/.bin/prisma`.
- **`add_header` in a `location` discards the server ones; `expires` does not.** That is why the asset
  cache uses `expires` (item 6.7). Whoever needs an `add_header` in a `location` has to repeat them
  there, and `images.mjs` checks the headers on `/`, on an asset and on an error.
- **Trivy exceptions have a justification and a validity.** `trivy.yaml` (per file or folder) and
  `.trivyignore` (per CVE, with `exp:`). Review the `gosu` one when the Postgres version changes.
- **The Sass `if()` warnings in the build** come from Carbon itself, not from the project.
- **Carbon CSS is selective (item 6.10).** Used a new `@carbon/react` component? Add the
  module in `apps/web/src/styles/app.scss` and run `node scripts/check-carbon-css.mjs`; CI
  fails if you forget (a component without style breaks no test, only the screen). Carbon components
  must be under `<Theme theme="g10">`; and the theme emission (`_carbon-theme.scss`) comes
  **before** `tokens`/`auth`/`hpsm`, because the skin overrides the same tokens with the same
  specificity.
- **The visual suite runs as your user** (`docker run --user $(id -u):$(id -g)`). Without that the
  container writes `node_modules`, `test-results` and new baselines as root, and the next round
  on the host cannot even overwrite them. And the arguments go through `"$@"`, not interpolated in
  `sh -c`: an interpolated `--grep 'histórico global'` becomes two arguments and Playwright answers
  "No tests found".

---

## 1. Fixes and robustness

### 1.1 Global ErrorBoundary in the frontend
- **Problem:** there is no `ErrorBoundary` in `apps/web/src`. An exception during
  render brings down the whole React tree and the user is left with a **blank screen**, without a
  message or a way out. In a tool that opens several document tabs at the same time,
  losing the work session because of an unexpected sample field is expensive.
- **Proposal:** a class component `ErrorBoundary` in
  `apps/web/src/components/ErrorBoundary.tsx`, in the HPSM style (error message bar,
  no modernizing), with the error text, **Reload** and **Back to the start**. It wraps
  `<App />` in `main.tsx`, inside the providers, so the back button uses the
  router. A second, more internal boundary, per document tab, prevents the error of one
  tab from bringing down the others.
- **Where to change:** `apps/web/src/components/ErrorBoundary.tsx` (new),
  `apps/web/src/main.tsx`, `apps/web/src/styles/hpsm.scss`.

**Implemented.** `ErrorBoundary` is a class component (only the class has
`getDerivedStateFromError`), in two places:

- `variant="app"` in `main.tsx`, **outside** `AuthProvider` and `ConfirmProvider`: it catches
  even the failure that happens before a session exists;
- `variant="page"` in `AppShell`, around the content, with `key={pathname}`: the top, the
  navigator and the tabs stay up, and changing screen clears the warning by itself.

The panel deliberately does not use a router hook or a Carbon component — an error notice
that depends on what just broke does not show up. The buttons are `<button>` with the
`cds--btn` classes, only to come out looking like HPSM; "Back to the start" uses
`window.location`. The red circle is the same one from the message bar, to avoid inventing a visual
language. It brings a collapsed "Technical details" with the stack, to paste into a report.

`componentDidCatch` writes to the console: it is the only unexpected error that `test:smoke`
should catch, and it is exactly when the screen really broke.

### 1.2 Real *readiness* health check
- **Problem:** `GET /api/health` answers `{ status: 'ok' }` **without querying anything**
  (`apps/api/src/index.ts`). `docker-compose.yml` uses exactly that route as the
  `healthcheck` of the `api` service, so the container appears `healthy` even with
  Postgres or MinIO down — and the `depends_on: condition: service_healthy` of `web`
  releases traffic to an API that cannot answer anything useful.
- **Proposal:** separate the two roles, as the pattern requires:
  - `GET /api/health` stays as **liveness** (the process is up), without touching any
    dependency;
  - `GET /api/health/ready` is the **readiness**: `SELECT 1` on Postgres and `HeadBucket` on
    MinIO, each with a short timeout (2 s), returning `200` with the detail of each
    dependency or `503` with which one failed. Without authentication, because Docker queries before
    a session exists, and without leaking an address or credential — only the dependency name and
    `ok`/`error`.
  - the compose `healthcheck` starts pointing to the readiness.
- **Careful:** the 120 s `start_period` has to stay large, because the migrations and the
  seed run on boot.
- **Where to change:** `apps/api/src/routes/health.ts` (new), `apps/api/src/index.ts`,
  `docker-compose.yml`.

**Implemented.** `apps/api/src/routes/health.ts` with the two routes, and the inline route in
`index.ts` is gone. The compose `healthcheck` points to the readiness; the 120 s `start_period`
stays, because the migrations and the seed run on boot.

Decisions that depart from the original plan:

- **The response does not say the reason for the failure.** The route is public (Docker queries before
  a session exists) and the driver message carries an address and, sometimes, the database user. The
  response carries only `{ name, ok }` per dependency; the reason goes to the API log, and the
  full detail stays in Administration > Status. A test guarantees that address,
  port and credential do not appear in the body.
- **1 s cache.** The route is public and queries the database and MinIO: without that, a flood of
  probes becomes a flood of queries. The compose `interval: 15s` does not even notice.
- `apps/api/tests/images.mjs` and `apps/api/tests/smoke.mjs` started probing the readiness,
  since both bring up real Postgres and MinIO — the images one even calls the
  "compose healthcheck" check, so it has to be the same route.

**Covered by** `apps/api/tests/integration/health.test.ts` (11 checks): liveness,
readiness with everything up, the 503 with MinIO down (database `ok`, storage not), the reason
absent from the response and two probes in a row.

### 1.3 Structured logger in the background jobs
- **Problem:** 25 `console.log`/`warn`/`error` calls in `seed.ts`, `env.ts`,
  `lib/s3.ts`, `lib/sandbox.ts`, `lib/ldap.ts`, `lib/retention.ts`, `lib/backup.ts` and
  `lib/lookalike.ts`. The rest of the API uses Fastify's Pino, with its own serializer
  (`lib/request-log.ts`) that strips the query string from the paths. Those loose lines come out in
  plain text, outside the JSON, and a log aggregator does not correlate them.
- **Proposal:** pass the `FastifyBaseLogger` to whoever is already called after boot
  (`ensureBucket`, sandbox reaper, retention, backup, lookalike) and keep `console` only
  where the logger does not exist yet: `env.ts` (validation before the app starts) and `seed.ts`
  (separate script, run by `npm run seed`).
- **Where to change:** the files cited in `apps/api/src/lib/` and `apps/api/src/index.ts`.

**Implemented** with `apps/api/src/lib/log.ts`: a module logger, registered once on
boot (`setLogger(app.log)`), with the Pino signature (`log.warn('text')` or
`log.warn({ err }, 'text')`). Passing the logger as a parameter would require changing the signature of
functions that nobody else calls with it (`purgeExpiredFiles`, `reapExpired`,
`scanLookalikesQuietly`); the module solves it without spreading the parameter.

Without a logger — `npm run seed`, a script, an integration test — the message falls back to the console,
so it is not lost. `resetLogger()` exists so the test does not leak a logger between files.

Swapped in `lib/s3.ts` (4), `lib/sandbox.ts` (6), `lib/retention.ts`, `lib/backup.ts`,
`lib/ldap.ts` and `lib/lookalike.ts`. **They stay on the console, on purpose:** `env.ts` (runs
before the app exists), `seed.ts` (separate script) and the final `catch` of `index.ts` (there
Fastify may not even have come into existence) — the last one now with a comment saying so.

---

## 2. Automation and quality

### 2.1 CI (GitHub Actions)
- **Problem:** there is no `.github/workflows`. There are 28 very good integration test files
  (`apps/api/tests/integration`), which bring up real Postgres, MinIO and OpenLDAP, but only run
  when someone remembers to run them by hand.
- **Proposal:** a workflow with two jobs:
  - **`lint`** — `npm ci`, `npm run lint` and `npm run build` (which already runs `tsc` with
    `noUnusedLocals`) in the three apps, in parallel by matrix;
  - **`integration`** — `npm run test:integration` in the API. The GitHub runner has Docker,
    which is everything `tests/run.mjs` needs; `--clean` tears down the containers at the end.
  - Triggers on `push` to `main` and on `pull_request`. `~/.npm` cache keyed by the
    lockfile.
- **Where to change:** `.github/workflows/ci.yml` (new).

**Implemented** in `.github/workflows/ci.yml`, with four jobs: `check` (matrix of `api` and
`web`: `format:check`, `lint` and `build`), `capture` (outbound proxy tests),
`integration` (the API suite) and `audit` (item 2.3). Triggers on `push` to `main`, on
`pull_request` and from the Actions tab; a new push cancels the previous run of the same branch.

Details that were hard to get right:

- **`prisma generate` before everything, in the API.** `apps/api/src/generated/` is in
  `.gitignore`: without the step, neither ESLint nor `tsc` find the types.
- **`npm ci --ignore-scripts` in capture.** The proxy test does not open a browser, and it is not worth
  downloading the ~400 MB of Playwright's Chromium.
- **Node 22** at the time, the same version as the images (later the batch of item 2.2 raised both
  ends, images and CI, to the Node 26 LTS of the development machine).
- **`--clean`** in the integration tests, to tear down Postgres, MinIO and OpenLDAP at the end.

All steps were run locally before trusting the file, and the two YAMLs were
checked in a real parser.

### 2.2 Frontend unit tests
- **Problem:** the frontend only has visual verification with Playwright (`scripts/ui-playwright`)
  and the browser smoke. There is no unit test: the web `package.json` has neither Vitest nor
  Testing Library. Pure logic full of edge cases stays uncovered —
  `components/decoder.ts`, `notifications.ts`, `sha256.ts`, `textDiff.ts`, `iocs.ts`,
  `cases.ts`, `useEntryListState.ts`.
- **Proposal:** Vitest with `environment: 'node'` for the pure modules (cheap, no DOM) and
  `@testing-library/react` only where the component has real logic. Start with the
  decoders and the diff, which have the densest rules, and wire it into the CI `lint` job.
- **Where to change:** `apps/web/package.json`, `apps/web/vitest.config.ts` (new),
  `apps/web/src/**/*.test.ts` (new).

**Survey already done** (so as not to redo it):

| Module | Lines | Why it is worth it |
|---|---|---|
| `src/components/decoder.ts` | 225 | Base64, hex, URL, ROT13: the densest rules |
| `src/components/notifications.ts` | 151 | Labels and groups the notice by type |
| `src/components/iocs.ts` | 69 | Builds the indicator key (pair of the API's `lib/ioc-normalize.ts`) |
| `src/components/sha256.ts` | 66 | Hash in the browser, with buffer edge cases |
| `src/components/textDiff.ts` | 66 | Diff of the report revisions |

How to wire it into CI: the `check` job of `.github/workflows/ci.yml` already runs `lint` and `build` on the
`api`/`web` matrix; just a `npm run test:unit` step with `if: matrix.app == 'web'`, in the
same mold as the `prisma:generate` step, which already uses `if: matrix.app == 'api'`.

**Implemented.** `apps/web/vitest.config.ts` with `environment: 'node'` (pure logic, no DOM)
and `include: ['src/**/*.test.ts']`; it does `mergeConfig` with `vite.config.ts` only to inherit
the React plugin and the `~` alias, because `notifications.ts` pulls in `tags.tsx` (JSX). **Without
globals:** each test imports `describe/it/expect` from `vitest`, so neither ESLint nor the
`tsconfig` had to change. Two new scripts in `package.json` (`test:unit` = `vitest run`,
`test:watch` = `vitest`) and the "Unit tests (Vitest)" step with `if: matrix.app == 'web'` in the
`check` job.

The five modules from the survey became **55 checks**: `decoder.test.ts` (each step, the
chaining, the 1 MB ceiling, the error index and a gzip round trip through the Web Streams),
`textDiff.test.ts` (insertion, deletion, replacement and CRLF equal to LF), `sha256.test.ts` (the vectors of
FIPS 180-4 and the cross-check with Web Crypto at the padding edges and across several blocks),
`iocs.test.ts` (type, label, the URL SHA-256 key and the recognition) and `notifications.test.ts`
(phrase, quote, target and destination, with `actor` null falling back to "The system"). They run in ~300 ms.

A detail worth remembering: the web `build` is `tsc --noEmit && vite build` and the `tsconfig`
includes `src`, so the `*.test.ts` are **type-checked in the build** — a type error in the test already
fails it, even before Vitest. The tests do not enter the bundle, because `vite build` only
bundles what `index.html` reaches.

### 2.3 Dependency updates and `npm audit`
- **Problem:** the switch from MinIO to `pgsty/silo` (CVE-2026-40344 and CVE-2026-41145) was
  reactive, made during a Strix round. Nothing warns about the next one.
- **Proposal:** weekly Dependabot for the three `package.json` and for the images of the
  `docker-compose.yml`/Dockerfiles, grouping patches, plus a
  `npm audit --audit-level=high` step in CI that fails on a high vulnerability.
- **Where to change:** `.github/dependabot.yml` (new), `.github/workflows/ci.yml`.

**Implemented.** `.github/dependabot.yml` covers the three `package.json` (weekly, with
`minor` and `patch` grouped into a single PR), the base images of the three Dockerfiles and the actions of the
CI itself (monthly). The Prisma major stays out of the automatic one, because client, adapter
and CLI go up together or the build breaks.

The `audit` job runs `npm audit --audit-level=high` in the three apps. **It passes today:** there are 27
moderate vulnerabilities, all in the ESLint chain (through `minimatch`), none in a
runtime dependency and none high or critical.

### 2.4 Cleanup: empty `infra/nginx/`
- **Problem:** `infra/nginx/` exists and is empty; the real nginx configuration lives in
  `apps/web/nginx.conf`, copied by `apps/web/Dockerfile`. Whoever looks for the configuration
  wastes time in the wrong place.
- **Proposal:** remove the folder and check whether the README points to it.
- **Where to change:** `infra/`, `README.md`.

**Implemented.** The folder was not even versioned (`git ls-files infra` returned nothing): it was a
local leftover, and it disappears without a diff. On top of that, the README "Project structure" tree
was outdated and started showing `apps/capture/`, `apps/api/rules/`,
`apps/api/tests/`, `icons/`, `.github/` and `data/clamav/`, with a note that
`apps/web/nginx.conf` is the real configuration.

---

## 3. Observability and operation

### 3.1 Prometheus metrics
- **Proposal:** `GET /metrics` in the Prometheus text format, protected by a token or pinned
  to the internal network, with: samples submitted, antivirus and YARA scans (result and
  duration), queue sizes, route latency and the numbers `lib/status.ts` already
  computes. In a homelab with Grafana, it is what is missing to have a chart without opening the admin
  screen.
- **Careful:** no label with a hash, URL or username — it becomes infinite cardinality
  and leaks an indicator into the dashboard.
- **Starting point:** `systemStatus()` (`lib/status.ts:537`) already gathers almost everything; what is missing is a
  counter and a histogram per route, which Fastify provides with an `onResponse` hook.

### 3.2 Machine-readable system status
- **Problem:** `lib/status.ts` already checks API, database, MinIO, ClamAV, LDAP, Proxmox,
  reputation and queues, but the result only appears in Administration > Status.
- **Proposal:** expose the same object as JSON on an admin route, so that an external monitor
  (Uptime Kuma, Zabbix) reads it without scraping HTML.
- **Starting point:** `GET /api/admin/status` (`routes/admin.ts:133`) already returns the
  `systemStatus()` to the screen — in practice the item is letting an admin **API token** reach that
  route, instead of only the browser session. Today a token does not reach
  administration (403), so it is worth deciding between opening a read exception or creating a
  route of its own.
- **Do not confuse it with 1.2:** the readiness is public and only says `ok`/`not`; this one is
  authenticated and carries the detail (addresses, versions, latencies).
- **Decided** (the item goes into the third batch): **a read-only route of its own**, with a
  `status:read` scope token, and not an exception that opens `/api/admin` to tokens. Only an
  admin creates that token, and it does not reach any other route.

**Implemented.** The token gained a **scope** (`ApiTokenScope`: `SAMPLES` and `STATUS`, migration
`20261220000000_api_token_scope`; the tokens that already existed become `SAMPLES`). In
`lib/api-tokens.ts`, `ALLOWED_ROUTES` remains only the list of the samples (the one the
OpenAPI specification mirrors) and `STATUS_ROUTES` is the monitor's; `scopesFor(route)` joins the two.
Details that matter:

- The scope check comes **after** proving the token is valid: whoever gets the token wrong receives
  401 and does not discover the scopes. The status token requires that the owner **is still ADMIN** on every
  use (demoted, it stops working immediately).
- `GET /api/status` (`routes/status.ts`) returns the `systemStatus()` to an admin session or
  to a status token. `?strict=1` responds **503** when the overall situation is `error`, for a
  monitor that only looks at the HTTP code. The response goes out with `Cache-Control: no-store`, and the server
  keeps the result for **10 s** (one check at a time, and a failure is not cached): an insistent monitor
  does not become a flood of queries to the database, MinIO, ClamAV and LDAP.
- Only an **admin creates** that token (403 for the others, and the "API access" rule still applies); the
  audit of the creation says the scope; the tokens screen gained the column and the *Purpose* selector
  (this one only appears for admins). The API Tokens tab of Administration also shows the scope.
- It was deliberately **left out** of the OpenAPI specification: that one belongs to whoever integrates samples.

**Covered by** `status-token.test.ts` (33 checks): who creates it; what each scope reaches in
both directions; without a credential, unknown, expired and revoked token; owner demoted and
promoted again; cache; `?strict=1` with MinIO down (503) and back (200). **Proof of teeth:**
with the two locks removed, a status token started reading samples and the test failed in the
four cases. On the web, the `api-tokens` scenario covers the selector and the `scope` in the POST.

---

## 4. Security

### 4.1 Fine-tune the nginx headers
- **State:** `apps/web/nginx.conf` already sends `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Strict-Transport-Security` and a closed CSP (`object-src 'none'`,
  `base-uri 'self'`, no `unsafe-inline` in script).
- **Missing:** `Permissions-Policy` (turn off camera, microphone, geolocation and
  payment, which the app does not use), `server_tokens off` (the nginx version appears in the
  `Server` header and in the body of the error pages) and `includeSubDomains` in HSTS.
- **Careful:** `preload` in HSTS, no — it is a hard-to-undo commitment and the domain is
  a homelab one.
- **Where to change:** `apps/web/nginx.conf`, right below the "Security headers
  (item 115)" block — the four `add_header`s are already together there.
- **Remember:** each new `add_header` needs the `always`, like today's, otherwise it does not come out
  in the error responses. And `add_header` in a `location` **replaces** the server ones: if
  any block gets its own `add_header`, the ones above disappear from there.

**Implemented** in `apps/web/nginx.conf`, in the "Security headers" block: `server_tokens
off;` (takes the nginx version out of the `Server` header and the error pages), the `Permissions-Policy`
turning off camera, microphone, geolocation and payment, and `includeSubDomains` in HSTS —
**without `preload`**, on purpose. All with `always`. Checked that no `location`
(`/api/sandbox`, `/api/`, `/`) has its own `add_header`, so the server ones apply to all
responses; if any gets one in the future, these need to be repeated there.

### 4.2 Integrity check on download
- **Proposal:** when serving a sample's file (and when restoring a backup), recompute the
  SHA-256 and compare it with what is recorded in the sample row, recording a divergence in
  the Audit log. It catches silent storage corruption and tampering with the bucket from outside the
  API.
- **Careful:** it only works with streaming and for a file below a ceiling, otherwise a download of
  200 MB pays for the hash twice.
- **Where to change:** `GET /api/entries/:id/download` (`routes/entries.ts:1566`) and the
  restore path in `lib/backup.ts`.
- **Decided** (the item goes into the third batch): the download is *streaming*, so the hash only
  closes after the bytes leave — "refusing on divergence" would require reading twice and would take away
  from the analyst the only remaining copy. The design: **compute during the stream** (with no size
  ceiling: it costs CPU, not reads), **deliver**, and on divergence **record it in the Audit log and
  flag the sample**, so the card warns and the next downloads go out with an alert header. A download
  aborted halfway has no verdict and flags nothing. A **periodic "scrub" job** re-reads the samples and checks
  the SHA-256 in the background, in the mold of the retention and backup jobs, and catches corruption
  without weighing on the download.

**Implemented.** `lib/integrity.ts` and `lib/integrity-scrub.ts`; columns `integrityCheckedAt` and
`integrityFailedAt` in `Entry` and two audit actions (migration `20261219000000_entry_integrity`).

- **Download:** a `Transform` computes the SHA-256 and the size while the bytes pass
  (`stream.pipeline`, which also closes the MinIO read if the client gives up). The `flush` only
  runs if the stream finished **entirely**: an aborted download has no verdict and flags nothing. The end
  of the stream waits for the record, so whoever received the last byte already finds the result written. The
  `Content-Length` became the one of the **object** (and not the card's): if they diverge, the body follows
  well formed and the divergence shows up in the check. Without a recorded hash, there is nothing to compare.
- **Divergence:** delivers the file anyway, flags the sample, audits
  (`ENTRY_INTEGRITY_FAILED`, with both hashes and the size) and the card shows a red warning
  and the **Integrity** field; the next downloads go out with `X-DeepLook-Integrity: mismatch`.
- **Atomic transitions:** the flag is a conditional `UPDATE` (`integrityFailedAt IS NULL`), so
  two checks at the same time do not audit twice, and checking the same damaged file again only
  renews the read date. Checking again successfully, the flag is removed and the audit records
  `ENTRY_INTEGRITY_RESTORED`.
- **Scrub** (`INTEGRITY_SCRUB_INTERVAL_MINUTES`, default 60, `0` turns it off; `INTEGRITY_SCRUB_MAX_MB`,
  default 512 per round): never checked first, then those checked longest ago. The
  budget blocks the **next** one, never the first (a file larger than it is still checked,
  on its own). A **missing** object (404) is also flagged; a read failure flags no one and the round
  gives up after three in a row. Purged, in the trash, without a hash and links are left out.
- **Status:** the *File integrity* check turns **orange** (and not red: it asks for
  attention, but the service stays up) and, through it, the divergence reaches the monitor of 3.2.

**Covered by** `integrity.test.ts` and `integrity-scrub.test.ts` (28 each): the full cycle with a
real upload, divergence delivered and flagged, no audit spam, truncated, recovery, without a
hash, **aborted download**, missing, budget, order, MinIO down and concurrent rounds.
**Proof of teeth:** with `judge` always approving, 9 checks failed.

---

## 5. Features

### 5.1 Email notifications (SMTP) — 🚫 out of scope
It was the only item in the README Roadmap (and item 79 of the UX backlog, deferred for lack of
SMTP). It stays recorded: the Notifications tab of My Account already has the preference structure
per notice type that the email sending would use.

### 5.2 Outbound webhooks — 🚫 out of scope
Notifying a chat channel or a SIEM when a sample receives a malicious verdict or when a
watched indicator fires.

### 5.3 Export indicators in MISP/TAXII
- **Problem (as it was recorded):** the import reads CSV and STIX, and the way back was missing
  for whoever uses MISP.
- **What already existed:** when resumed, the **file** export was already done, with a MISP event
  (`.misp.json`) and a STIX 2.1 bundle (`.stix.json`) on the sample card and on the case (items 74 and
  165). What was missing was the other end fetching by itself.
- **Owner's decision:** both continuous integration paths, TAXII 2.1 and MISP feed, only with
  indicators of **malicious or suspicious** samples, without the allowlist.

**Implemented:**
- **Set** (`lib/indicator-feed.ts`): malicious and suspicious samples outside the trash, with
  the indicators of the published reports and of the sample itself (the same `entriesIocs` as the case).
  - The allowlist is left out, and so are the **company domains** (`CompanyDomain`,
    with their subdomains, emails and URLs): without that, the company's own domain would go out as a
    threat to a SIEM.
  - Each indicator carries the worst verdict among the samples **that enter**, the first sighting and
    the last change (of the sample or of a published report of it). With a 60 s cache.
- **TAXII 2.1** (`routes/feeds.ts`), read-only:
  - discovery, API root and one collection;
  - objects with `added_after`, `limit` (up to 1000), `next` (cursor by date and id),
    `match[type]`, `match[id]`, `match[version]` and `match[spec_version]`;
  - object, versions and manifest, with the `X-TAXII-Date-Added-First/Last` headers, errors in the
    TAXII format, 406 for another version and the paths with and without a trailing slash.
  - The identity and the ids of the indicators are **the same** as in the `.stix.json` files, so
    whoever already imported a file does not get a duplicate.
  - The `date_added` is the last change: whoever fetches with `added_after` also receives the sample that
    **became** malicious later (a `date_added` by sample creation would lose that case).
- **MISP feed**: `manifest.json` and a `<uuid>.json` per sample, with the same uuids as the
  `.misp.json`, organization, `published`, `timestamp` and a tag with the verdict.
- **Access:** new token scope, `FEED` (migration `20261223000000_api_token_feed`).
  - Only an admin creates it, and the token stops working if the owner stops being an admin, like the status one.
  - It applies only on the feed routes, and the samples token does not read the feed.
  - It accepts `Bearer` and **Basic with the token as the password** (the Sentinel connector only speaks Basic),
    and Basic applies only on these routes. The API never sends `WWW-Authenticate`, so the browser does not
    store a credential.
  - The logged-in admin also reads it. The limit is 1200 requests per minute, against 120 for the others,
    because MISP fetches one file per event.
- **Screen:** the **Indicator feed** purpose in My Account > API Tokens, with what goes out,
  the two addresses and the MISP step by step.

**Along the way:**
- **The response type.** Fastify rewrites `application/taxii+json;version=2.1` as
  `application/taxii+json; version="2.1"; charset=utf-8`. A client that compares the text
  would refuse it. An `onSend` hook, only in this plugin, returns the exact text of the specification, and the
  test requires equality.
- **A test that hung, and my wrong reading of it.** The interoperability step used
  `spawnSync`, which blocks the process of the very server the Python client was querying. The
  file died at the runner's 10 minutes, and I even read "32 of 33" as if the step
  had passed. With the asynchronous call, the file runs in 15 s.

**Tests:** `feeds.test.ts`, with 37 checks:
- **Access:**
  - an analyst does not create the token; without a credential, 401;
  - the samples token does not read the feed, and the feed one does not read samples;
  - Basic only applies to the feed, and there is never a `WWW-Authenticate`;
  - logged-in analyst, no; logged-in admin, yes;
  - the token stops when the owner is demoted.
- **TAXII:**
  - the discovery, with the exact type;
  - the root, the collection, the 404 in the TAXII format and the 406.
- **What goes out:**
  - the malicious and the suspicious one enter;
  - the clean, the one without a verdict and the trashed one stay out;
  - the allowlist and the company domain stay out (subdomain, email and URL);
  - the malicious verdict applies even with the domain also in a clean one;
  - the id is the same as the file's.
- **Pagination and filters:**
  - pagination 2 by 2 goes through everything without repeating;
  - `match[type]`, the date headers and the empty `added_after`;
  - the sample that becomes malicious appears in `added_after`;
  - object, versions, 404 outside the feed and manifest.
- **MISP:**
  - the manifest has one event per sample;
  - the event goes out filtered and published;
  - 404 for a clean sample and for any name.
- **Limit:** 150 requests in a row pass.
- **Interoperability**, with the API listening on a real port and the reference clients
  in a container:
  - `taxii2-client` (OASIS) paginates the collection, and `stix2` validates **each object** without
    extensions;
  - `pymisp` loads each event of the feed.
- **Reverse proof:** turning off, one at a time, the company filter, the allowlist and the
  verdict filter, the checks of that filter fail (including through `pymisp`).
- The `api-tokens` screen scenario gained 5 checks: what goes out, the two addresses, what the token
  does not reach, the `POST` with `FEED` and the purpose in the list.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1125 checks in 36
files** of integration (they were 1088 in 35); 120 web unit tests; `test:images` with 67;
`test:smoke` with 101; the `api-tokens` and `backup` scenarios green.

**Left out:**
- **removal:** when a sample stops being malicious, the indicator disappears from the collection, but
  TAXII does not notify whoever already had it (there is no "revoked" without keeping the history of what went out);
- the `POST` of objects in TAXII (the collection is read-only);
- the optional `hashes.csv` of the MISP feed.

---

## 6. Third batch: hardening, CI, performance and dependencies

A survey made after the second batch, with execution evidence and not just reading:
real requests to nginx (headers, gzip, cache), `npm outdated` in the three apps and the
`test:images` and `test:smoke` scripts run against the Node 26 images. It also includes
**3.2** and **4.2**, with the design decided in their sections. Item 6.13 (backup outside the
disk) **was deferred by the owner**: it stays recorded with the design, without code and outside the order.

**Execution order** — each phase ends validated before the next:

| Phase | Items | Validation at the end |
|---|---|---|
| A. Small fixes and wiring | 6.1, 6.2, 6.3, 6.6 | API `build` and `lint`, `test:images` |
| B. Web and nginx | 6.5, 6.7 | `test:images` and `test:smoke` |
| C. CI | 6.8, 6.4 | `actionlint` and Trivy actually run, locally |
| D. Tests and frontend | 6.9, 6.10 | `test:unit`, `build` and `test:smoke` |
| E. API | 4.2, 3.2 | integration suite, with new files |
| F. Dependencies | 6.11, 6.12 | one major at a time: full suite and smoke |

### 6.1 Small fixes
- **Problem:** `apps/api/.dockerignore` has `*.log` and `src/generated` glued onto one line
  (`*.logsrc/generated`), so neither is ignored in the build. The API's `@types/node` is
  at `^22.9.0` with the runtime on Node 26. And `apps/api/tests/images.mjs` still brings up the echo
  that stands in for the API with `node:22-slim`: a leftover from the Node change, which the survey
  of that batch did not catch because it only looked at Dockerfile, yml and md.
- **Proposal:** split the `.dockerignore` lines; raise `@types/node` to `^26` (and the
  `target`/`lib` of the `tsconfig`, if `tsc` asks); switch the echo to `node:26-slim`.
- **Validation:** API `build` and `lint`, `test:images`.

**Implemented.** The API `.dockerignore` split `*.log` from `src/generated` (and started ignoring
`tests`, where the test disk images stay in `.tmp`). `@types/node` went up to `^26` and
**revealed a real type error** in `lib/clamav.ts` (the socket `data` event accepts `string`
in the new types); the ES2022 `target` did not need to change. `images.mjs` started using `node:26-slim`.

### 6.2 Playwright version in lockstep
- **Problem:** the version appears in `apps/capture/package.json` (exact), in the `FROM` of
  `apps/capture/Dockerfile`, in `apps/api/tests/smoke.mjs` and twice in
  `scripts/ui-playwright/run.ps1`. Dependabot opens separate PRs for npm and for the image,
  and the CI `capture` job does not open a browser: a PR merged alone would break the capture without
  CI noticing.
- **Proposal:** `scripts/check-playwright-version.mjs`, which fails if the places diverge, in a
  CI step; Dependabot starts ignoring `playwright` (npm) and `mcr.microsoft.com/playwright`
  (docker), and the change is made by hand, in the places together, with the script as a safety net.
- **Validation:** the script passes in the current state and fails when one of the places is changed.

**Implemented.** `scripts/check-playwright-version.mjs` checks the **five** places (package,
capture image, `smoke.mjs` and twice in `run.ps1`) and also fails if a pattern stops
matching (a rewrite does not silently turn off the check). It runs as the first step of the
`capture` job. Dependabot started ignoring `playwright` (npm) and `mcr.microsoft.com/playwright`
(docker). Tested with the three ways of failing: different version, missing pattern and missing file.

### 6.3 Dependabot and the Node major
- **Problem:** when Node 27 comes out (Current, without LTS), the `docker` ecosystem will propose
  `node:27-slim`.
- **Proposal:** `ignore` of `version-update:semver-major` for `node`; the switch to the next
  LTS is manual and deliberate.

**Implemented.** `ignore` of `version-update:semver-major` for `node` in Dependabot. The tags are
floating (`26-slim`), so the patch comes with every rebuild; the weekly Trivy warns of an old base.

### 6.4 Weekly CVE scan of the images (Trivy)
- **Problem:** item 2.3 was born from a MinIO CVE discovered by chance. `dependabot.yml`
  only looks at npm, the Dockerfiles and the actions: `postgres`, `clamav` and the compose `minio` (via
  `${MINIO_IMAGE:-pgsty/silo@sha256:…}`, with a variable) stay out, and nothing warns of a new
  CVE in the images already built.
- **Proposal:** `.github/workflows/security-scan.yml`, weekly, manual and on PRs that touch
  a Dockerfile or compose: build the three project images and also scan what
  `docker compose config --images` lists as third-party, with **Trivy run from the official
  image** (no third-party action, and the same command runs locally). Fails on HIGH/CRITICAL
  **with a fix available**; what is an accepted risk goes to `.trivyignore`, each line with the
  justification.
- **Validation:** the same command run here, against the six images.

**Implemented**, with the local scan before and after in each decision:

| Image | Before | After |
|---|---|---|
| `web` (`nginx:1.27-alpine`) | **62** high/critical findings with a fix | **0** |
| `api` and `capture` | 6 each (`undici` and `brace-expansion`) | **0** |
| `postgres:16-alpine` | 26 (all in `gosu`) | 0, with a justified exception |
| `minio` (`pgsty/silo`) and `clamav` | 0 | 0 |

The API and capture 6 were **in the `npm` built into the image**, not in a project dependency,
and the runtime only runs `node`: `npm` left the final images. The Postgres 26 are all
`gosu`, which runs once on boot only to drop root. `.github/workflows/security-scan.yml`
(weekly, manual and on PRs that touch a Dockerfile or compose) scans the three project images,
the third-party ones from compose (the list comes from `docker compose config --images`) and the Dockerfiles. The
Trivy runs from the **official image**, without a third-party action, through `scripts/trivy.mjs`: the same
command in CI and on the machine. It fails only on high or critical severity **with a fix**
(`trivy.yaml`). Two exceptions, both justified in the file and **narrow**: `gosu`, and
`/root/.npm`, where the Playwright base image (Microsoft) brings a signed link (SAS) from its feed
that the secret scanner flags. **Proofs:** `nginx:1.27-alpine` fails (62), and a private
key outside `/root/.npm` does too; the vulnerability database downloads from the ECR mirror (the
`ghcr.io` limits the anonymous queries from the runners).

### 6.5 `web` without root and hardened compose
- **Problem:** `web` is the entry point (behind the Cloudflare Tunnel) and the least
  hardened: the nginx master runs as root and there is no `cap_drop`, `no-new-privileges`,
  `read_only`, memory limit or healthcheck. The API and capture already have the first two.
- **Proposal:** `nginxinc/nginx-unprivileged` (port 8080, user 101), `read_only` with
  `tmpfs` in `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit`, `pids_limit` and
  healthcheck. The port published on the host remains `127.0.0.1:8080`, so `cloudflared` does not
  change. `images.mjs` and `smoke.mjs` start using the internal 8080, and `images.mjs` gains the
  "without root and without capabilities" checks that the API already has.
- **Validation:** `test:images` and `test:smoke`, plus `docker compose config`.

**Implemented.** Base `nginxinc/nginx-unprivileged:1.29-alpine-slim` (the `-slim` variant does not
bring the xslt, image-filter and geoip modules, nor libxml2, libtiff and libpng) with `apk upgrade` at
build time; internal port 8080 (the host keeps publishing `127.0.0.1:8080`, so `cloudflared`
does not change). In compose, `web` gained `read_only` (with `tmpfs` in `/tmp`), `cap_drop: ALL`,
`no-new-privileges`, `mem_limit` (`WEB_MEM_LIMIT`, 256m), `pids_limit` and healthcheck.
`tests/compose-service.mjs` reads the service **from compose** and builds the `docker run` flags, and
`images.mjs` and `smoke.mjs` run `web` with them: the test exercises what goes to production, and
checks the uid without root, without capabilities, read-only and a healthy healthcheck.

### 6.6 Docker log rotation
- **Problem:** compose has no `logging:`; Docker's `json-file` has no limit if the
  host's `daemon.json` does not define one, and the homelab disk is the same as the data's.
- **Proposal:** an `x-logging` block with `max-size` and `max-file`, applied to all
  services, with the two measures adjustable through `.env`.

**Implemented.** `x-logging` block (`json-file`, `LOG_MAX_SIZE` 10m and `LOG_MAX_FILE` 3, adjustable
through `.env`) applied to the six services; checked with `docker compose config`.

### 6.7 nginx: asset cache, asset 404 and COOP/CORP
- **Problem:** checked with a real request: `/assets/*` goes out without `Cache-Control` (only ETag),
  so every load revalidates each file, and an asset that does not exist falls into the SPA
  fallback and responds `index.html` with 200 (the client with the old page receives HTML in place of the
  JS). `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` are also missing.
- **Proposal:** `location /assets/` with `expires 1y` and `try_files $uri =404`; the rest with
  `expires -1` (`index.html` always revalidated); the two `same-origin` headers at the
  server level. **It uses `expires`, and not `add_header`, on purpose:** `add_header` inside a
  `location` discards all the server ones (the pitfall of 4.1); `expires` does not.
- **Validation:** `images.mjs` checks the security headers and the cache on `/`, on
  `/assets/…` and on an error response; `test:smoke` covers the noVNC console.

**Implemented.** `location /assets/` with `expires 1y` and `try_files $uri =404`; the rest with
`expires -1`. The two `same-origin` headers on the server. Checked: an `expires` **does not**
bring down the server's security headers (`images.mjs` checks them on `/`, on an asset and
on a 404). On top of that, **measured** with the new `dist`: nginx compressed at level 1 (the default) and did not
send `Vary`; with `gzip_comp_level 6` and `gzip_vary on`, the main JS dropped from 96.9 to
82.4 kB (-15%) and the CSS from 168.6 to 117.6 kB (-30%).

`images.mjs` gained 13 `web` checks (headers, `Server` without a version, cache, gzip, `Vary`,
asset 404, SPA route, uid, capabilities, read-only and healthcheck). **The smoke found something
real:** with COOP, Chrome writes a warning to the console when the origin is HTTP under a name other than
`localhost`, and the smoke fails on any console message (58 failures, a single cause). In the
deploy that does not happen (the port is only published on `127.0.0.1` and the Tunnel delivers HTTPS), so
the smoke browser started accessing through `localhost`, sharing the network of the `web` container.

### 6.8 CI runs `test:images` and `test:smoke`
- **Problem:** both scripts exist and test exactly what the Node bump and the Dependabot PRs
  touch, but they only run by hand. Today a PR that changes `node`, `nginx` or `playwright`
  passes CI without the image being built.
- **Proposal:** `images` job on every push and PR; `smoke` job only outside PRs (`main` and manual),
  because it pulls the Playwright image (3.6 GB). The lockstep step of 6.2 goes into the `capture` job.

**Implemented.** `ci.yml` gained the `images` job (every push and PR) and `smoke` (only outside PRs, because
it pulls the 3.6 GB Playwright image); the Playwright lockstep step went into `capture`.
Validated with **actionlint** (the official workflow linter) and by running the same scripts here.

### 6.9 Vitest: more coverage where there is risk
- **Proposal, in order of value:** `api/client.ts` (`request` and `parseResponse`: HTML page
  of 502, network failure, 204, JSON error), with a simulated `fetch`; `cases.ts`; the hook of
  `useEntryListState.ts`; the `ErrorBoundary` with Testing Library and jsdom; and
  `@vitest/coverage-v8` with a floor on the tested modules. The current 55 tests do not protect
  a React component, and 6.12 is going to touch React.

**Implemented.** New dependencies: Testing Library, jsdom and `@vitest/coverage-v8`. **113
checks in 11 files** (they were 55 in 5): `api/client.ts` (response, API errors, 502 in HTML,
network failure, `AbortError`, what goes in the request and the `upload`), `cases.ts`, `lazyPage`, the
bell hooks (`notifications.ts`), the `useEntryListState` hook (the URL as state, with
debounce) and the `ErrorBoundary` (including the `key` change of AppShell). Coverage of the listed
modules: 95.7% of the statements, 88.7% of the branches, 97.7% of the functions. The **floor** (92/84/92/91) is
~3 points below, and it really fails (tested with a floor of 99%). CI runs `test:coverage`.

### 6.10 Frontend: code splitting and CSS
- **Problem:** there is no `lazy()`, the bundle is a single 1.08 MB chunk (383 kB on the wire) and
  `@novnc/novnc` is imported directly in `SandboxConsole.tsx`: everyone downloads the noVNC even
  with `SANDBOX_ENABLED=false`, which is the default. The CSS is 1.04 MB (169 kB on the wire).
- **Proposal:** `React.lazy` on the routes and `import()` of the noVNC; measure before and after. The selective
  Carbon CSS only goes in if it is possible to prove the screen did not change.

**Implemented (the JS).** `React.lazy` on 29 pages (`components/lazyPage.ts` keeps the props type);
only login, sign-up, home page and forced password change stay in the main bundle. The
`Suspense` is **inside** the AppShell `ErrorBoundary` (top, navigator and tabs stay up) and
another covers the screens without a shell (printing and the console window). The noVNC became its own chunk,
downloaded only when the console window opens. Main bundle: **1,076 kB (383 kB on the wire) →
268 kB (82 kB)**, already counting Vite 8 from 6.12. If a page's bundle does not download (new deploy
with the tab open), the error goes to the `ErrorBoundary`, which offers "Reload the page"; the asset 404 of
6.7 makes that explicit.

**Implemented (the CSS), after the visual suite of 6.14.** The `@use '@carbon/react'` became a list
of modules in `app.scss`: Carbon brought the ~80 components, the four themes, the grid and the IBM Plex
fonts, and the screens use **18 components** (10 modules). Measured in the captures and in the classes:

| | Before | After |
|---|---|---|
| CSS | 1,056 kB (117 kB on the wire) | **307 kB (37 kB on the wire)** |
| woff2 fonts in `dist` | 90 files, 1.5 MB | **0** |
| web `dist` | ~4.0 MB | **1.8 MB** |

The cut is safe because the project SCSS **does not use** any Carbon function or mixin (it is `var(--dl-*)`
and pure CSS), the typography is HPSM's (Tahoma, so IBM Plex was never applied) and `hpsm.scss`
already overrides 55 `--cds-*` tokens. Three cautions worth recording:

- **Order matters.** The theme is emitted in `_carbon-theme.scss`, loaded **before**
  `tokens`/`auth`/`hpsm`: the two rules (Carbon's `.cds--g10` and the skin's `.cds--g10, .cds--white`)
  have the same specificity, and the one that comes later wins. Emitting the theme at the end of `app.scss`
  would make Carbon's palette override HPSM's.
- **Only the light `g10` theme**, which is the only one the app applies (`<Theme theme="g10">` in AppShell and
  in the printing screens); the two dark ones left.
- **A new component requires a new module**, otherwise it stays without style silently. That is why
  `scripts/check-carbon-css.mjs` (CI step in the `check` job) reads the imports of `@carbon/react` and
  fails if a module is missing, if a module is unused or if a component appears outside the table; the
  `form` enters as a support module, because every Carbon field renders `cds--form-item` and
  `cds--label`.

**Proof:** the 14 baselines of 6.14 pass **without a single pixel difference** with the selective CSS, and
`test:images` (45) and `test:smoke` (100) remain green. The guard was tested in the four cases
(component without a module, module without use, missing support and the correct state).

### 6.11 API dependencies (majors)
- **State (`npm outdated`):** `postal-mime` 2.7.6 → 4.2.0 (reads a hostile `.eml`),
  `@fastify/multipart` 9 → 10, `@fastify/rate-limit` 10 → 11, `bcryptjs` 2 → 3. Prisma 8 is
  RC: it stays out.
- **Proposal:** one at a time, reading the changelog and running the full suite between one and
  the other; whatever breaks without a clear gain stays recorded and does not go in.

**Implemented.** One major at a time, reading the changelog first:

| Package | From → to | What was checked |
|---|---|---|
| `postal-mime` | 2.7.6 → 4.2.0 | Many parsing fixes in linear time (relevant for a hostile `.eml`). **Visible change:** a duplicate header now takes the **first** (before, the last): a repeated `From:` showed `second@evil.test` and now shows the first. Fixed in `eml-headers.test.ts` (8), which **fails on 2.7.6** |
| `bcryptjs` | 2.4.3 → 3.0.3 | `$2a$` and `$2b$` hashes verify **in both directions** (nobody is locked out, and the rollback works); the code only uses the asynchronous `hash` and `compare` |
| `@fastify/multipart` | 9 → 10 | Only the return of `saveRequestFiles` changed, which the project does not use (it uses `req.parts()`) |
| `@fastify/rate-limit` | 10 → 11 | Only removed deprecated types |

All have a CommonJS entry (`require`), so none broke the build. Full integration suite:
**1014 checks in 33 files**, green (they were 917 in 29).

### 6.12 Web dependencies (majors)
- **State:** React 18 → 19, Vite 6.4.5 → 8 (the exact pin was a CVE fix) with
  `@vitejs/plugin-react` 4 → 6, TypeScript 5.9 → 7.
- **Proposal:** after 6.9, one at a time, with `lint`, `build`, `test:unit` and `test:smoke`.
  TypeScript 7 only goes in if `typescript-eslint` accepts it.

**Implemented.** **React 18 → 19.3** and **Vite 6.4.5 → 8.3.5** (exact version, as before) with
`@vitejs/plugin-react` 6. The React 19 types only failed my new test (the global `JSX`
namespace left); the whole app compiled. Verified: `lint`, `tsc`, build, the 113 tests, `test:smoke`
(100 checks, **once with React 19** and once with both) and the **91 screen scenarios**
(`scripts/ui-playwright`), which caught a regression **of mine**: `api-tokens` compared the text
of the row, and the new *Purpose* column shifted the indexes; the mock and the scenario were updated
and gained 8 checks. **TypeScript 7 did not go in:** `typescript-eslint` only accepts
`>=4.8.4 <6.1.0`, as the plan predicted.

### 6.14 Visual suite in CI
- **Problem:** the 91 screen scenarios check behavior and text and take captures for
  manual review, but nothing compares the appearance between versions. `web` is the only component without
  that kind of net, and it was for lack of it that the selective Carbon CSS (6.10) was left out.
- **Proposal:** a separate, small suite, with the critical-layout screens, `toHaveScreenshot`
  against versioned baselines, running in the Playwright image (identical rendering on
  any machine) and a CI job that publishes the diffs as an artifact.

**Implemented.** `scripts/ui-visual` with `@playwright/test` 1.64.1 and **14 captures** (10 screens
on the 1440x900 desktop; 4 of them also at 1024x700, for the lists and the card, where the layout
tightens): login, home page, history, my uploads, sample card, print card,
cases, dashboard, inbox and administration settings. `fullPage`, so what is
below the fold is also in the comparison. 1.9 MB of baselines.

What makes the capture stable, and what was hard to get right:

- **Frozen clock on both sides.** `page.clock.setFixedTime` in the browser and `DL_NOW` in the
  mock: `mock-api` computed the sample ages with `Date.now()` at module load, so freezing only
  the browser left the "30 h ago" text inconsistent. With both at the same instant,
  the dates and ages stop changing every hour.
- **Animation, cursor and scrolling out:** `animations: 'disabled'`, `caret: 'hide'`, a style
  sheet that zeroes CSS transitions and animation, and `--hide-scrollbars`.
- **Complete state instead of "loading".** The `e1` sample is born without TLSH and without an integrity
  check: the card would show "Computing..." and "Not checked yet" forever. The fixture sets a TLSH and a check
  date, and the baseline covers the rendering of those fields.
- **A single worker**, because the mock keeps global state.

**Proof of teeth:** with `.hpsm-status { letter-spacing: 1px }` in the build CSS, the comparison
failed in both viewports with **18,378 different pixels** (ratio 0.02) and generated
`actual`/`diff`/`expected`; with a hand-corrupted baseline, it also failed. Run twice in a row, the 14 PNGs come out with the **same hash**.

In CI, the `visual` job builds `web`, runs the comparison and, if it fails, uploads `test-results`
as an artifact. The Playwright version entered `check-playwright-version.mjs` (now six
places), because the visual suite uses the same image as the baselines: different version, different capture.

**Left out, on purpose:** a baseline of the 91 screens (huge maintenance for little return) and
capture of the sandbox console, which would require a fake VNC server. **Next expected use:** with
the suite in place, the selective Carbon CSS (6.10) becomes verifiable — cut the SCSS and
compare the screens.

### 6.13 Backup folder outside the disk

- **Problem:** the backup ZIP stayed in the bucket (`backups/`), and bucket and Postgres are
  `./data/minio` and `./data/pgdata` on the same machine: losing the disk lost data and backup.
- **Owner's decision:** a folder configured in `.env`, where the backup is written. Taking that folder
  to an external disk (mount, NAS, synchronization) is the responsibility of whoever configures the
  environment; DeepLook only writes to it.

**Implemented:**
- **`BACKUP_DIR`** in `.env` (host path). Compose mounts the folder at `/backups` and passes
  `BACKUP_DIR=/backups` to the API only when it is defined (`${BACKUP_DIR:+/backups}`, checked
  with and without the variable). Empty, nothing changes: the ZIP goes to the bucket, as before.
- **The ZIP goes straight to the folder**, and not to the bucket as well, because a copy on the same disk
  protects from nothing and would double the space:
  - the name is `deeplook-backup-AAAA-MM-DD-<id>.zip`;
  - it is built as `.<name>.partial` and renamed at the end, so whoever syncs the folder never sees
    a half-written ZIP, and the space is checked in the folder itself;
  - beside it goes a `.sha256` in the `sha256sum -c` format;
  - both with `600` permission, applied as soon as the temporary file is created, because the ZIP has the database and,
    if checked, malware;
  - on a failure, the temporary file and the `.sha256` leave the folder.
- **The `.deeplook-backups` marker**, created by whoever configures it. With the disk unmounted, the mount
  point becomes an empty folder on the main disk, and the backup would be written there without anyone
  noticing, which is exactly the failure the item wants to avoid. Without the marker, with the folder missing or
  not writable, the API refuses **before `pg_dump`**, with the reason.
- **Where the problem shows up:**
  - the Backup tab says where the ZIP goes and shows what prevents writing;
  - the status page gains **Backup folder**: off without `BACKUP_DIR`, in alert with the
    reason, or ready with the free space; in the three cases, with the time of the last ready backup.
- **Download, expiry and deletion:**
  - read and delete from the folder only the ZIP and the `.sha256` that the API wrote, by the name stored in the row;
    the rest of the folder is not touched;
  - earlier backups, in the bucket, keep downloading until they expire (the key in `backups/` says where
    they are; no migration);
  - a file missing from the folder makes the download respond 404 with the likely reason (disk
    unmounted), and not 500.

**Tests:**
- `backup.test.ts` gains 15 checks (they were 39, now 54):
  - without the marker, the screen shows the reason and the backup is refused without leaving anything in the folder;
  - with the marker, the ZIP is written to the folder with the expected name, and not to the bucket;
  - the `.sha256` matches byte by byte, and the ZIP and the `.sha256` come out with `600`;
  - no `.partial` is left, the download returns the same bytes, and an old bucket backup
    keeps downloading;
  - a file outside the folder gives 404 with the reason;
  - a simulated failure halfway through the build leaves neither a temporary file nor a `.sha256`;
  - expiry and deletion erase only what belongs to the API;
  - a folder without write permission: the reason carries the uid.
- **Reverse proof:** without the marker requirement, the backup is written to the "unmounted" folder and the two
  marker checks fail; without the cleanup, the halfway-failure one fails.
- `test:images` brings up the real image with the folder mounted, as compose does. The non-root user
  writes to the host disk, the file comes out with uid 1000 and `600`, the `.sha256` matches and the download
  through the API returns the file.
- The `backup` screen scenario gains 3 checks: the same-disk warning, the folder text and the
  reason for the problem on screen.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1070 checks in 35
files** of integration (they were 1055); `test:images` with **65** (they were 62); `test:smoke` with 101;
113 web unit tests; the `backup` scenario green.

**To turn it on in an installation:** create the folder on the external disk, the marker and the uid 1000 owner,
set `BACKUP_DIR` in `.env` and `docker compose up -d` (the step by step is in the README, in
"Backup folder outside the disk").

**Scheduled backup**, the second part, with the owner's decisions: password in an `.env` variable,
ZIP with the samples (protected by the password), and the frequency in a calendar on the screen.

- **Screen:** the Backup tab gains the **Scheduled backup** section. It offers:
  - days of the week (all seven = every day) or a day of the month (1 to 28, to apply in every month) and
    the time;
  - a **calendar** of this month and the next, with the days marked, and the next five
    runs, updated while you choose, before saving.

  The time applies in the time zone of the browser of whoever saved it, which goes along (`timezone`); another admin
  in a different time zone sees a warning. The preview logic is pure (`backupSchedule.ts`, with a unit
  test).
- **Password:** `BACKUP_SCHEDULE_PASSWORD` in `.env` (12+ characters; fewer than that, the API does not
  start and says why). Without it, the schedule does not turn on: the screen says so (without an error tone, because it is
  optional) and the API refuses with 409. The password does not go to the backup row, to the audit or
  to the saved setting (checked in the test).
- **API:**
  - the setting lives in `systemSetting` (`backupSchedule`), with the next run already in UTC;
  - a clock checks every minute. If the API was down at the time, the backup goes out **once**
    when it comes back and the calendar continues; with another backup in progress, it waits the following
    minute without losing its turn;
  - the backup creation left the route for `createBackup`, which the screen and the schedule use (same
    one-at-a-time lock, same audit, with "scheduled" in the detail and without an author);
  - the row gains `scheduled` (migration `20261222000000_backup_scheduled`), and the list shows
    **Scheduled** under "By";
  - the schedule change goes to the Audit log (`SETTING_CHANGED`), and the status page shows
    the next one and warns if it is on without the password.
- **Daylight saving time.** The test caught a defect in my first calculation: on 3/8/2026, in New
  York, 02:00 does not exist (it becomes 03:00), and the backup scheduled for 02:00 went to 01:00, one
  hour **earlier**. The calculation now tests the offset before and the one after the change:
  - the hour that does not exist goes out right after (03:00), as the browser `Date` does in the preview;
  - the repeated hour at the end of daylight saving time runs once, on the first.

**Schedule tests:**
- `backup.test.ts` went from 54 to **72** checks. It covers:
  - next runs in UTC, the month rollover, the two daylight saving changes and the validation
    (day 31, nonexistent time zone, no days);
  - without a password the screen knows and does not turn on, and an analyst does not schedule;
  - the change goes to the audit without the password;
  - before the time nothing goes out, and with another one in progress it waits without skipping its turn;
  - late, it runs once and the next one is after now;
  - the scheduled one goes out with samples, with a password, without an author, marked and in the audit;
  - the ZIP opens in 7-Zip **with the `.env` password**, brings the samples and refuses another password;
  - turned off, it no longer runs.
- 7 unit tests of the preview, with the module in the coverage (97.8% / 100% of the lines).
- The `backup` screen scenario gained 8 checks:
  - without the password, it warns and does not turn on;
  - the days marked in the calendar and the next runs, in both months;
  - the `PUT` with the days, the time and the time zone;
  - the confirmation with the next one;
  - the monthly one;
  - "Scheduled" in the list.
- `test:smoke` failed the first version, rightly: in an installation without the password, the tab
  showed in red an optional feature that was off. It became an informational message.

**Left out:**
- **Periodic restore test.** `backup.test.ts` really restores (`pg_restore` on a new
  database, counts matching), but that does not run in the installation.
- **Retention of the folder itself.** The same `BACKUP_RETENTION_DAYS` applies (up to 90 days); whoever wants
  to keep it longer copies from the folder to another place, and the API does not delete those copies.

### 6.15 API boundaries: trusted network, session by hash, CSRF and `.env`

A review after the third batch found four boundary holes. The first is Strix's vuln-0008, which the fourth
round did not close (Finding I).

- **Trusted network.** The API trusted the `X-Forwarded-For` from any private address and was also
  on the `capture` network, the one of the Chromium that opens malicious pages. That Chromium runs without its own
  sandbox (the Playwright default is `chromiumSandbox: false`), so an exploited flaw
  in the renderer already gave code in the container. From there, `api:3000` answered directly, without the nginx,
  and the XFF changed on every request got around the login limit per IP. Now the `deeplook` network has a
  fixed subnet (`DEEPLOOK_SUBNET`, default `172.31.250.0/24`), which reaches the API as
  `TRUSTED_NETWORK`. Only the loopback and that range report the client IP, and any other
  connection is dropped in the server's `connection` event, before HTTP is read
  (`src/lib/network.ts`). The API keeps calling `capture`, but `capture` no longer reaches
  the API. Without `TRUSTED_NETWORK`, the old behavior applies (development and tests) and the
  system status warns.
- **Session by hash.** The session id was the cookie value itself, and the backup `pg_dump`
  (which can come out without a password) carried all the valid sessions. The database now stores the SHA-256
  of the cookie, as it already did with API tokens. The migration
  `20261221000000_session_id_hash` converts the existing sessions with the same hash, so
  nobody is logged out. The Sessions tab keeps showing the short hash of the id.
- **CSRF.** `SameSite=Lax` does not separate subdomains: behind the Tunnel, another service on
  `*.your-domain` is *same-site*. A `multipart/form-data`, which does not ask for preflight, would send a
  sample on behalf of whoever was logged in, and a WebSocket would open the sandbox console. A global
  `onRequest` hook (`src/lib/cross-site.ts`) refuses with 403 the unsafe methods, and every
  WebSocket, when `Sec-Fetch-Site` is `same-site` or `cross-site`. Without the header (scripts,
  API tokens) the request passes. With `COOKIE_SECURE=true` the cookie becomes `__Host-dl_session`,
  which prevents another subdomain from writing or replacing it (session fixation). When turned on, whoever
  was logged in signs in again once.
- **`.env` with 777.** On an ext4 partition, any user of the machine could read and change the
  secrets. It became `600`. The permission belongs to the machine, not to the repository (`.env` is not
  versioned), so whoever clones again has to repeat `chmod 600 .env`.

**Tests.** `boundaries.test.ts` brings 33 checks:
- who reports the IP: the nginx from the range yes, a neighbor from the `capture` network no;
- a real TCP connection dropped outside the range and served inside it;
- POST and WebSocket from another site refused, and the same-origin and script ones accepted;
- the database without any cookie value, and the database id refused when used as a cookie;
- the migration hash equal to the code's, and a session from before the migration still valid after
  it;
- the `__Host-` with `Secure` and `Path=/`, including on sign out.

With each protection turned off by hand, 9 of the checks fail. `test:smoke` gained the proof in the
real topology: the test network with a fixed subnet and a second network in the role of `capture`. From
the first, the API responds 200; from the second, the connection drops. The real browser does the whole script
through the nginx with the other-site blocking on.

**Validation:** `format:check`, `lint` and `build` clean in the API; **1047 checks in 34 files**
of integration (they were 1014 in 33); `test:smoke` with 101 (they were 100).

**To update an installation:** `docker compose down` before `up -d --build`, because
Docker does not change the subnet of a network that already exists. The data stays in `./data`.

**Left out, on purpose:**
- Chromium's own sandbox (`chromiumSandbox: true`), which needs a seccomp profile
  that allows *user namespaces* and testing on the host kernel;
- restricting the `CONNECT` ports of the capture proxy;
- the fixed `Content-Type` on the sample download.

They stay as next steps.

### 6.16 Chromium sandbox for the capture

`capture` opens malicious pages by definition, and Chromium ran with `--no-sandbox` (the
Playwright default is `chromiumSandbox: false`): an exploited flaw in the renderer gave
code straight in the container. 6.15 took the path to the API away from that container; this item
puts the page behind Chromium's own sandbox.

**Measured before touching anything** (in a container with `cap_drop: ALL` and
`no-new-privileges`, on the Liquorix 7.2 of the development host):

| Configuration | Result |
|---|---|
| Today: no sandbox, default seccomp | renderer with `--no-sandbox`, in the container namespace, 1 seccomp filter (Docker's) |
| Sandbox + Docker default seccomp | does not come up ("Chromium sandboxing failed!") |
| Sandbox + `seccomp=unconfined` | comes up, but removes Docker's protection entirely; only served as a diagnostic |
| Sandbox + narrow profile | renderer in its own *user* and *pid namespace*, 2 seccomp filters (Docker's and Chromium's), without `--no-sandbox` |

**Implemented:**
- The `apps/capture/seccomp-chromium.json` profile is Docker's default (moby/profiles, pinned
  commit `4b8214fc4971`) plus four rules:
  - `clone`, with both parameter orders (the s390 one is different), and `unshare`, only when the
    flags create *user*, *pid* or *net* namespaces: mount, uts, ipc and cgroup remain
    blocked (`SCMP_CMP_MASKED_EQ`);
  - `chroot`.
- Checked in the container: `unshare -U` and `-U -p -n` pass; `-m`, `-u`, `-i`, `-C` and a
  `mount` inside the namespace remain blocked.
- The profile comes from `scripts/seccomp-chromium.mjs`, and CI checks that the file matches the
  generator (`--check`).
- Compose applies the profile to `capture`. It resolves the path from the project root and
  embeds the content, even when called from another folder (checked in a throwaway project).
- `server.mjs` turns on `chromiumSandbox`. A browser that does not come up becomes a readable capture
  error ("the Chromium sandbox did not start on this host...") and closes the proxy of that capture;
  before, the `launch` failure escaped as a 500 and left the proxy open.
- `/health` reports `sandbox`. `CAPTURE_CHROMIUM_SANDBOX=false` stays as an emergency exit
  for a host without *user namespaces*, with a warning in the log.

**Tests:** `test:images` started bringing up `capture` with the configuration read from compose
(`runArgs`, which gained `shm_size` and resolves the profile path). Before, the configuration was
a hand-made copy without `cap_drop`. New checks:
- `/health` with the sandbox on;
- a page that holds the renderer for 4 s, inspected live: its own *user* and *pid namespace*,
  2 filters and no `--no-sandbox`;
- the same page captured successfully;
- without the profile, the capture fails with the reason.

`test:images` went from 45 to **49 checks**. Outside the tests, a real capture of
`https://example.com/` through compose worked: screenshot, status 200 and certificate.

**Accepted cost:** the profile lets a process without capabilities create *user namespaces*, which
widens the kernel surface exposed to the container. It is the trade Chrome itself makes on
the desktop. The sandbox protects against the most likely flaw (the renderer, with exploits that
circulate in phishing kits); the other requires a kernel flaw, with mount, uts,
ipc and cgroup namespaces still blocked and the container still without capabilities.

**Left out:** `capture` with a read-only filesystem, which became item 6.17.

### 6.17 Read-only capture and one container per capture

The sandbox (6.16) holds the page inside the renderer. This item takes care of what would remain if
someone got past it too: today a process or file left in the container
would survive to spy on the following captures.

**Measured before touching anything:**
- **Read-only:** with the root read-only and only `/tmp` on `tmpfs`, Chromium comes up and
  captures `example.com` and Wikipedia (screenshot and 120 kB of HTML). It only writes the temporary
  profile to `/tmp` (144 kB after the capture); `/app` and `/home/pwuser` refuse writes.
- **Docker restart:** a container that lives less than 10 s comes back with a wait that doubles on
  every attempt (0.1 s, 0.2 s, 0.4 s…; with 2 s of life, it went past 12 s on the 8th cycle). With 10 s or
  more, it comes back right away: in a loop of 10.5 s, a restart every ~10.6 s, without accumulated delay.

**Implemented:**
- **Compose:** `capture` gains `read_only: true` and `/tmp` on `tmpfs` (256 MB, `noexec`,
  `nosuid`, `nodev`).
- **Server:** with `CAPTURE_RECYCLE` (default `true`), it serves one capture, responds and exits, and
  `restart: unless-stopped` brings up a clean container. The exit happens at least 10.5 s after
  startup, so it does not fall into Docker's delay. As the new container sits waiting,
  a manual capture is no longer slower: only two in a row end up with about 10 s between them.
  While it swaps, the server responds 503 with `Retry-After`. `/health` reports `recycle` and
  `ready`.
- **API:** `requestCapture` waits its turn for up to 2 minutes, trying every 1 s when it receives
  503 or a connection error (container starting). The capture's own timeout is not repeated. Before, the queue
  was inside the service and counted in the same 90 s, so simultaneous requests gain slack instead of losing.

**Tests:**
- `capture-recycle.test.ts` brings 6 checks with a fake service:
  - waits for the connection and gets past the 503;
  - returns the 503 at the end of the wait;
  - gives up with the connection error;
  - end to end, the capture is ready after a 503.
  - Without the wait, the test breaks.
- `test:images` brings up `capture` with the compose `restart` (`runArgs` learned the option) and
  gains 7 checks:
  - read-only root;
  - `/tmp` on `tmpfs` with `noexec`;
  - the capture;
  - the request right after refused;
  - the container swapped;
  - a file in `/tmp` and a `sleep` left before the capture disappear after it.
  - In the opposite case (`CAPTURE_RECYCLE=false`), checked by hand, the file and the process
    are still there.

**Validation:** `format:check`, `lint` and `build` clean in the API; **1053 checks in 35 files**
of integration (they were 1047 in 34); `test:images` with **56** (they were 49); capture tests green.

**Why restart the container instead of cleaning from inside:** the process that serves runs with the
same user as the browser. Whoever escaped the sandbox could attach to it (ptrace or
`/proc/<pid>/mem`) and survive any cleaning done from inside. A new PID namespace, which
only Docker gives, leaves nothing behind.

### 6.18 Verification battery (November)

A checking round over what the batches left, running everything that exists before saying
there is no pending item (the lesson of Finding G). As the repository **has no remote**, the steps that
only exist in CI (`check-carbon-css`, `check-playwright-version`, `seccomp-chromium --check` and
`actionlint`) were also run by hand.

**Starting point, all green:** `format:check`, `lint` and `build` in the API and the web; 113 web unit
tests (95.7% coverage); 4 capture tests; 1053 integration checks in 35
files; the three CI scripts; `actionlint` without findings. `npm audit` reports 10 moderate, all
in a development dependency (`minimatch` through ESLint and `typescript-eslint`); in production
(`--omit=dev`) they are zero, and CI only fails from `high`.

**Fixed:**
- **The API repeated a capture that brought the service down.** `requestCapture` (6.17) retried, until the
  end of the 120 s, on `ECONNRESET` and `UND_ERR_SOCKET`, which is also what happens
  when the page runs out of memory and takes the container with it. Measured with a fake service that
  falls halfway through the request: **11 visits to the same URL in 5 s** (21 in 3 s in the test). Each one
  revisited the malicious page, and each container that lives less than 10 s increases Docker's restart delay
  for the following captures. Now the lack of connection (`ECONNREFUSED`, DNS,
  `EHOSTUNREACH`, connection time) keeps being retried at will, because the request never arrived;
  a connection that dropped after being opened gets **one** new attempt only (it covers the old container
  leaving). New check in `capture-recycle.test.ts`, which fails without the fix.
- **`Content-Type` of the sample download** (leftover from 6.15). The stored `mimeType` came out, which is
  what the browser of whoever submitted declared: a sample submitted as `text/html` came back as
  `text/html`. The `attachment` and the nginx headers held it in the browser, but a direct call
  to the API (token, test) went without `nosniff`. Now always `application/octet-stream`, with `nosniff`
  and `Content-Security-Policy: default-src 'none'; sandbox`, as the capture screenshot and HTML already did.
  New check in `sample-access.test.ts`, which fails on the old code.
- **The test containers open to the LAN.** `tests/run.mjs` published Postgres (password
  `pg`, superuser), MinIO and OpenLDAP on `0.0.0.0`, and they **stay up** between one
  round and the next (only `--clean` brings them down): any machine on the local network could get in. Checked from
  another container: `10.0.0.85:55432` and `:6389` responded. Now everything publishes on `127.0.0.1`,
  including the three ports of `images.mjs`. `ensure()` writes the configuration to a label and
  recreates the container when it changes; without that, the old containers would stay on `0.0.0.0`.
- **Documentation:** the README gave `clamav/clamav:stable` as the `CLAMAV_IMAGE` default, and
  compose uses `clamav/clamav:1.5`; `.env.example` did not have `CAPTURE_CHROMIUM_SANDBOX` or
  `CAPTURE_RECYCLE` (they went in commented out, with the default). The README variable table was
  cross-checked entirely against the compose defaults: it was the only divergence.

**Checked and discarded:**
- Suspicion of IDOR in the sample sub-routes (`/captures`, `/antivirus`, `/yara`, `/iocs`,
  `/reputation` do not apply `visibleEntries`): it is not, because `requireUser` does that for every
  `/api/entries/:id` route, and `own-samples.test.ts` sweeps all of them.
- nginx: the `X-Forwarded-For` is the `$remote_addr`, without concatenating what the client sent.

**Validation:** `format:check`, `lint` and `build` clean in the API; **1055 checks in 35
files** of integration (they were 1053); `test:images` with 56 and `test:smoke` with 101, all green.

**Left as a recommendation** (not done in this round):
- **Capture network without direct egress** — became item 6.19 (done).
- **`CONNECT` ports:** the 80/443/8080/8443 list that 6.15 planned would break the capture of
  phishing on a high port (`:8000`, `:2083`...), which is common. Chromium already refuses its forbidden ports
  (SMTP, SSH...) before the proxy; mirroring that list in the proxy and validating 1–65535
  gives the same protection without breaking capture. The real gain against a compromised browser is
  in 6.19, and not here.
- **File permissions:** about 2,800 versioned files are writable by other
  users (a Windows copy), API code included, the same case as `.env` in 6.15. As
  `core.fileMode` is `false`, `chmod -R o-w` does not change Git; it belongs to the machine, like `chmod 600 .env`.
- **`pids_limit` and read-only root in the API**, which analyzes malicious files: `capture` and
  `web` already have them; the API needs its own test (`genisoimage` and Prisma write to disk).

### 6.19 Capture network without direct egress

The proxy that refuses internal addresses ran **inside** the Chromium container and only applied to
whoever used it: Chromium, as long as it obeyed. The `capture` network was an ordinary bridge, with egress
to everything. Whoever got past the sandbox (6.16) up to the browser process would talk directly to
the home network, including Proxmox.

**Measured before touching anything** (Docker 29.9, throwaway containers with `cap_drop: ALL`):

| Network | LAN and host services through the LAN IP | Internet | External DNS | Host through the bridge IP |
|---|---|---|---|---|
| ordinary bridge (the old `capture`) | reaches (`10.0.0.85:55432`, the libvirt DNS) | reaches | resolves | reaches |
| `internal: true` | no | no | no | **reaches**: Docker does not filter traffic to the host itself, so a host service on `0.0.0.0` (an sshd) would answer |
| `internal: true` + `inhibit_ipv4` | no | no | no | no: the bridge has no IP on the host |

In all three, containers on the same network see each other by name. A container on both the internal and an
ordinary network (the API's role) goes out through the ordinary one, in any order of connection: the internal one never becomes the default route.

**Implemented:**
- **Compose:** the `capture` network becomes `internal: true` with
  `com.docker.network.bridge.inhibit_ipv4` (Docker 28+). The new **`egress`** service is on it and
  on the `capture-egress` network, the only one with egress. `capture` gains
  `CAPTURE_EGRESS_PROXY=http://egress:3128` and depends on a healthy `egress`. `egress` runs
  read-only, without capabilities, with `no-new-privileges`, 256 MB and 64 processes.
- **`egress` image** (`apps/capture/Dockerfile.egress`): `node:26-slim` with only
  `proxy.mjs` and `egress.mjs`. It has no browser, no npm dependency, and no `npm` in the final
  image.
- **`proxy.mjs`:**
  - with `upstream`, the proxy inside the capture forwards to `egress` the HTTP (absolute form) and
    the `CONNECT`;
  - `egress` resolves and checks with the same rule as before, and the reason for a refusal comes back in the
    `x-deeplook-blocked` header, so the capture card keeps listing what was
    blocked;
  - without `upstream`, the behavior is the old one (outside compose);
  - a port outside 1–65535 receives 400;
  - the handlers do not let an exception escape. In the old code, `CONNECT 8.8.8.8:99999` reached
    `net.connect` and the `RangeError` brought the process down. Through Chromium that does not happen, but
    `egress` is a long-lived process and serves all the captures;
  - `/health` starts existing, for the compose healthcheck.
- **`server.mjs`:** `/health` reports `egress`, and the log says where the capture goes out.
- **CI:** the Trivy scan gains the `egress` image (matrix with a `Dockerfile` per image).

**Tests:**
- `apps/capture/tests/chain.test.mjs` brings 7 tests, on loopback only:
  - HTTP and `CONNECT` go through both proxies;
  - the internal network and metadata are refused by the outbound one, with the reason reaching the inner one;
  - an invalid port receives 400 on both, without bringing either down;
  - the outbound one being down gives 502, and not a direct connection.
- `test:images` builds the compose topology: the capture network is created with the configuration
  read from compose (`networkArgs`, new in `compose-service.mjs`); the test page is only on the
  `egress` network, so it can only be reached through it; a forwarder plays the API's role, because an
  internal network does not publish a port. There are 6 new checks:
  - the `egress` image builds;
  - `egress` comes up healthy;
  - `egress` runs without root and read-only;
  - the capture reports that it goes out through `egress`;
  - from inside `capture`, a direct connection to the internet, to the `egress` network and to the host does not
    get through (even `ECONNREFUSED` fails, because whoever refuses is a host that was reached);
  - from inside `capture`, external DNS does not resolve.
- **Reverse proof:** with `internal` and `inhibit_ipv4` removed from compose, exactly those
  two fail: `1.1.1.1:443` connects, the host answers (`ECONNREFUSED`) and DNS resolves.
- `test:smoke` starts creating the network in the `capture` role with the compose configuration. The API
  keeps serving the web network and dropping the capture one.

**Along the way: base images with a high CVE already fixed.** The Trivy of the new image failed
because of `zlib1g` from `node:26-slim` (two high CVEs, fixed in Debian in `deb13u1`). The API one,
on the same base, also failed, and the `capture` one had two in Ubuntu's `apt`. That did not come from
this item: they were new CVEs in the bases, which the weekly scan would report without anyone running it, because
there is no remote. The three images gain `apt-get upgrade` on the base, as `web` already did with the
`apk upgrade`. The four images and the Dockerfiles pass Trivy.

**Validation:**
- 11 capture tests (they were 4);
- `test:images` with **62** (they were 56);
- `test:smoke` with 101;
- Trivy clean on the four project images and on `config`;
- `actionlint` clean;
- `seccomp --check` passes.

The API did not change code in this item, and the integration (1055) is the one from 6.18.

**To update an installation:** `docker compose down` before `up -d --build`, because Docker
does not turn an existing network into an internal one.

**Left out:**
- Docker older than 28 was not checked: the network remains internal, but the host may still be
  reachable through the bridge IP;
- Chromium's forbidden ports mirrored in `egress` (its own line in "Where we stopped");
- the third-party images (Postgres, MinIO, ClamAV) were not scanned in this round.

### 6.20 Minimal capabilities in the stateful services and forbidden ports in egress

The last two hardening leftovers.

**Capabilities of `db`, `minio` and `clamav`.** The three ran with Docker's 14 default
capabilities and without `no-new-privileges`, and ClamAV reads malicious files. The three come up as root (the
entrypoint adjusts the ownership of the data and switches user), so a plain `cap_drop: ALL` breaks
all of them. The minimum of each was measured with throwaway containers and volumes, without touching
`./data`, with a volume and with a host folder (bind, as compose mounts), and each set checked
at three times: start, write and **restart with its own data**.

| Service | Minimum | What happens without it |
|---|---|---|
| `db` | `CHOWN DAC_OVERRIDE SETGID SETUID` | without any, the entrypoint does not switch to `postgres`; without `DAC_OVERRIDE`, the first boot passes and the **restart** fails (the folder already belongs to `postgres`, with `700`), which is the case of every existing installation; `FOWNER` is not needed |
| `minio` | `DAC_OVERRIDE` | runs as root in a host folder of another owner and does not even start ("file access denied") |
| `clamav` | `CHOWN DAC_OVERRIDE FOWNER SETGID SETUID` | without `FOWNER`, `install -d` does not adjust `/run/clamav`; without `DAC_OVERRIDE`, `clamd` does not open its own log. Checked with the real base copied: it responds, detects EICAR and restarts |

`NET_RAW`, `MKNOD`, `SYS_CHROOT`, `SETFCAP`, `SETPCAP`, `KILL`, `FSETID`, `NET_BIND_SERVICE` and
`AUDIT_WRITE` leave (and `FOWNER` in the database and MinIO). The three gain `no-new-privileges`.

**Forbidden ports in `egress`.** The 80/443/8080/8443 list that 6.15 planned would break the capture
of phishing on a high port (reviewed in 6.18). Instead of it, the proxy refuses the ports that Chromium
itself refuses. The list was **measured, not copied**: Chromium 156 from the Playwright
1.64.1 image navigated to every port from 1 to 11000 and refused exactly 80, with `ERR_UNSAFE_PORT`. The
list I would have written from memory had 4190 and 6679, which this Chromium does not refuse. The browser
already blocks those ports; in `egress` they apply even if it is compromised. The refusal comes back to
the card with the reason, like the internal address ones.

**Tests:**
- `test:images` brings up the API's Postgres and MinIO with the configuration read from compose (`runArgs`
  learned `cap_add`). It checks that they are without the default capabilities and **restarts Postgres** before
  the second API, which migrates, signs in and makes a backup on it. There are 2 new checks.
- `test:smoke` brings up the database and MinIO with the same configuration.
- ClamAV stayed out of `test:images`: it would download 170 MB of database and use about 1.5 GB of
  memory on every round. The measurement above is the record.
- `chain.test.mjs` brings 2 new tests:
  - SMTP through `CONNECT` and SSH through HTTP refused on both proxies, with the reason;
  - the list with the 80 ports, and the high phishing ones (8000, 2083) and the two I would get wrong
    (4190, 6679) allowed.
- **Reverse proof:** with the previous `proxy.mjs`, the ports test fails.

**Validation:** 13 capture tests (they were 11); `test:images` with **67** (they were 65); `test:smoke`
with 101; the ports script matches the browser. The API did not change code (1070 integration checks, from 6.13).

**To update an installation:** `docker compose up -d` recreates the three with the hardening; the
data stays where it is.

**Left out:**
- ports above 11000 were not scanned (the highest in the list is 10080);
- the list is Chromium 156's. When changing Playwright, run `node scripts/chromium-unsafe-ports.mjs`:
  it measures in the image of the capture version, without network and with 16 pages in parallel (about 50 s),
  and compares with the proxy's. Today it matches. It is not in CI, because it takes almost a minute and only changes
  with Playwright.

### 6.21 Scheduled backup alert and file permissions

The first two items of the review made after 5.3, the small ones that were worth it already.

**A failing backup did not warn anyone.** The scheduled one (6.13) only showed the failure on the Backup tab;
an unmounted external disk would go weeks without anyone knowing. Now `scheduledBackupProblem`
says what is wrong, with the schedule on:
- the last scheduled one failed (with the date and the reason);
- the last scheduled time, with **6 h of slack** for a large backup to finish, passed without any
  backup ready (a manual one also counts; an expired one later also does);
- the backup folder has a problem (the next one will fail);
- the password is missing.

The status page check is renamed **Backup** and becomes an **error**, and not an
alert. It is on purpose: `?strict=1` of the status token only responds 503 on error, so the monitor
that already exists warns without new configuration. The Backup tab shows the same reason. With the schedule
off, none of that becomes an error, and a folder with a problem goes back to being only an alert. Times before
turning the schedule on do not count: the schedule stores `savedAt`, without that it would raise a false alarm right
after turning it on.

**Tests:**
- `backup.test.ts` went from 72 to **81** checks:
  - the last scheduled time, including at the daylight saving change;
  - just turned on does not complain;
  - three days later without a backup, error with the time;
  - a backup ready after the time, no error;
  - the last scheduled one failed, error with the reason;
  - a folder with a problem and without a password, error;
  - turned off, the folder goes back to being an alert.
- **The reverse proof caught a weak test.** Without the `savedAt` protection, the test stayed green,
  because the backups from the previous sections, created minutes earlier, already satisfied the rule. The test
  now ages those backups before checking, and the reverse proof fails exactly the two
  protection checks.
- The `backup` screen scenario gained the check of the reason on the tab, as an error.

**Machine file permissions.** About 2,950 files and folders of the repository
(including the API code, a Windows copy) and of `data/` were writable by any user of the
machine. In `data/pgdata` there were **1,524 database files**, plus MinIO and ClamAV. `chmod o-w`
was applied to everything that belongs to the user (outside symlinks). Zero remained, and Git
did not change, because `core.fileMode` is off. It is also safe in `data/`: on startup, each
container adjusts the owner of its folder, and none depends on "others" being able to write. Like the `chmod
600 .env` of 6.15, it belongs to the machine: whoever copies the project from Windows again has to repeat it.

### 6.22 API with read-only root and deployment checklist

Item 4 of the review. `capture` and `web` already ran read-only and with a process limit;
the API, which analyzes malicious files, did not yet.

**Measured before touching anything:**
- `test:images` (migrate, create the admin, receive a sample, generate a backup) with `docker diff` on the
  container. Outside `/tmp`, the API only wrote to `/home/node/.cache` and `/home/node/.config`, and
  it was the **Prisma CLI** of `migrate deploy`: the version check and the telemetry
  (`checkpoint-nodejs`), which called the internet on every startup.
- The *schema engine* is already in the image (`node_modules/@prisma/engines`) and runs without network: there is no
  binary download.
- In the code, only `backup.ts` and `sandbox.ts` write, and always to `tmpdir()` (apart from `BACKUP_DIR`).

**The caveat that changed the design:** the API's `/tmp` cannot be `tmpfs` like the `capture` one.
Without `BACKUP_DIR`, the whole backup ZIP (database and files) is built there, and the sandbox ISO
also goes through it. In memory, that would count against `mem_limit` (4 GB) and would bring the API down on a large
backup.

**Implemented:**
- Compose gives the API `read_only: true` and `/tmp` on a **disk volume** (`api-tmp`).
- `pids_limit` of 256 (`API_PIDS_LIMIT`). The measured peak was **32**, after migrating, receiving a
  sample and generating a backup (the worker threads count), so there is 8 times the slack for
  analyses in parallel.
- The image turns off Prisma telemetry (`CHECKPOINT_DISABLE=1`) and points the CLI caches
  to `/tmp` (`XDG_CACHE_HOME`, `XDG_CONFIG_HOME`).
- `cleanStaleWorkDirs` deletes on startup the `deeplook-backup-*` and `deeplook-iso-*` folders that a
  crash left behind. They already accumulated forever in the container's writable layer, and with a
  persistent volume they would accumulate more.

**Tests:** `test:images` brings up the API with the configuration **read from compose** (`runArgs` learned
the volumes: the named one becomes anonymous in the test; the bind stays with whoever calls it). Before, the configuration
was written by hand. New checks:
- read-only root (`/app` and `/home/node` refuse writes) and writable `/tmp`;
- Prisma without telemetry;
- process peak below half the ceiling (printed in the log);
- the backup and ISO leftovers cleaned on restart.

The check for permission errors in the logs started looking for `EROFS` as well: a write blocked
by the read-only root does not pass silently. `test:images` went from 67 to **71**, with the
two backups (bucket and folder) working on the read-only root.

**Fixed subnet for `capture-egress`** (`CAPTURE_EGRESS_SUBNET`, default `172.31.252.0/24`; the
`deeplook` one uses `.250` and the smoke one, `.251`). Without it, the host has no way to send only the capture
egress through a VPN, and the capture opens malicious links from the home IP. Checked that it does not collide
with the networks of this host and that a container on it goes out to the internet with an origin in the range (it is
from this origin that the `ip rule` of the checklist depends).

**Left out:** `noexec` on the API `/tmp`. A named volume does not accept the option without tying it
to a host folder. The read-only root, the non-root user and `cap_drop: ALL` still apply.

**Deployment checklist** ([implantacao.md](implantacao.md)): the runbook for the homelab pilot,
in the order in which one step protects the next. It covers:
- requirements (Docker 28+, memory, *user namespaces*);
- secrets and permissions;
- Tunnel, `COOKIE_SECURE` and **Cloudflare Access**, with a **service token** for the machine
  clients (Uptime Kuma, MISP, TAXII), which otherwise would stop at Access;
- the capture going out **through a VPN** (source-based routing of the fixed `capture-egress` subnet);
- the sandbox off in the pilot;
- the backup on the external disk, scheduled and **restored once**;
- startup, accounts, monitoring, final check, operation and the agreement with whoever is going to test.

---

## 7. Fourth batch: static analysis

The owner's request after 6.22: improve the static analysis and evaluate **Ghidra + JDK** for
analyzing the functions. The conclusion was that Ghidra is worth it, but last and outside the API. Before it come
what is missing in the PE parser (cheap, no new dependency) and capa, which is the function analysis
aimed at triage.

**Why Ghidra does not come first:**
- **Cost:** Ghidra and JDK 21 add up to 1 to 1.5 GB of image, and a headless analysis takes from 30 s to
  minutes and from 1 to 4 GB of RAM. It does not fit in the analysis thread (60 s, 1.5 GB of heap).
- **Trivy:** Ghidra brings dozens of third-party JARs; with the weekly scan that fails on a high CVE
  (6.4, 6.19), it would become a recurring source of findings that do not depend on the project.
- **Surface:** it is one more hostile binary parser, in Java, with a history of CVEs.
- **Return:** a packed sample shows only the packer stub, and the group's specialists already
  have Ghidra or IDA on their own machine. What they lack is fast, searchable triage here.

### 7.1 PE static analysis

`parsePe` read the header, sections and imports and stopped there. In come, all in the analysis thread and with
limits for a hostile file:
- **imphash** and **Rich header hash**, identical to `pefile`'s (the VirusTotal reference), and the
  Related tab starts linking samples with the same imphash or the same Rich header;
- **exports** (with forwarders), **TLS callbacks**, **overlay** (with type and entropy) and
  **checksum** declared against the computed one;
- **resources** (type, language, size, entropy, embedded content), **version information**
  (OriginalFilename, company, product) and the **manifest** (does it request administrator?);
- **Authenticode signature**: who signed, the chain that came in the file and whether the file hash and
  the signature match;
- **.NET**: runtime version, assembly, references, P/Invoke (the native APIs that .NET calls) and
  obfuscator markers;
- **anomalies**: writable and executable section, entry point out of place, dynamic resolution of
  APIs, compile date in the future, and the packer recognized by the bytes, not only by the section
  name.

**Implemented** (all in TypeScript, in the analysis thread that already existed; no new
dependency in the image):
- `pe-analysis.ts` (headers, imports, imphash, Rich header, exports, TLS, overlay, checksum,
  packer and alerts), `pe-resources.ts`, `pe-authenticode.ts`, `pe-dotnet.ts` and
  `file-type.ts` (the `detectType`, now also used in the resources and the overlay).
- **imphash equal to pefile's**, including on ordinal imports: pefile's `ordlookup` table (MIT)
  was copied to `pe-ordinals.json` (ws2_32, wsock32 and oleaut32). Without it, malware
  that imports ws2_32 by ordinal would have a different imphash from VirusTotal's.
- **Rich header** in the same cut as pefile's, and the key checked against the DOS header and the
  entries (as Microsoft's linker computes it): edited or copied from another binary becomes an alert.
- **Authenticode signature** without internet: the file hash against the signed one, the messageDigest
  against the content, the signature against the certificate key (RSA and ECDSA), the chain that came in the
  file, self-signed, timestamp (countersignature or RFC 3161), name and address of the
  program. The chain is **not** checked against Windows' roots, and the screen says so.
- **.NET**: the 45 ECMA-335 metadata tables with the coded indexes, to reach the
  assembly, the references, the P/Invoke (the real "import" of a .NET loader), the sensitive
  calls (`Assembly.Load`, `WebClient`...) and the obfuscator markers.
- **UPX by the entry code**, measured in the upx 4.2 binaries for x86 and x64 (EXE and DLL): it catches
  UPX with the sections renamed and the `UPX!` marker erased.
- **Related**: indexed `imphash` and `richHash` columns (migration
  `20261224000000_entry_pe_hashes`), "Same imports" and "Same Rich header" reasons, and the
  same label in the Map. The imphash only links with its own table: out go .NET (all of it imports only
  `mscoree.dll!_CorExeMain`) and tables with fewer than 10 functions (packer).
- **Old samples**: `pe-backfill.ts` re-analyzes the PEs in the background after TLSH, one at a
  time, in the thread; a purged or unreadable one gets only the mark, so it does not return to the queue. The card of an
  old analysis warns and offers **Analyze again**; the re-analysis writes the columns.
- **Screen**: alerts by severity, imphash and Rich header with copy, entry point, checksum,
  appended data, TLS, manifest, section permissions (RWX in red), signature, version,
  resources (with the language), exports, functions imported by DLL and .NET. The A × B comparison gains
  imphash, Rich header and who signed.

**A difference from pefile, on purpose:** pefile counts the signature table as overlay, and
every signed binary would have "appended data". Here the overlay is what is left outside it.

**Tests** (`pe-analysis.test.ts`): real executables generated by `tests/fixtures/pe/gen.sh` on a
Debian trixie (mingw-w64 12, windres, Mono's mcs, upx 4.2, osslsigncode 2.9 with the built-in TSA and
a fixed date), with the reference output of **pefile 2024.8.26**, **dnfile 0.15.1** and **osslsigncode**.
The runner generates them in `.tmp/pe` and only redoes them when the sources change (about 40 s the first time).
- Against the reference, in 16 executables: imphash, Rich hash and entries, imports in order, exports,
  TLS, checksum, entry point, resources, version, overlay, .NET and the signature hash.
- What each finding means: a resource with an executable, manifest, "claims to be Microsoft",
  signed, tampered (the hash does not match and the signature itself remains intact), self-signed
  ECDSA, disguised UPX, edited Rich, .NET with P/Invoke and `Assembly.Load`.
- Checksum in blocks against pefile's literal port, including the multiple sum of 2³²−1.
- Hostile ones: resources in a loop with 65,535 entries, exports with 4 billion functions, TLS without end of
  list, giant signature table, DER with a lying size, garbage signature, .NET with 4
  billion rows per table, 2,400 mutations and cuts of the real executables and a 120 MB PE.
- Through the API: a submission writes the column, Related by imphash and by Rich header, .NET does not link
  through the generic imphash, re-analysis returns the columns, and the backfill of the old samples
  (including the purged one, which does not return to the queue).

**Reverse proof:** without the ordinal table, the imphash of the executables with ws2_32 diverges from
pefile's; without the entry code, disguised UPX passes; with the signature table entry in
the hash, signed and self-signed stop matching; without the imphash filter, .NET links to another
.NET. **The reverse proof caught a weak test:** the resource-loop case had only 8 entries
pointing to the root and passed even without the entry ceiling and without the visited mark. With the
65,535 pointing to the root, the parser without the limits hung for more than 60 s.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1351 integration
checks in 37 files** (they were 1134 in 36; `pe-analysis` has 217); 120 web unit tests
(95.9% coverage); `test:images` with 71 and `test:smoke` with 101, as before; the screen scenarios
`static-analysis` (with the new card, .NET and the old-analysis card), `related` and
`compare` green.

**Performance:** the checksum is the only calculation that goes through the whole file. With `readUInt32LE` the
analysis of a 190 MB PE went from 0.35 s to 1.6 s; summing in blocks of 2²⁰ dwords in
a `Uint32Array` (pefile's "carry" is equivalent to the sum modulo 2³²−1), the checksum dropped from 479 ms to
64 ms, with the same result in 1,610 cases.

### 7.2 capa and FLOSS in an isolated container

[capa](https://github.com/mandiant/capa) disassembles the binary and says what each function does ("injects
code via APC", "persists via Run key"), with the ATT&CK ID, which goes straight into `attack.ts`. The
[FLOSS](https://github.com/mandiant/flare-floss) recovers obfuscated and stack-built strings,
which today do not become IOC suggestions. Both run without a JDK, in a service in the mold of `capture`: without
outbound network, read-only root, `cap_drop: ALL`, time and memory limit.

**Implemented:**
- **`capa` service** (`apps/capa`): `server.py` (only the Python standard library) runs capa
  10.0.0 and, on PE, FLOSS 3.2.0 with its own time ceilings (`CAPA_TIMEOUT_S` 600,
  `FLOSS_TIMEOUT_S` 300; the whole process group dies on timeout) and returns a summary: rules
  with namespace, ATT&CK, MBC and up to 20 addresses; stack, "tight" and decrypted strings with the function.
  One job at a time (the others receive 503), `/health` responds during the analysis (free,
  analyzing, swapping) and, like the capture, **one container per analysis**.
- **Image**: two stages. FLOSS's `binary2strings` only exists as source code, so the
  compiler stays in the build stage; the wheels come out of it checked by the **lockfile with hashes**
  (`requirements.txt`, generated by `pip-compile` from `requirements.in`). The **rules and FLIRT signatures**
  do not come in the pip package: `ADD --checksum` downloads them from the `v10.0.0` tags and
  checks the SHA-256. The rule cache is generated at build time (with the read-only root capa would not
  be able to write it and would give up, measured). User `capa` (uid 10001), 548 MB.
- **Compose**: internal `analysis` network with only the API (no internet or egress), read-only root,
  256 MB `/tmp` in memory without execution, `cap_drop: ALL`, `no-new-privileges`,
  `pids_limit` 64, `mem_limit` 3 GB and the restart that swaps the container.
- **Queue in the API** (`lib/capa.ts`, `CapaAnalysis` table, migration `20261225000000_capa_analysis`):
  a Windows or Linux executable up to `CAPA_MAX_MB` goes in by itself after the submission (an email attachment
  and a ZIP file too); one at a time, persisted in the database. Service down: it goes back to
  the queue with the reason, up to 3 spaced attempts (5 and 10 min). API restarted halfway: what
  was in progress goes back to the queue, or fails if it already used the attempts. The service response
  is validated with a ceiling in each field, the NUL is removed (Postgres would refuse it) and only techniques that
  exist in the embedded ATT&CK go in.
- **Routes**: `GET /api/entries/:id/capa` (whoever sees the sample; also by API token, in the OpenAPI)
  and `POST` (analysts; 409 when queued, 400 outside the executables, 503 turned off).
- **Screen**: "Function analysis (capa)" section with status, executable, tools, ATT&CK
  techniques, capabilities (the risky ones highlighted) and the hidden strings, with their IOCs. In
  New report, **Insert techniques suggested by capa** and the FLOSS IOCs in "Insert suggested
  IOCs". System status with versions, queue and analyses in the last 24 h.
- **Trivy and Dependabot**: the image enters the weekly scan; pip leaves the final image (pip 26.3
  brings `pkg_resources` from a setuptools with a high CVE in the SBOM, and the runtime does not use pip, like
  npm in Finding D). Dependabot takes care of the lockfile and the base image, but does not upgrade capa or FLOSS:
  the rules, the signatures and the Dockerfile hashes have to go up together.

**Measured before fixing the ceilings:** from 0.6 to 9 s per small executable in capa and from 16 to 21 s in
FLOSS (it emulates); in a synthetic 1.8 MB PE with 4,000 functions, capa went past **17 minutes with
1.8 GB** and was interrupted. Hence the ceilings per tool, the queue out of the submission path and "timed
out" as a legitimate result.

**A race that only showed up with the real container:** the second analysis in a row arrived as
"connection dropped", counted as an attempt. The service refused with 503 without reading the body and left with
the file still arriving, and TCP sent an RST. Two fixes: the server reads the body before
refusing and, on the swap, stops accepting connections before leaving; and the API only sends the file after
`/health` says "free" (a GET, safe to repeat). **The reverse proof showed that the second one is the one
that solves it:** with only the server one, the connection still dropped.

**Tests:**
- `capa.test.ts` (29) against the real service, brought up by the runner with the compose hardening and the
  restart: the obfuscated executable (capa finds the obfuscated stack and the XOR; FLOSS returns
  `stack.evil.test` and `http://xor.evil.test/painel`, which become an IOC suggestion), the injection
  (`inject thread`, T1055.003), .NET, ELF (without FLOSS), a new container on every analysis, routes and
  permissions, turned off, service stopped (goes back to the queue; attempts used up, it fails) and a hostile fake
  service (giant field, NUL, nonexistent technique, refusal, hung, connection dropped),
  API restart and cascade deletion.
- `test:images`: with the compose configuration and on the internal network, without root, read-only root,
  `/tmp` without execution, without capabilities, without internet egress, token, only executables, 413 with a
  response for a file above the ceiling, analysis of an ELF with the read-only root and the new container
  free afterwards.
- `capa` screen scenario, and the fixture generators gain the obfuscated executable (x64 and x86) and an ELF.
- **Reverse proof:** without waiting for "free", the second analysis fails; without removing the NUL, Postgres
  refuses; without filtering the techniques, a nonexistent one goes in.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1380 integration
checks in 38 files** (they were 1351 in 37; `capa` has 29); 120 web unit tests;
`test:images` with **82** (they were 71) and `test:smoke` with 101; the **94 screen scenarios** (1679
checks), with the new `capa`; Trivy without findings in the capa image and in the Dockerfiles.

**Left out:** re-analyzing with capa the samples submitted before (each analysis takes minutes; the
analyst requests it from the card), and the capa rules as a condition of the triage rules.

### 7.3 Ghidra headless on demand

If the analysts ask for more than capa: a "Analyze functions" button (analysts only), one container per
analysis without network, and a post-script that exports only the essentials: functions with size, cross
references to the suspicious imports, a summarized call graph and the pseudo-C of only the functions that
call those imports. The `.gzf` project can be downloaded, to open in a local Ghidra.


**Implemented** (the owner asked for Ghidra before ideas 7.4 to 7.15):
- **`ghidra` service** (`apps/ghidra`): the same skeleton as capa (token, refusal reading the body,
  `/health` with the state, one container per analysis) running Ghidra 12.2 headless in **two
  passes**: the first imports, analyzes and runs `ExportDeepLook.java` (program, up to 300 largest
  functions with complexity, who calls the APIs from `sensitive-apis.txt` and the pseudo-C of up to 25 of them
  and of the entry point); the second opens the already saved program, without analyzing again, and runs
  `PackGzf.java`. In the first pass the program is not yet in the project when the script runs: the
  `.gzf` exporter returned `false` silently, and saving from there gave "Location does not exist".
- **Ordinals**: Ghidra shows `Ordinal_115` for ws2_32; the script uses pefile's table from 7.1
  (`pe-ordinals.json`), and `WSAStartup` enters the list of sensitive APIs.
- **Image** (1.45 GB): Debian trixie, OpenJDK 25 (Ghidra 12 asks for 25) without the `jmods` (337 MB that
  only serve `jlink`), Python for the server and Ghidra without documentation, extensions, repository
  server and debugger. The package comes with `ADD --checksum` (the published SHA-256). User
  `ghidra` (uid 10002) with the home in `/tmp`: Java takes `user.home` from `/etc/passwd`, not from
  `$HOME`, and without that Ghidra did not even start.
- **Trivy**: the raw image had 5 findings. The netty ones (1 critical, 3 high) were from `yajsw`, the
  repository server wrapper, which left. The guava 32.1.3 one (high, denial of service when
  deserializing) is from the core: the build replaces it with 33.7.2 and the Maven Central `failureaccess` 1.0.3,
  checked by hash (guava's published SHA-256; `failureaccess`'s by the published SHA-1). The
  `ADD` writes with 600 permission and the Ghidra user could not read the JARs: `install -m 644`. Without an exception
  in `.trivyignore`.
- **API** (`lib/ghidra.ts`, `routes/ghidra.ts`, `GhidraAnalysis` table, migration
  `20261226000000_ghidra_analysis`): **on demand** (only analysts request it; nothing on submission), persisted
  queue, one at a time, the same retries as capa. The client of the two services became
  `lib/analysis-service.ts` (the wait for "free" of 7.2 applies to both). Eligible: PE or ELF up to
  `GHIDRA_MAX_MB`, .NET out (Ghidra does not decompile IL). The GET goes in for API token; the
  project download, no.
- **The `.gzf` has the sample bytes**: it lives in `samples/ghidra/`, so the backup without samples
  leaves it out without changing the backup rule; retention and permanent deletion erase it with the
  file; downloading follows the rule for downloading the sample (whoever submitted it and the analysts) and goes to the
  Audit log.
- **Screen**: "Ghidra analysis" section (status, who requested it, program, functions, the project link
  for whoever can download it, the pseudo-C collapsible per function with copy and who calls it, the largest
  functions); system status with the version and the queue.

**Measured:** from 12 to 18 s on the test executables (Java and the script compilation count on every
analysis) and from 680 to 840 MB of peak; the `.gzf` from 48 to 210 KB. On UPX, Ghidra only sees the
unpacker, as expected: 7.8 (unpacking) is what solves it.

**Tests:**
- `ghidra.test.ts` (31) against the real service, brought up by the runner with the compose hardening: the
  injection (`OpenProcess`, `VirtualAllocEx`, `WriteProcessMemory`, `CreateRemoteThread` and the URL in the
  pseudo-C), the ordinal with a name, the entry point, the `.gzf` under `samples/`, the download (whoever
  submitted it and the analyst yes, another user no, two in the Audit log), ELF, a new container on every
  analysis, .NET and text refused, retention and trash erasing the `.gzf`, turned off, a hostile fake
  service (Ghidra failure, pseudo-C above the ceiling, no project, NUL, hung) and the API restart.
- `test:images`: with the compose configuration and on the internal network, without root, read-only root,
  `/tmp` without execution, without capabilities, without internet, without guava 32 and without `yajsw`, token, only
  executables, an ELF analyzed and packed with the read-only root, and the new container free
  afterwards.
- `ghidra` screen scenario.
- **Reverse proof:** without erasing the `.gzf` in retention or in the trash, without the rule of who downloads and without
  the ordinal table, each one fails its check and only it.
- **A wrong test of mine along the way:** retention did not catch the sample because changing the status rewrites
  `statusChangedAt` in the same update; the date goes in a second update.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1411 integration
checks in 39 files** (they were 1380 in 38; `ghidra` has 31, and `capa` keeps 29 after the
client became `analysis-service.ts`); 120 web unit tests; `test:images` with **93** (they were 82)
and `test:smoke` with 101; the **95 screen scenarios** (1700 checks), with the new `ghidra`; Trivy without
findings in the Ghidra image and in the six Dockerfiles.

**Left out:** decompiling all the functions (it costs minutes and nobody reads it; the `.gzf` is there for
that), the drawn call graph (for now, "called by" in each function) and .NET (7.10).

### 7.4 Triage rules with the signals from 7.1 and 7.2

The triage rules start accepting conditions on the new analysis: capa capability ("inject
thread"), ATT&CK technique, PE alert (tampered signature, resource with an executable, UPX),
indicator in the FLOSS strings. The sample already arrives with the right priority and assignee. As capa
finishes after the submission, the rule has to be evaluated again when the function analysis
completes.

**Implemented:**
- **Six new conditions** (migration `20261227000000_triage_analysis_conditions`): capa found the
  capability (part of the name or namespace; empty = any risky capability), capa ATT&CK technique
  (`T1055` matches the sub-techniques; the code is checked and goes uppercase), signature that does not
  match (tampered or invalid; the unreadable one does not count, because it was not checked), packed (with the
  packer, optional), executable alert (fragment without accents and case; empty = any high
  alert) and indicator in a string that only FLOSS sees.
- **When they run:** the executable ones already apply on arrival (the static analysis runs first). The capa ones
  ask for the rules again when the function analysis completes, and the static re-analysis requested by the
  analyst also runs them. The background backfill of the old samples (7.1) does not run them: it would
  change in bulk the priority of samples already completed without anyone asking.
- **"Risky capability"** is a single list (`lib/capa-risk.ts`), the same as the highlight on the card.
- **Screen** with the six conditions and the value hints; the README gained the triage rules section,
  which did not exist.

**Tests** (`pe-triage.test.ts`, 24): technique validation; with the real executables from 7.1, UPX
(packed and requests administrator, without a high alert), tampered (signature, high alert, P1),
signed and self-signed (do not match) and the unreadable signature (does not match); with a fake capa, nothing from
capa on arrival and everything when it completes (capability, technique by sub-technique, risk, hidden IOC,
P1, the history), running again without repeating, a common capability without risk, the namespace as a value; and the
re-analysis applying a rule created after the submission. Screen scenario of the rules with the technique and the
list of conditions.

**Reverse proof:** without running the rules when capa completes, without excluding the unreadable signature,
treating any capability as risky and without running on re-analysis, each one fails its check.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1435 checks of
integration in 40 files** (they were 1411 in 39; the old `triage-rules` keeps 30); `test:images`
with 93 and `test:smoke` with 101; the 95 screen scenarios (1704 checks).

### 7.5 Explainable risk score

Joins YARA, ClamAV, PE alerts, capa capabilities, FLOSS IOCs and reputation into a score with the
list of reasons and the weight of each one. It suggests the verdict; the analyst still decides.

### 7.6 Related: same certificate and same behavior

"Same certificate" by the signer's fingerprint (an indexed column, like the imphash) and
"same behavior" by the similarity (Jaccard) between the capa capability sets, which catches
the same family recompiled, where the imphash and TLSH fail.

### 7.7 Retro-hunt with capa

Like the YARA retro-hunt: when the capa rules version goes up, re-analyze the samples of a
period, in the same queue.

### 7.8 Unpack and extract

`upx -d` when UPX is detected, `innoextract` and 7-Zip for NSIS and Inno Setup installers, and the
PyInstaller extractor. Each file inside becomes a child sample, like the email attachments, and
goes through everything again. In an isolated service, like capa.

**Implemented:**
- **`unpack` service** (`apps/unpack`, 191 MB): the same skeleton as capa and Ghidra, with the
  unpackers as **plugins** (`unpackers/uNN_name.py`, contract in the folder's `README.md`: the
  first one that recognizes the sample unpacks it). The owner has a Themida unpacker for
  later: if it is static, it goes in as a plugin; if it runs the sample (like most), the place
  is the Proxmox sandbox, and the container (without execution in `/tmp`) would not hold it.
- **Unpackers**, each measured before:
  - UPX (`upx -d` 4.2): all three (x64, x86, DLL). The disguised one (`UPX!` marker erased) `upx` refuses;
    7.1 recognizes it by the code, and the card says why it did not come out.
  - NSIS (7-Zip 25): the payload comes out byte for byte equal, and the installer script along with it.
  - Inno Setup (innoextract 1.9, the latest release): measured with the official installers, it reads the
    format up to 6.2 and refuses 6.3, 6.4, 6.7 and 7.1. The failure says so.
  - PyInstaller (pyinstxtractor 2026.07, GPL-3.0, a script downloaded from the exact commit and checked by
    hash): only the author's `.pyc`; PyInstaller's bootstrap and runtime hooks, the same in every
    program, leave the result.
  - Embedded archive (7-Zip): ZIP, 7z, RAR or CAB attached; what 7-Zip only sees as the executable
    itself does not count.
- **Response in an uncompressed ZIP** with `manifest.json`, read by the submission's ZIP reader (size,
  CRC and a ceiling per file); ceilings of 50 files and 256 MB combined per sample, and what goes over becomes
  "left out" with the reason.
- **API** (`lib/unpack.ts`, `routes/unpack.ts`, `UnpackJob` table, migration
  `20261228000000_unpack_job`): a cheap test on arrival decides who goes in (packer, appended
  data or the NSIS, Inno and PyInstaller markers), the queue is capa's, and **each file becomes a
  child sample through the same path as a submission** (`createFileEntry` started asking only for the log, not the
  request), from the same owner and with the mother's tags. Two generations at most; a file equal to the sample
  itself stays out; the child's name is only the file's (no `../`). The analyst requests it when
  arrival found nothing; again, only without children (otherwise it would duplicate).
- **Screen**: "Unpacking" section with the status, the unpacker and the files (link to the
  child with the verdict, or why it was left out). System status with the unpackers and the queue.

**A finding along the way:** the unpacked UPX is the same program, not the same file (107 bytes
different in 31 KB: zeroed checksum and header directories). And `upx -d` rebuilds the import
table in a different DLL order: **the imphash changes**. The imphash of a binary unpacked by
UPX does not link with the one of the same program compiled without UPX; the set of functions does.

**Tests:**
- `unpack.test.ts` (27) against the real service, with the ceiling at 10 files: who is a candidate; UPX
  (same size and imports as the original, owner, tags, analysis done, the child out of the queue, the
  event in the mother), NSIS (the payload byte by byte), PyInstaller (only `painel.pyc`, with its URL in the
  IOC suggestions), Inno 6.2 (10 children and the rest skipped), Inno 6.4 (the honest failure), disguised
  UPX, attached ZIP, a new container on every job, the routes, the generation limit and a hostile fake
  service (not a ZIP, refusal, file equal to the sample, name with `../`).
- The fixtures gained an NSIS installer (`makensis`), a PyInstaller 6.22.3 program and the
  official Inno Setup 6.2.2 and 6.4.3 installers, checked by the published SHA-256.
- `test:images`: compose configuration, without root, read-only root, `/tmp` without execution, without
  capabilities, without internet, token, an ELF packed by `upx` unpacked with the manifest, and the
  new container afterwards.
- `unpack` screen scenario.
- **Reverse proof:** without the generation limit, without skipping the equal file, without the reason for
  disguised UPX, with the path in the name and without the PyInstaller filter, each one fails its check.

**Validation:** `format:check`, `lint` and `build` clean in the API and the web; **1462 integration
checks in 41 files** (they were 1435 in 40); 120 web unit tests; `test:images` with **102**
(they were 93) and `test:smoke` with 101; the **96 screen scenarios** (1718 checks), with the new `unpack`;
Trivy without findings in the unpack image and in the seven Dockerfiles.

**Left out:** Inno Setup 6.3 onward (innoextract does not read it; look again when a new version of it comes out),
decompiling PyInstaller's `.pyc` (for now, its strings enter the static
analysis) and the dynamic unpackers (Themida, VMProtect), which need to run the sample.

### 7.9 Detect It Easy

Compiler, packer, installer and .NET obfuscator by mature signatures (far beyond UPX
by the entry code of 7.1). It has a command-line version for Linux; in a container like
capa's.

**Implemented:**
- **Detect It Easy 3.21** (MIT; 4.0.0 came out 4 days before and stayed for later, by the two-week
  rule), in the `unpack` service: the official Debian 13 package, checked by the published SHA-256,
  but only `diec` and the signature database. The package asks for the whole Qt5 (the probe image was
  650 MB); `ldd` showed that `diec` only loads Qt Core, Qt Script and glib, and the result came out **identical**
  in the 11 test executables with the full package and with the slim one (the image went from
  191 to 294 MB).
- **What it brings** in the test executables: "MinGW (GCC 13)", "UPX(4.24)[NRV, brute]", the disguised
  UPX as "UPX(3.91+)[modified]", NSIS 3.11, Delphi 10.3 and the Inno Setup installer's signature,
  .NET; and a false positive ("Go" in the PyInstaller program), which the screen treats as a clue.
- **Every executable goes into the queue** (PE, ELF, Mach-O, APK, JAR), not only those that looked
  packed: DIE identifies, and the unpackers act when they recognize. From the second
  generation on, `?unpack=0`: only identifies.
- **Without an unpacker, the card says why:** protector ("needs an unpacker that runs the
  sample"), packer without a static unpacker, the altered UPX, or "nothing to unpack".
- **Triage rule** "Detect It Easy detected" (migration `20261229000000_detect_it_easy`, which
  also stores the detections, the version and an eventual DIE error in the job), evaluated when the
  identification finishes.
- **A performance adjustment the test showed:** with the identification of every executable, each
  extracted file went back into the queue only to be identified, and each round costs a new container
  (10.5 s or more): `unpack.test` went past 10 minutes. Now the service identifies the children
  in the same round (about 150 ms each) and says whether any unpacker recognizes them; the child is born
  with the job completed and only goes back into the queue if there is something to unpack. Each
  real unpacking still happens in a clean container.
- **Updating DIE is manual:** `diec` is not registered in dpkg (only the binary and the database come out of the
  package), so Trivy scans the Qt libraries that come from Debian, but not DIE itself, and
  Dependabot does not see an `ADD` of a release. When changing version: URL, SHA-256 and the `health.die` of
  `test:images`, together.
- **A defect that the hostile test found:** in 7.8, the generation limit was applied in the queue (the grandchild
  did not enter). With the identification of every executable, the grandchild enters and the API sends `?unpack=0`;
  but a fake service that ignored the parameter and returned files created child of child without end
  (the test hung until the runner's timeout). The API now discards whatever comes with `unpack` off,
  without depending on the service, and the test counts the generations.

**Tests** (`unpack.test.ts`, now 33): who goes into the queue; the UPX detections (with the version and the
method) and the NSIS ones; the rule by DIE (empty and by the fragment "Nullsoft"), in the mother and not in the child;
the child identified in the same round (`attempts` 0); the common executable and .NET identified with
nothing to unpack; the third-generation grandchild only identified; and, with a fake service, the notes
of protected (Themida) and of packer without a static unpacker (MPRESS) and a service that
ignores `?unpack=0` (the API stops at two generations). Reverse proof: without the identification in the same
round, without the generation lock in the API, or with the empty value of the rule applying to any
detection, each one fails its own check (without the lock, the test hangs). `test:images` checks
the DIE version and the UPX detection with the read-only root. Screen scenarios of the unpacking
(DIE, the highlighted protector) and of the rules.

### 7.10 Decompile .NET

`ilspycmd` returns readable C# from the classes that use the sensitive calls already detected in 7.1 and
7.2. For .NET it is more useful than Ghidra, which does not decompile IL.

### 7.11 Configuration extraction from known families

Extractors in the *maco* format (CAPE's) pull C2, keys and mutexes from common families (AsyncRAT,
Remcos, AgentTesla...). It is the most reliable IOC and goes straight to the MISP/TAXII feed. The cost is
maintaining the extractors.

### 7.12 Emulation with Speakeasy

Speakeasy (Mandiant) emulates the PE or a shellcode and returns the API call sequence, without a VM:
it sits between the static analysis and the Proxmox sandbox and can run by itself in the queue.

### 7.13 APK, JAR and Mach-O

They are already detected by the real type, but not analyzed. Androguard gives permissions, components and
sensitive calls of the APK; the JAR and the Mach-O, the manifest, the classes and the libraries.

### 7.14 Deeper Office and PDF

`oletools` (olevba with deobfuscation, XLM 4.0 macros, DDE) next to the TypeScript parser that already
exists (item 70).

### 7.15 Suggest a YARA rule from the sample

A draft with unique strings, imphash and code fragments, for the analyst to review and save
as a team rule.

---

## 8. Fifth batch: November review

A reading of the newest code (the `unpack` service, the capa and Ghidra queues, the client of the
services, the compose, `env.ts` and the access control) looking for defects, not functionality.
Five fixes and four tidying-ups came out. The rest of the API and the web were seen only by sampling.

### 8.1 Analysis and capture queues: a database outage no longer brings the API down

The `wake()` of the three queues (`lib/capa.ts`, `lib/ghidra.ts`, `lib/unpack.ts`) did
`worker = drain().finally(...)` without a `catch`. `drain` handles the failure of a job, but not that of
`claim()` itself nor that of the `finish()` inside its `catch`: with the database restarting or the pool
exhausted, the promise rejected with nobody listening, and Node terminates the process on an unhandled
rejection. As `wake` runs every 15 s, any Postgres drop killed the API, and with it the
submissions in progress and the sandbox consoles. The `void runCapture(...)` of the capture route had the
same design (the initial `findUnique` and the `fail()` are outside the `try`).

**Implemented:**
- `catch` in the three `wake()`: it records `the queue stopped; back on the next tick` and the job stays
  pending. In the capture route, `catch` in `runCapture`; in the retroactive YARA, the `catch` that records
  the scan failure can no longer reject itself.
- **No** general `process.on('unhandledRejection')` was put in: it would hide the next case instead
  of showing it, and the other background loops (retention, deadline, integrity, sessions, LDAP,
  backup, YARA update, the boot re-analyses) already handle their own error, checked one by
  one. **Left out:** in the sandbox, the provisioning `catch` still records an event after
  marking the session as failed; if the database drops exactly between the two writes, it is the same
  defect, in a window of milliseconds.
- Test in `unpack.test.ts`: with the job's `findFirst` rejecting, there is no unhandled
  rejection, the job stays `PENDING` and the next tick completes it.

### 8.2 Unpacking that fails halfway no longer duplicates the children

If the creation of a child threw halfway (storage or database down on the third of ten), the
job became `FAILED` without recording the list, the children already created kept existing, and the route
released a new request because it only looked at `job.files`: the second request duplicated the first ones.

**Implemented:**
- The queue records the children already created on failure, with the reason
  (`failed to create the child samples (2 of 10 created)`): the card shows them.
- The `POST /api/entries/:id/unpack` route also refuses (409) when child samples already exist, with
  or without the list in the job, as `extract-image` already did.

### 8.3 `unpack` service ceilings aligned with what the API accepts

The service accepted any `UNPACK_MAX_FILES`, and the API validates the manifest with at most 100
files: with 150, every unpacking became "unexpected response format from the service", without a clue
of the reason. The list of what was left out had the same problem above 10 thousand lines.

**Implemented:** the service limits `UNPACK_MAX_FILES` to 1–100 (and warns in the log when it adjusts) and
cuts the list of what was left out at a thousand lines, with a last one saying how many were missing.
`test:images` gained no check for this: the ceiling is one line, and the 100-file path
would cost a new test installer.

### 8.4 Default database and MinIO password refused in production

`env.ts` refused `SESSION_SECRET` and the four tokens with the public value, but the database's
`deeplook` password and MinIO's `deeplook123` only became a warning in Administration > Status. The
MinIO console stays at `127.0.0.1:9001`: with the public password, whoever reaches that port downloads
all the samples.

**Implemented:**
- Both enter the production refusal (the compose ones and the `.env.example` ones), through the same
  lists the status uses. `ALLOW_INSECURE_DEFAULTS=true` keeps releasing the demonstration.
- **Care for whoever updates:** Postgres stores the password when the volume is created. In an installation
  that already has data and uses the default password, changing only `.env` would lock the API out of the database. The
  refusal message says so and the [checklist](implantacao.md) gained the `\password` step.
- The image tests and the smoke started bringing up MinIO with its own password.

### 8.5 Integration test types in CI

Closes [Finding J](#j-the-integration-tests-do-not-go-through-the-type-check). The eight errors
were six leftover `@ts-expect-error` directives (the change of the S3 endpoint in the tests is no longer
a type error) and two untyped indexes in `yara-update.test.ts`. `npm run typecheck:tests` runs
`tsc -p tests/tsconfig.json`, and CI runs it in the API job.

### 8.6 Postgres and ClamAV pinned by digest

`postgres:16-alpine` and `clamav/clamav:1.5` were floating tags, while MinIO already came by
digest. Now compose brings the tag **and** the digest, and `scripts/pin-images.mjs` checks whether the tag still
points to the same image (`--write` rewrites it). Dependabot gained the `docker-compose`
ecosystem. **The price:** without a remote, the security fix for those images only arrives when
someone runs the script; it is in the "To resume" block.

### 8.7 Sample creation outside `routes/entries.ts`

`createFileEntry`, the `.eml` reading, the arrival triage and the unpacker's child creator
went to `lib/entry-create.ts` (251 lines; the routes file dropped from 1,710 to
1,480). A change of place only: the unpacker queue uses that creation in the background, and
`index.ts` imported from a route to bring up a queue.

### 8.8 Commit message

The subjects reached 4,600 characters on a single line: `git log --oneline` and `git blame` became
unreadable. From now on: **subject of up to 72 characters** (`type: what changed`), a blank
line, and the detail (the why, what was measured, the reverse proof, the validation) in the body, in
paragraphs. The existing history stays as it is: rewriting it would change all the hashes this
plan cites.

### 8.9 Repository on a private remote

**Pending, depends on the owner.** CI (`.github/workflows/ci.yml`), the weekly Trivy and Dependabot
only run on a remote, and today the code exists only on this disk. A private repository turns on the
three at once. Only the address is missing: `git remote add origin <url> && git push -u origin main`.

**Batch validation:** `format:check`, `lint`, `build` and `typecheck:tests` clean in the API;
**1478 checks in 41 files** of integration (they were 1468; `unpack` went from 33 to 38 and
`secrets` from 15 to 20), `test:images` with 102 and `test:smoke` with 101, all green. Reverse
proof in `unpack.test.ts`: without the `wake` `catch`, without recording the children on failure and without the
child count in the route, the three corresponding new checks fail and only them (the fourth,
"existing children without the list", was not isolated: in that round the previous request had already
left a job in the queue, and the 409 came for that reason). **They did not run** in this batch, for not
having code touched: the web tests, the screen scenarios and Trivy.

---

## Findings along the way

Two things showed up while building the CI and needed fixing first, otherwise the pipeline
would be born red — and a red pipeline on the first day teaches everyone to ignore it.

### A. `access-lifecycle.test.ts` outdated since commit 385da17

The fourth Strix round deliberately changed the CAPTCHA blocking: a new device
on an account with many failures started receiving **428 with `captchaRequired`** instead of
**429**, so that someone from outside cannot lock the account owner out. The test kept
requiring 429 and failed in three checks — `new IP without a cookie is blocked`, `cookie from another
account does not work` and `forged cookie does not work`.

Confirmed as **prior to this batch**: the same three fail on the clean HEAD, with the
work stashed. The assertions started checking 428 **and** `captchaRequired:
true` (before they only looked at the code), and the first got a name that says what happens:
"new IP without a cookie falls into the CAPTCHA". There are 45 checks now, all green.

### B. `format:check` failed 20 files, 12 of them only because of line endings

The repository has 144 CRLF files (the project is developed on Windows), and Prettier
without `endOfLine` assumes `lf` and fails all of them. Normalizing the 144 would be a huge diff, which
would bury the rest and fight with the flow of whoever works on Windows.

The fix was `"endOfLine": "auto"` in `.prettierrc.json` — Prettier's own recommendation
for a mixed repository. With that, 12 files with a **real** deviation remained (a line
above the 100 columns), fixed with `npm run format`; the diff stayed small and contained,
without any line-ending change. `apps/api/rules` entered `.prettierignore`, because
`.gitattributes` orders the rule packs to be copied without alteration — including at the line ending.

There was also an import order error in `iocs.test.ts`, fixed with `eslint --fix`.

### C. Node 26's npm 11 does not run an install script without approval

Raising the images and CI from Node 22 to 26 brought `npm` 11, which **blocks by default the
dependency install script** (`postinstall`, `install`) and only runs them after an
`npm install-scripts approve`. In `npm ci` that is a warning, not an error, and the build does not depend on it: the
esbuild binary comes through the per-platform package (`@esbuild/linux-x64`), not through the script; the
Prisma client is generated in its own step (`prisma generate`); and Carbon's telemetry
`postinstall`s are exactly what you do not want to run. The record stays for when someone sees the warning
and thinks something broke.

`apps/capture` does not change Node: it runs on the Playwright image
(`mcr.microsoft.com/playwright`), which brings its own runtime; Dependabot already watches that
image. And the tag size test in `decryptSecret` (ux-backlog) now runs on Node 26, which
refuses a short tag by itself — `authTagLength: 16` remains the real defense; the Node
22 layer was the redundancy that is lost.

### D. The `npm` built into the images was what Trivy flagged

The six findings of the API and capture images (`undici` and `brace-expansion`, the same versions
in both) looked like a project dependency and were from the **`npm` that comes inside the Node image**:
the path in the reports was `/usr/local/lib/node_modules/npm/...`. The runtime only runs `node`
(the entrypoint calls `node_modules/.bin/prisma`), so the honest fix was to remove `npm` from the
final image, and not to ignore the finding. On top of that the image gets smaller and without an installation
tool that an attacker would use. The capture image, by the way, already runs Node 26.

### E. The secret scanner and the Playwright image

In the first round, Trivy failed the capture without any CVE: the **secret scanner** found
an Azure SAS token in the npm cache and logs (`/root/.npm`) that Microsoft's base image
brings written in one of its layers (Microsoft installs yarn through a signed link from the feed). Deleting
the directory in the next layer **does not remove the finding**: the scanner looks at every layer. The way out was a
**narrow** exception in `trivy.yaml` (only that directory; a private key elsewhere
keeps failing, and that was tested), keeping the `rm` so our own cache does not stay
written in our layer.

### F. A duplicate `From:` changed owner with `postal-mime` 3

With `postal-mime` 2, an email with two `From:` showed the **last** one (the attacker's); from
3.0 on the **first** one applies, as RFC 5322 requires. No test covered this. `eml-headers.test.ts`
fixes the behavior (and fails on 2.7.6, which proves it distinguishes the versions), together with a
repeated `Subject`, a folded `Subject`, a `Received` folded over several lines (the normal thing in a real
email) and a repeated `Authentication-Results`. **It stays as an idea** to flag on the card a duplicate `From:` or
`Subject:`: it is, by itself, an indicator.

### G. What the survey of the previous batch did not catch

When really checking the Node 26 batch, what the reading had not shown appeared: the
`node:22-slim` left in the `images.mjs` echo (the survey only looked at Dockerfile, yml and md, and
not the `.mjs` files), the two glued lines of the API `.dockerignore` (`*.logsrc/generated`), the
`test:images` and `test:smoke` that **never ran in CI** (only by hand) and, therefore, no image PR
from Dependabot proved that the image still built. Item 6.8 closes that last hole.
A lesson that applies to the next changes: run what exists before saying there is no pending item.

### H. The screen test mock is part of the contract

The 91 screen scenarios passed with React 19 and Vite 8, except `api-tokens`: the new
*Purpose* column shifted the indexes the scenario compared, and the mock returned tokens without `scope`.
It was a regression **of mine**, caught exactly by that suite (and it is the argument for running it entirely
after a dependency change, and not only the smoke). The mock and the scenario were updated and
gained 8 checks of the feature.

### I. vuln-0008 was not closed in the fourth Strix round

Commit 385da17 closed eight of the round's nine findings and left vuln-0008 (X-Forwarded-For
accepted from any neighbor on a private network). `TRUST_PROXY` remained
`loopback,linklocal,uniquelocal`, and the plan recorded neither the fix nor the decision to
accept the risk. The report itself said what would raise the severity: the API sharing a network with
an untrusted container. That was the case of `capture`, and with the Chromium without a sandbox. Item 6.15
closes it. Lesson: when closing a round, check the findings one by one against the code, and not by the
commit message.


### J. The integration tests do not go through the type check

Found in 7.1 and **fixed in item 8.5**. The tests run through `tsx`, which does not check types, and neither `build`
nor CI runs `tsc -p tests/tsconfig.json`. That command reports 8 errors in four old
files (`health`, `integrity-scrub`, `status-token` and `yara-update`: leftover
`@ts-expect-error` directives and untyped indexes). The new file (`pe-analysis.test.ts`) was
left without errors. Fixing the four and putting the command in CI is a small item, if it is worth it.

### K. The test MinIO accumulated the samples of every round

Found in 7.2 and fixed. Each integration file runs on a new database, but the test MinIO
stays up between rounds (only `--clean` removes it), and the bucket kept everything: 4.8 GB, 606 MB of it
in `samples/`. The backup with samples lists the whole bucket (by design: in production it is the real
bucket) and went past 512 MB, the largest text that Fastify's `inject` builds, and `backup.test` failed
with "Cannot create a string longer than 0x1fffffe8 characters". It was not the code: it was state
from past rounds. `tests/run.mjs` now recreates MinIO on every round (the container has no
volume, so it comes back empty), and `backup.test` passed entirely again (81).
