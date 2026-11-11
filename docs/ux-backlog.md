# 🧭 UX and usability backlog

> 🇧🇷 [Leia em português](ux-backlog.pt-BR.md)

Ideas raised after the visual overhaul in the HP Service Manager 9 style
(see [`docs/interface-hpsm.md`](interface-hpsm.md)). They all follow the same principle:
**improve the use without modernizing the look** — the patterns cited (confirmation
dialog, queues with counters, activities tab, Previous/Next) exist in
HPSM itself.

**Legend** — Priority: 🔴 high · 🟡 medium · ⚪ low. Effort: **P** (hours),
**M** (1–2 days), **G** (several days, involves the database). Status: ✅ done · ⬜ pending.

## Summary

| # | Idea | Priority | Effort | Area | Status |
|---|---|---|---|---|---|
| 1 | Password reset by the admin | 🔴 | P–M | Admin / API | ✅ |
| 2 | Confirmation when saving the triage | 🔴 | P | Sample | ✅ |
| 3 | Confirmation dialog in destructive actions | 🔴 | M | Admin / Sandbox | ✅ |
| 4 | Unsaved changes warning | 🔴 | M | Forms | ✅ |
| 5 | Filters, sorting and page in the URL | 🔴 | P–M | Lists | ✅ |
| 6 | "My queue" with counters in the navigator | 🟡 | M | Navigator / API | ✅ |
| 7 | Assigning a sample to an analyst | 🟡 | G | Sample / database | ✅ |
| 8 | "History" tab (audit) on the sample | 🟡 | G | Sample / database | ✅ |
| 9 | Previous / Next on the sample card | 🟡 | M | Sample | ✅ |
| 10 | Duplicate detection by SHA-256 | 🟡 | M | Submission / API | ✅ |
| 11 | Drag and drop the file | ⚪ | P | Submission | ✅ |
| 12 | Copy buttons (hash, URL, IOCs) | ⚪ | P | Sample / Reports | ✅ |
| 13 | Notices on sign-in ("your completed samples") | ⚪ | M | Home Page / API | ✅ |
| 14 | Sandbox deadline in sight | ⚪ | P–M | Sandbox | ✅ |
| 15 | Keyboard shortcuts | ⚪ | P | Global | ✅ |
| 16 | Grid rows navigable by keyboard | ⚪ | P | Lists | ✅ |
| 17 | Export the filtered list to CSV | ⚪ | M | Lists / API | ✅ |
| 18 | Attempt limit on login and password change | 🔴 | P | Security / API | ✅ |

**All 18 items were implemented** — each item below carries an
**Implemented** block with what changed and the known limits.

The following batches were also completed and are further down:
[Second batch — ideas 19 to 30](#second-batch--ideas-19-to-30),
[Third batch — ideas 31 to 45](#third-batch--ideas-31-to-45) and
[Fourth batch — ideas 46 to 50](#fourth-batch--ideas-46-to-50), plus the standalone item
[51. Password policy](#51-password-policy),
[Fifth batch — ideas 52 to 65](#fifth-batch--ideas-52-to-65) and
[Sixth batch — ideas 67 to 80](#sixth-batch--ideas-67-to-80) (79 is deferred: there is no
SMTP). The [Seventh batch — ideas 81 to 94](#seventh-batch--ideas-81-to-94) is implemented, and the
[Eighth batch — items 95 to 124](#eighth-batch--items-95-to-124) comes from the 10/31/2026 sweep.

---

## 🔴 High priority

### 1. Password reset by the admin
- **Problem:** the login says "Ask an administrator to reset your password", but
  the Admin has no such action.
- **Proposal:** a **Reset password** button on the user row (Admin › Users) that
  generates a temporary password, shows it once in the message bar (like the
  activation key created) and ends the user's sessions. Optional: force the
  change on the next login.
- **Where to change:** `apps/api/src/routes/admin.ts` (new
  `POST /api/admin/users/:id/reset-password`, reusing `hashPassword` and the
  `session.deleteMany` of `routes/me.ts`); `apps/web/src/pages/AdminPage.tsx`.
- **Careful:** a destructive action → use the dialog from idea 3; do not record the password
  in a log.
- ✅ **Implemented:** `POST /api/admin/users/:id/reset-password` (refuses your own
  account, generates a 14-character password with `generateTemporaryPassword`, ends the
  sessions); a **Reset password** button in Admin › Users, with confirmation and the temporary
  password shown once in the message bar. The mandatory change on the next
  login came later, in item 48.

### 2. Confirmation when saving the triage
- **Problem:** in Sample › Analysis, changing Status or Verdict saves right away, without
  feedback — the user is left not knowing whether it saved.
- **Proposal:** after the `PATCH`, show `HpsmMessage kind="success"` "Record
  updated." in the message bar (HPSM pattern).
- **Where to change:** `quickUpdate` in `apps/web/src/pages/EntryDetailPage.tsx`.
- ✅ **Implemented:** "Record updated." after each Status/Verdict change.

### 3. Confirmation dialog in destructive actions
- **Problem:** Revoke key, Suspend user and Discard VM execute with a single
  click.
- **Proposal:** an `HpsmConfirm` component in the HPSM style (box with a gradient
  header, warning icon, gray **Yes** / **No** buttons, Esc = No, initial focus
  on No) and a `useConfirm()` hook that returns a `Promise<boolean>`.
- **Where to change:** new `components/HpsmConfirm.tsx`; used in `AdminPage.tsx`,
  `SandboxPanel.tsx` and `SandboxConsoleWindowPage.tsx`.
- ✅ **Implemented:** `ConfirmProvider` (in `main.tsx`) + `useConfirm()`. They ask for
  confirmation: Revoke key, Suspend user, Reset password and Discard environment
  (panel and console window). Reactivate does not ask.

### 4. Unsaved changes warning
- **Problem:** closing the document tab or navigating in the middle of a report or
  submission loses what was typed.
- **Proposal:** a `useUnsavedChanges(dirty)` hook that (a) asks "Save the
  changes?" when closing the document tab, (b) activates the browser's `beforeunload`.
- **Where to change:** `components/workspace.tsx` (the `close` consults the "dirty" tabs),
  `SubmitPage.tsx`, `EntryReportsTab.tsx` and `UserPage.tsx`.
- **Careful:** the app uses `<BrowserRouter>`/`<Routes>`; React Router's `useBlocker`
  requires a *data router*. Start with the tab closing and the `beforeunload`, or
  migrate to `createBrowserRouter`.
- ✅ **Implemented:** `main.tsx` migrated to `createBrowserRouter` (a `*` route that
  renders the `App`; the `<Routes>` stay the same). Hook
  `components/useUnsavedChanges.ts` (`useBlocker` + `beforeunload`) with the dialog
  "Unsaved changes — [Discard] [Keep editing]". It applies to switching
  screen, switching internal tab (`?tab=`), Back and closing the document tab — the active
  tab only leaves the strip when the navigation happens. Applied in Submit Sample, New
  report, Change password and Preferences. "Sign out" also asks since item 47.

### 5. Filters, sorting and page in the URL
- **Problem:** when switching document tab the page is recreated and loses the search,
  filters, sorting and page.
- **Proposal:** keep `q`, `type`, `status`, `verdict`, `sort`, `dir` and `offset` in
  `?query` (`workspace.tsx` already reopens each tab at the last URL). On top of that, the link of
  a search can be shared.
- **Where to change:** `GlobalHistoryPage.tsx` and `MyUploadsPage.tsx` (swap the `useState`
  for `useSearchParams`, keeping the search *debounce*).
- ✅ **Implemented:** `components/useEntryListState.ts` hook, used by the two lists.
  Default values do not appear in the URL; "Clear" zeroes the search and filters and keeps the
  sorting.

### 18. Attempt limit on login and password change
- **Problem:** there is no attempt limit on `/api/auth/login` or on
  `/api/me/password`.
- **Proposal:** `@fastify/rate-limit` on those routes (e.g. 5 attempts / 5 min per IP +
  email) with the message "Too many attempts. Try again in a few minutes."
- **Where to change:** `apps/api/src/index.ts`, `routes/auth.ts`, `routes/me.ts`.
- **Careful:** behind the Cloudflare Tunnel, configure `trustProxy` to get the real
  IP.
- ✅ **Implemented:** `@fastify/rate-limit` (only on the routes that ask for it) with the helper
  `lib/rate-limit.ts`: 5 attempts every 5 min, keyed by **email** on login and by
  **session** on password change — not by IP, because the `X-Forwarded-For` can be
  forged. Response 429 "Too many attempts. Try again in N minutes."
  Accepted side effect: someone can lock the login of an email for 5 minutes.

---

## 🟡 Analyst workflow

### 6. "My queue" with counters in the navigator
- **Proposal:** a **Queues** folder in the System Navigator with counters, like HPSM's
  queues: "Pending (12)", "In analysis (3)", "Completed today (5)". Each item opens the
  Global History already filtered (depends on idea 5).
- **Where to change:** API `GET /api/entries/counts` (a `groupBy` per status);
  `HpsmSidebar.tsx` (leaves with a counter, periodic update through React Query).
- ✅ **Implemented:** a **Queues** folder (analysts and admins) with **Pending**,
  **In analysis** and **Completed** — status dot and counter; each one opens the
  Global History with `?status=`. Counters update every minute and after
  triage. The navigator highlight started choosing the most specific leaf that
  matches the URL (the queue, not the History). "Completed today" became "Completed"
  (there is no date filter in the API yet); "Assigned to me" depends on idea 7.

### 7. Assigning a sample to an analyst
- **Proposal:** an **Assignee** field in the triage and a "Take analysis" action in the toolbar,
  preventing two analysts on the same sample; an "Assignee" filter in the lists; an
  "Assigned to me" queue (idea 6).
- **Where to change:** `Entry.assigneeId` in `schema.prisma` + migration; `PatchSchema` in
  `routes/entries.ts`; `EntryDetailPage.tsx`; `EntriesTable.tsx` (column).
- ✅ **Implemented:** `Entry.assigneeId` (migration
  `20261022000000_assignee_and_entry_events`); `PATCH /api/entries/:id` accepts
  `assigneeId` (only analysts assign, and only to active analysts/admins);
  `GET /api/analysts`; `assignee=me|none` filter and sorting by the Assignee column.
  On the sample: a **Take analysis** button in the toolbar, an **Assignee** field in the triage and
  "Assignee" in the summary. Lists with an Assignee column and filter; an
  **Assigned to me (N)** queue in the navigator (open ones, without the completed).

### 8. "History" tab (audit) on the sample
- **Proposal:** a **History** tab with the sample timeline: submission, status/verdict
  changes (from → to), published reports, sandbox open/discard —
  who and when. It is the equivalent of HPSM's "Activities" tab.
- **Where to change:** an `EntryEvent` model + migration; recording at the change points in
  `routes/entries.ts`, `routes/reports.ts` and `routes/sandbox.ts`;
  `GET /api/entries/:id/events`; a new tab in `EntryDetailPage.tsx` using the grid.
- ✅ **Implemented:** an `EntryEvent` model (helper `lib/events.ts`) recorded on submission,
  on status/verdict/assignee changes, on reports (draft/published — publishing
  also records the status and verdict changes), and on the sandbox open,
  discard, expiry and **provisioning failure** (expiry and failure with
  author "System"; the failure keeps the error message — migration
  `20261023000000_sandbox_failed_event`). The migration creates the
  "Sample submitted" event for the samples that already exist. **History** tab on the
  sample (Date · User · Event), visible to everyone.

### 9. Previous / Next on the sample card
- **Proposal:** ◀ ▶ buttons in the sample toolbar to go through the results of the
  list it was opened from, without going back to the list.
- **Where to change:** `EntriesTable.tsx` keeps the ids of the current page (e.g.
  `sessionStorage` or the workspace context) when opening a row;
  `EntryDetailPage.tsx` reads them and shows the buttons (disabled at the ends).
- ✅ **Implemented:** `components/entryNav.ts` keeps the page sequence when opening
  a row; the sample toolbar shows **◀ Previous / Next ▶** (disabled
  at the ends) and "Record N of M". The record switches **in the same document tab**
  (if the destination already had a tab, the origin one closes) and keeps the internal tab (`?tab=`).
  Limit: the sequence is the current page of the list (it does not move to the next page).

---

## 🟡 Sample submission

### 10. Duplicate detection by SHA-256
- **Proposal:** when choosing the file, compute the SHA-256 in the browser
  (`crypto.subtle.digest`) and query the API; if it already exists, warn in the message
  bar "This sample was already submitted" with a link to the record and the verdict.
  The submission stays allowed (a new context may be useful).
- **Where to change:** `SubmitPage.tsx`; API with an **exact** search by hash (today `q`
  searches with `contains`), e.g. `GET /api/entries?sha256=`.
- **Careful:** large files — compute on demand and show `HpsmLoading`.
- ✅ **Implemented:** exact `sha256` filter in `GET /api/entries`; in Submit Sample
  the hash appears in the form and, if it already exists, a notice with link and verdict. Without
  `crypto.subtle` (HTTP without TLS outside localhost) the check is skipped.

### 11. Drag and drop the file
- **Proposal:** a drop area in the "File data" section showing the name, size and
  (with idea 10) the hash before submission.
- **Where to change:** `SubmitPage.tsx` (Carbon's `FileUploaderDropContainer` or an area
  of its own with the HPSM skin).
- ✅ **Implemented:** our own `components/HpsmFileDrop.tsx` in place of Carbon's
  `FileUploader`: area "Drag the file here or [Select file]"
  (highlight when dragging over it) and, after that, the row with name, size and "Remove".
  The hash and the duplicate notice (idea 10) appear right below.

---

## ⚪ Polish

### 12. Copy buttons
- **Proposal:** a copy icon next to SHA-256, URL and IOCs, with "Copied." in the
  message bar.
- **Where to change:** the `copyable` prop in `HpsmReadonly` (`components/HpsmForm.tsx`) using
  `navigator.clipboard`; used in `EntryDetailPage.tsx` and `EntryReportsTab.tsx`.
- ✅ **Implemented:** `components/CopyButton.tsx` component (16px icon; confirms
  "Copied" on the button itself, without polluting the message bar; without the Clipboard API it falls
  back to `execCommand('copy')`) and the `copyable` prop in `HpsmReadonly`. Used on the sample's SHA-256 and
  URL, the report IOCs, the SHA-256 computed in Submit Sample and, in
  Admin, on the key codes, the created key and the temporary password.

### 13. Notices on sign-in
- **Proposal:** on the Home Page, the message "2 of your samples were completed since
  your last visit" with a link to My Uploads.
- **Where to change:** `User.lastSeenAt` (or the previous session date) + an updates endpoint;
  `WelcomePage.tsx`.
- ✅ **Implemented:** `User.lastSeenAt`/`previousSeenAt` (migration
  `20261024000000_user_visits`), updated in `GET /api/auth/me`: opening the app after
  more than 30 min idle counts as a new visit. `GET /api/me/updates` uses the
  history (idea 8) — the user's samples completed by someone else after the
  previous visit. The Home Page shows the notice in the message bar and the section
  "News since your last visit" (sample, verdict, date).

### 14. Sandbox deadline in sight
- **Proposal:** the remaining time in the document tab title of the sample
  ("installer.exe · 12min") and a notice in the message bar 5 minutes before the VM
  expires, with a shortcut to "Extend deadline".
- **Where to change:** `useSandboxCountdown` (`components/sandboxStatus.ts`) +
  `useWorkspaceTitle` in `EntryDetailPage.tsx`; notice in `SandboxPanel.tsx`.
- ✅ **Implemented:** `useMinutesLeft` (updates every 15s). With the environment
  running, the document tab shows **"12min · name"** (deadline before the name, so it does not
  disappear in the cut) and goes back to the simple name when leaving the screen (`useWorkspaceTitle` gained
  `titleOnLeave`). In the last 5 min the message bar warns "expires in N min" with
  the **Extend deadline** link — visible in any tab of the sample.

### 15. Keyboard shortcuts
- **Proposal:** `/` focuses the list search, `Alt+N` opens Submit Sample, `Ctrl+S`
  saves the open form (toolbar), `Alt+W` closes the document tab. List on the
  Home Page (Tips section).
- **Where to change:** a global *handler* in `AppShell.tsx`; registration of the current
  "save" through context by the pages with a form.
- ✅ **Implemented:** `components/shortcuts.tsx` (`ShortcutsProvider` in the shell +
  `useSaveShortcut`). `/` focuses the search, `Alt+N` opens Submit Sample, `Alt+W` closes the
  document tab (respecting the unsaved changes warning) and `Ctrl+S` saves
  Submit Sample, New report, Change password and Preferences — the buttons show the
  shortcut in the tip. List of the shortcuts on the Home Page (Tips).

### 16. Grid rows navigable by keyboard
- **Proposal:** focusable rows, ↑↓ arrows move the focus, Enter opens the sample; the row
  with focus highlighted like HPSM's selection. Today it only opens with the mouse.
- **Where to change:** `EntriesTable.tsx` (`tabIndex`, `onKeyDown`, *roving tabindex*).
- ✅ **Implemented:** only one row enters the Tab; ↑ ↓ Home End move the focus; Enter or
  Space open the sample; the focused row uses the selection highlight
  (`.hpsm-grid-row`).

### 17. Export the filtered list to CSV
- **Proposal:** an **Export CSV** action in the filter row (or the "More ▾" menu),
  respecting filters and sorting.
- **Where to change:** API `GET /api/entries/export.csv` with the same parameters as
  `ListQuery` (without the 100 limit); button in `HpsmFilterBar`.
- ✅ **Implemented:** `GET /api/entries/export.csv` reuses the list filters
  (`listWhere`) and the sorting, without pagination (up to 10 thousand rows). CSV for Excel
  in Portuguese (`;` and UTF-8 BOM), Portuguese labels and protection against formula
  injection (`lib/csv.ts`). **Export CSV** button in the filter bar of the Global
  History and of My Uploads.

---

## Second batch — ideas 19 to 30

New ideas after the first batch, all based on patterns that exist in
HP Service Manager 9 itself (indicated in each item).

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 19 | List with a detail pane | list and record on the same screen | 🟡 | M | ✅ |
| 20 | Bulk update | Mass Update | 🟡 | M | ✅ |
| 21 | Saved views and Favorites | Favorites and Dashboards | 🟡 | M–G | ✅ |
| 22 | Related records | Related Records tab | 🟡 | M | ✅ |
| 23 | Updates / comments on the sample | Activities → Update | 🟡 | M | ✅ |
| 24 | Age in the queue and deadline alert | SLA clocks | ⚪ | P–M | ✅ |
| 25 | Session expiring warning | timeout warning | ⚪ | P | ✅ |
| 26 | HPSM-style field validation | required fields highlighted | 🟡 | P | ✅ |
| 27 | Quick search in the masthead | search/go to record | ⚪ | P | ✅ |
| 28 | "More ▾" menu in the toolbar | More Actions | ⚪ | P | ✅ |
| 29 | Print card | print the record | ⚪ | P | ✅ |
| 30 | Shortcut help (`?` / F1) | Help | ⚪ | P | ✅ |

**Suggested order:** 19 → 20 (biggest gain for whoever does triage every day), then
the small ones 27, 26, 25 and 30. Ideas 21 and 23 involve the database; 22 depends on indexes.

### 19. List with a detail pane
- **Problem:** to triage several samples the analyst opens them one by one; each opening
  changes screen (and creates/reuses a document tab).
- **Proposal:** as in HPSM, a **single click selects** the row and shows a panel
  below the grid with the sample summary (type, status, verdict, assignee,
  SHA-256/URL, last published report); **double click or Enter opens** the record.
  A preference turns the panel on/off.
- **Where to change:** `EntriesTable.tsx` (selection state; today the click opens), a new
  `EntryPreviewPane.tsx` using `GET /api/entries/:id` (the React Query cache is the
  same as the card's); preference in `lib/preferences.ts` / `UserPage.tsx`.
- **Careful:** it changes the click behavior — keep Enter opening; the navigation by
  arrows (idea 16) starts updating the panel; `aria-selected` on the row.
- ✅ **Implemented (decision: optional):** a **Detail pane** preference in My
  Account, **off by default** — off, the click keeps opening the sample.
  On, the click (and the arrows) select the row and show `EntryPreviewPane` below
  the grid (type, submission, status, verdict, assignee, tags, copyable SHA-256/URL and the
  last published report); double click, Enter or "Open sample" open the card.
  The pane uses the same card cache (`['entry', id]`).

### 20. Bulk update
- **Problem:** changing the status, verdict or assignee of many samples requires opening
  each one.
- **Proposal:** a selection column (checkbox) in the grid for analysts and a bar
  "N selected: [Status ▾] [Verdict ▾] [Assignee ▾] [Apply]", with
  confirmation ("Update 12 samples?") and the result in the message bar
  ("12 updated").
- **Where to change:** API `POST /api/entries/bulk` `{ ids, patch }` with the same rules as
  `PATCH` (in a transaction, recording each sample's events with `recordTriageChanges`);
  `EntriesTable.tsx` (selection per page); `HpsmConfirm`.
- **Careful:** an id limit per call (e.g. 100); the selection is cleared when changing filter
  or page; regular users do not see the column.
- ✅ **Implemented:** `POST /api/entries/bulk { ids (1–100), patch }` for analysts only,
  with the `resolveAssignee`/`applyTriage` helpers shared with `PATCH` (same
  rules and history events per sample, in one transaction; nonexistent ids come back
  in `notFound`). In the grid: a selection column (the header marks the page, with an
  indeterminate state), **Space** marks the row, and the **`EntriesBulkBar`** bar with Status /
  Verdict / Assignee "(keep)", a confirmation listing the changes and the result
  in the message bar. Changing filter or page clears the selection.

### 21. Saved views and Favorites
- **Problem:** filter combinations used every day (e.g. "pending phishing") are
  rebuilt by hand; watched samples have no shortcut.
- **Proposal:** a **Save view** button in the filter bar (asks for a name) creates a node in
  the navigator's **Favorites** folder, which opens the saved URL; **Pin** in the sample
  toolbar adds the sample to the same folder. Rename and remove with a right click or
  with an "×" on the node.
- **Where to change:** a `Favorite { userId, kind: VIEW | ENTRY, label, url | entryId,
  position }` model + migration; routes `GET/POST/PATCH/DELETE /api/me/favorites`;
  `HpsmSidebar.tsx` (dynamic folder); `HpsmFilterBar.tsx` and `EntryDetailPage.tsx`.
- **Careful:** accept only relative URLs of the app itself; a favorite limit per
  user (e.g. 30).
- ✅ **Implemented:** a `Favorite` model (migration `20261025000000_favorites`) and routes
  in `routes/favorites.ts`: `GET/POST /api/me/favorites`, `PATCH`/`DELETE
  /api/me/favorites/:id` and `PUT /api/me/favorites/order`. The API accepts only paths of the
  app itself (`/…`, without host, `//` or `\`), up to 30 favorites, and refuses a repeated
  view or sample (409, citing the name already saved). A deleted sample disappears from the favorites
  (cascade).
  - **Save view** in the filter bar (Global History and My Uploads) asks for the name
    in an HPSM box (`usePrompt`), already suggested by the filters ("Pending · Suspicious"),
    and keeps the search, filters and sorting, without the page.
  - **Pin / Unpin** in the card toolbar (star icon; it stays "sunken"
    when pinned).
  - A **Favorites** folder in the navigator, right below the Home Page: a saved view with
    a funnel icon, a sample with a page icon; the favorite of the current screen stays
    highlighted. A right click or Shift+F10 opens the context menu (Open,
    Rename, Move up/down, Remove); F2 renames, Delete removes (with
    confirmation) and the "×" appears on mouse hover.

### 22. Related records
- **Problem:** campaigns reappear with similar samples, and today there is no way to see the
  link between them.
- **Proposal:** a **Related** tab in the sample with other samples of the same domain
  (`urlDomain`), of the same SHA-256 (resubmissions), with tags in common and, in a second phase,
  with coinciding IOCs in the reports; a **Reason** column explains the link.
- **Where to change:** `GET /api/entries/:id/related`; a component with the usual grid;
  an index on `Entry.urlDomain` (migration).
- **Careful:** limit the result (e.g. 50) and sort by relevance; IOCs require
  extracting and normalizing tokens from the reports (phase 2).
- ✅ **Phase 1 implemented:** `GET /api/entries/:id/related` (`routes/related.ts`) joins
  samples with the **same SHA-256**, the **same host**, the **same base domain**
  (`lib/domains.ts`: `login.banco.com.br` ↔ `www.banco.com.br`, understanding `com.br`,
  `co.uk`...) and **tags in common**. Weights: SHA-256 100, host 60, base domain 40, 15 per
  tag; a tie → the most recent. It returns the 50 most relevant, with `total`. An index on
  `Entry.urlDomain` (migration `20261026000000_entry_url_domain_index`).
  - A **Related (n)** tab on the card (`components/EntryRelatedTab.tsx`), with the
    **Reason** column (several reasons on the same row) and a footer "Showing the 50 most
    relevant of N".
  - Click or Enter open the sample, and Previous/Next start going through the
    related ones.
- ✅ **Phase 2 implemented (shared IOCs):** a `ReportIoc` table (migration
  `20261029000000_report_iocs`) with the indicators from the **IOCs** field of the **published**
  reports.
  - **Indexing:** `lib/iocs.ts` rebuilds the index on every creation, edit, publication or
    unpublishing. Deleting the report clears the IOCs (cascade). On startup, the API indexes
    the published reports that do not have IOCs yet (old databases).
  - **Extraction:**
    - disarms `hxxp`, `[.]`, `(.)`, `[dot]`, `[:]` and `[@]`;
    - recognizes domains (including the host of URLs), public IPv4 (private, loopback
      and multicast stay out), emails and MD5/SHA-1/SHA-256 hashes;
    - stores everything lowercase;
    - ignores "domains" that are file names (`updater.exe`, `kernel32.dll`) and
      some omnipresent domains (google.com, microsoft.com...);
    - keeps at most 200 per report.
  - **The `SHARED_IOCS` reason** in the Related tab, in three cases:
    - another published report cites the same indicator;
    - another report cites the file or the domain of this sample;
    - an IOC of this sample's reports is the file or the domain of another sample.

    It weighs 50 per indicator, up to 3. The grid shows "Shared IOCs: a, b, c (+N)",
    with shortened hashes and the full list in the tip.
  - **Out of scope:** the Findings field is not read. The extraction uses only the IOCs field,
    to avoid false positives.

### 23. Updates / comments on the sample
- **Problem:** the analyst's notes ("asked the sender for more information") have no place;
  reports are too formal for that. Comments are in the README Roadmap.
- **Proposal:** a **New update** field in the History tab (save with Ctrl+S); the
  updates enter the timeline with author and date, visible to everyone.
- **Where to change:** a new `COMMENT` event type (enum migration) with the text in
  `detail`, or its own model if editing is needed; `POST /api/entries/:id/comments`;
  `EntryHistoryTab.tsx`.
- **Careful:** plain text (no HTML), up to 4000 characters; an attempt limit like
  the other write routes.
- ✅ **Implemented:** a `COMMENT` event (migration `20261027000000_comment_event`), with the
  text in `detail`, and `POST /api/entries/:id/comments { text }`.
  - **In the API:**
    - any logged-in user records it, and everyone sees it;
    - the text is normalized: unified line breaks, no control characters,
      trimmed spaces, from 1 to 4000 characters;
    - a limit of 10 submissions per minute per session (`attemptLimit(sessionKey('comment'),
      { max, windowMs })`; the password change limit started using the same
      `sessionKey`);
    - the updates are not editable: they stay as an audit record.
  - **In the History tab:**
    - a **New update** section with an `n/4000` counter, HPSM validation, Ctrl+S and the
      unsaved changes warning;
    - in the timeline, "Update:" + text, with line breaks preserved and a
      note background (`--dl-note-bg`);
    - an **Only updates (n)** checkbox.
  - **A fix along the way:** the New report form now clears the validation
    highlight after saving (`reportCheck.reset()`).

### 24. Age in the queue and deadline alert
- **Problem:** nothing indicates how long a sample has been waiting for triage.
- **Proposal:** an **Age** column in the grid (time since submission or since it entered the
  current status), with an orange dot after X hours and a red one after Y for the
  not completed ones; an **Overdue (N)** queue in the navigator.
- **Where to change:** the API returns `statusChangedAt` (from the last `STATUS_CHANGED` in
  the history); limits in environment variables (`SLA_WARN_HOURS`, `SLA_LATE_HOURS`) or
  in an Admin settings screen; `EntriesTable.tsx` and `HpsmSidebar.tsx`.
- **Careful:** decide whether the age counts from submission or from the current status.
- ✅ **Implemented (age since entering the current status; alert 24 h, overdue 72 h):**
  - **Database:** an `Entry.statusChangedAt` column (migration
    `20261028000000_entry_status_changed_at`). The existing samples receive the date of the
    last status change in the history, or the submission if there is none. A **trigger in
    Postgres** updates the date on every status change, by any path
    (triage, bulk action, report publication), always in UTC.
  - **Configuration:** limits in `SLA_WARN_HOURS` and `SLA_LATE_HOURS` (`lib/sla.ts`).
  - **API:**
    - `GET /api/entries` accepts `age=warn|late` (not completed above the limit) and
      `sort=age`, and returns `sla` (the limits);
    - `GET /api/entries/:id` also returns `sla`;
    - `GET /api/entries/counts` brings `late`;
    - the CSV gained the "In status since" column.
  - **Screens:**
    - an **Age** column ("1 d 6 h") in the grid, sortable, with an orange dot on alert
      and red when overdue; completed ones show "—"; the tip shows the situation and
      the limits;
    - an **Deadline** filter in the Global History;
    - an **Overdue (N)** queue in the navigator;
    - **In status since** in the card summary (`components/sla.tsx`: `AgeText`,
      `slaLevel`, `formatAge`).

### 25. Session expiring warning
- **Problem:** the session expires at a fixed time (`SESSION_TTL_HOURS`, default 168h, without
  renewal); whoever is writing a report at that moment can lose the text.
- **Proposal:** two minutes before, a box "Your session expires in 2 min — [Stay
  signed in] [Sign out]"; continuing renews the session.
- **Where to change:** `GET /api/auth/me` returns `sessionExpiresAt`; a new route
  `POST /api/auth/refresh` (extends `expiresAt` and the cookie); a scheduled warning in
  `AuthContext` using the `HpsmConfirm` dialog.
- **Careful:** with 7 days of validity the warning is rare; the gain is bigger if the project
  adopts expiration by inactivity (e.g. 30 min) — decide the policy first.
- ✅ **Implemented (policy: 30 min of inactivity):** the session is valid for
  `SESSION_IDLE_MINUTES` (default 30) since the last activity, never beyond the
  `SESSION_TTL_HOURS` ceiling counted from creation. Only login and `POST /api/auth/touch` renew;
  `GET /api/auth/session` queries the validity without renewing (polling does not count as
  activity). On the front end, `components/SessionWatcher.tsx` (inside `AuthProvider`):
  keyboard, mouse, scroll and touch — including in the sandbox console — renew at
  most 1x/min; 2 min before the end it checks on the server (another window may have
  renewed), renews if there was recent activity or shows the "Session expiring" box
  with a countdown **[Stay signed in] [Sign out]** (with it open, only the
  button renews). On expiry, it closes the tabs and returns to the login with "Your session expired
  due to inactivity. Sign in again." — without the unsaved changes question.

### 26. HPSM-style field validation
- **Problem:** today an empty required field generates only a generic message in the bar.
- **Proposal:** on save, the empty or invalid required fields get a **red
  border**, the bar lists the fields ("Fill in: Summary, File") and the focus goes to the
  first; API validation errors (`details` from zod) are linked to the fields.
- **Where to change:** `HpsmField` gains `invalid`/`error` (`components/HpsmForm.tsx`);
  `SubmitPage.tsx`, `EntryReportsTab.tsx`, `UserPage.tsx`, the key form of
  `AdminPage.tsx`.
- ✅ **Implemented:** a `useRequiredFields([{ id, label, ok }])` hook and an `invalid` prop in
  `HpsmField` (`components/HpsmForm.tsx`). On save: red label and border (also
  with focus), the message "Fill in or fix the highlighted fields: …" and focus on the first one;
  the highlight disappears when the field is corrected. Applied in Submit Sample (file and
  URL, which now requires `http(s)://`), New report (Summary) and Change password (current,
  new ≥ 8 and matching confirmation).
- ✅ **Leftovers implemented:**
  - **Admin key form:**
    - Maximum uses accepts an integer from 1 to 1000;
    - Validity accepts an integer from 1 to 3650 days, or blank for no deadline;
    - highlight, message and focus when something is wrong;
    - Ctrl+S generates the key;
    - the API now requires integers (`.int()`).
  - **API errors per field:**
    - `lib/validation.ts` (`sendValidationError`) responds 400 with `error` and
      `details: { field: [message] }`, with the zod messages in Portuguese
      ("required", "minimum of 3 characters", "invalid URL", "invalid email",
      "use an integer"...);
    - routes that use it: key, sign-up, URL submission, sample edit, report
      (create/edit), password change, update and favorites.
  - **On the front end:** `useRequiredFields` gained `fromApi(err)`.
    - It highlights the cited fields (by the field's `api` or `id`), with the message
      "Fix the highlighted fields: Title (minimum of 2 characters)." and focus on the
      first.
    - The highlight disappears when the value (`value`) changes.
    - Errors without a field stay in the bar as before.
    - Wired in key, URL submission (title, description, tags), report (summary,
      findings, IOCs), password change, update and **sign-up**. In sign-up, the
      `AuthField` gained `invalid`, and the mismatched password confirmation became a highlight
      in place of loose text.

### 27. Quick search in the masthead
- **Proposal:** a **Go to…** field in the masthead (or the `Ctrl+K` shortcut): a complete SHA-256
  opens the sample (the exact `sha256` filter that already exists); an id opens
  `/entries/:id`; any other text opens the Global History with `?q=`.
- **Where to change:** `HpsmTopBar.tsx` + the field component; the API already supports everything.
- **Careful:** on mobile, only the icon (the field opens on top).
- ✅ **Implemented:** `components/HpsmQuickSearch.tsx` — **"Go to:"** in the masthead
  (`Ctrl+K` focuses it). The SHA-256 of a single sample opens the card; an ID (cuid) opens the
  sample; the rest (including an unknown or repeated hash) opens the Global History with
  `?q=`. Below `52rem` the field leaves the masthead (the list search remains).

### 28. "More ▾" menu in the toolbar
- **Proposal:** a **More ▾** button in the sample toolbar grouping less used actions:
  copy the record link, print the card (idea 29), export the report
  (Markdown/PDF, from the Roadmap), open in a new window.
- **Where to change:** `HpsmToolbarMenu` in `components/HpsmToolbar.tsx`, reusing the
  keyboard behavior of `HpsmUserMenu.tsx`; `EntryDetailPage.tsx`.
- ✅ **Implemented:** `HpsmToolbarMenu` (`components/HpsmToolbar.tsx`) opens the
  `HpsmContextMenu` right below the **More ▾** button. Click, Enter, Space or ↓ open it;
  Esc closes it and returns the focus; clicking again closes it. On the sample card:
  - **Copy record link**;
  - **Open in a new window**;
  - **Print card…** (idea 29);
  - **Export reports (Markdown)**: generated in the browser (`components/entryExport.ts`)
    with the sample data and only the published reports; disabled when there is
    none. The PDF comes out through the printed card ("Save as PDF").

### 29. Print card
- **Proposal:** a **Print** version of the sample with details, published reports and
  history at once (not only the active tab), with a "printed by / on" header.
- **Where to change:** a dedicated route `/entries/:id/imprimir` outside the shell (like the console
  window), with `@media print` CSS; called by the "More ▾" menu (idea 28).
- **Careful:** do not include sensitive sandbox data (console credentials).
- ✅ **Implemented:** `pages/EntryPrintPage.tsx` at `/entries/:id/imprimir`, outside the
  shell (like the console window).
  - **Content:** the header "DeepLook — Sample card" with **Printed by / on**;
    Sample data, Description, Published reports (drafts stay out) and the
    full History, with the updates.
  - **Sandbox:** no information from the isolated environment enters the card.
  - **Printing:** `?auto=1` (used by the menu) opens the print dialog as soon as it
    loads; the [Print] [Close] toolbar disappears on paper; `@media print` CSS in A4,
    with the grid header repeated and reports without a page break in the middle.
  - **Window title:** "Card — <sample>", which also becomes the suggested PDF name.

### 30. Shortcut help (`?` / F1)
- **Proposal:** `?` (outside text fields) or F1 opens the **Keyboard
  shortcuts** box, with the key table.
- **Where to change:** `components/shortcuts.tsx` (it already centralizes the keys) + a generic
  dialog derived from `HpsmConfirm`; a single shortcut list shared with the
  Home Page Tips, so it does not diverge.
- **Careful:** F1 opens the browser help — use `preventDefault`.
- ✅ **Implemented:** `?` (outside text fields) or F1 (anywhere) open the
  **Keyboard shortcuts** box (`components/HpsmShortcutsHelp.tsx`), with the table
  grouped into General, Lists and Forms and boxes; Esc or [Close] close it and the focus
  returns to where it was. Also in the user menu ("Keyboard shortcuts", with a help
  icon). The single `SHORTCUT_GROUPS` list (`components/shortcutList.tsx`) feeds the
  box and the Home Page Tips (items `tip`), which now end with "Press
  ? / F1 to see all shortcuts.".

## Third batch — ideas 31 to 45

Features that take advantage of what DeepLook already has (IOC index, history,
deadline, sandbox), keeping the HP Service Manager 9 look.

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 31 | IOC search and indicator card | Configuration Item record | 🔴 | P–M | ✅ |
| 32 | IOC export (CSV / STIX / MISP) | Export | 🔴 | P–M | ✅ |
| 33 | Static analysis on submission | calculated record fields | 🟡 | M–G | ✅ |
| 34 | Mark as duplicate | parent/child record | 🟡 | P–M | ✅ |
| 35 | External reputation (optional) | integrations | ⚪ | M | ✅ |
| 36 | Inbox / notifications | To Do / Inbox | 🔴 | M | ✅ |
| 37 | Mentions in updates | activity notification | 🟡 | P | ✅ |
| 38 | Report templates | Templates | 🟡 | P | ✅ |
| 39 | Report review (four eyes) | approval | ⚪ | M | ✅ |
| 40 | Analyst dashboard | Dashboards | 🟡 | M | ✅ |
| 41 | Administrative audit | audit log | 🟡 | P–M | ✅ |
| 42 | System status | System Status | ⚪ | P | ✅ |
| 43 | Personal API tokens | Web Services | ⚪ | M | ✅ |
| 44 | Batch submission | multiple attachments | 🟡 | M | ✅ |
| 45 | Sample retention | archiving/purging | ⚪ | M | ✅ |

**Suggested order:**
1. 31 + 32 (the IOC index already exists).
2. 36 + 37 (they close the assignment and update cycle).
3. The small ones: 38, 34 and 42.
4. 40 and 33.

**Before any code:** 35 (talking to external services) and 43 (token access)
need a security decision.

### 31. IOC search and indicator card
- **Problem:** "where else did this IP appear?" requires opening sample by sample.
- **Proposal:**
  - The masthead "Go to:" recognizes an IP, domain, email or hash (including
    disarmed ones: `hxxp`, `[.]`) and opens the **indicator card** at `/iocs/:type/:value`.
  - The card shows the type and the value, the first and the last sighting, and the grid of
    linked samples, with the reason for each one: cited in a report, it is the file
    (SHA-256) or it is the sample's domain.
  - The indicators in the Related tab and in the reports become links to the card.
- **Where to change:**
  - API: `GET /api/iocs/lookup?q=` (normalizes with the same extraction as `lib/iocs.ts`) and
    `GET /api/iocs/:kind/:value`.
  - Front end: `pages/IocPage.tsx`, `HpsmQuickSearch.tsx`.
- **Careful:** the card only lists published reports; a hash that is the SHA-256 of a
  sample appears even without a report.
- ✅ **Implemented:**
  - **API** (`routes/iocs.ts`):
    - `GET /api/iocs/lookup?q=` recognizes the indicator with the same extraction as the index
      (`hxxp`, `[.]`, a full URL → domain; a private IP does not count);
    - `GET /api/iocs/:type/:value` returns the samples with the reason for each one
      (published report, with analyst and date; the file; the URL's domain), the
      first and last sighting, up to 200 samples;
    - `GET /api/entries/:id/iocs` lists the sample's indicators.
  - **Card** (`pages/IocPage.tsx`, route `/iocs/:type/:value`): the title "IPv4:
    185.0.2.10", a summary (type, value with a copy button, first and last sighting,
    total), a grid navigable by keyboard (Previous/Next go through the card's samples)
    and a document tab "IOC · value".
  - **"Go to:"** an indicator opens the card. A SHA-256 without a sample also opens the
    card (before it fell into the text search). Plain text and a private IP keep going
    to the list.
  - **Links to the card:** a **Recognized indicators** section in the Reports tab
    (type, value and origin) and the shared IOCs of the Related tab.
  - **A fix along the way:** the title set by a screen on the very first render was
    lost, because the tab did not exist yet. `WorkspaceProvider` now keeps the
    title and applies it when creating the tab.

### 32. IOC export (CSV / STIX / MISP)
- **Problem:** taking the indicators to a firewall, SIEM or MISP means copy and paste.
- **Proposal:**
  - An "Export IOCs ▸ CSV / STIX 2.1 / MISP" item in the sample's "More ▾" menu (IOCs
    of the published reports + the file or domain itself).
  - The same for the result of the indicator card.
- **Where to change:** `GET /api/entries/:id/iocs.(csv|stix|misp)`, generated in the API;
  `lib/ioc-export.ts`.
- **Careful:**
  - STIX 2.1: one `indicator` per IOC, with the `pattern` in STIX format, plus a `bundle`
    with stable `indicator--<uuid v5>` ids.
  - MISP: a JSON event with `Attribute` (`ip-dst`, `domain`, `email-src`, `md5`, `sha1`,
    `sha256`).
  - Only indicators from published reports.
- ✅ **Implemented:** `GET /api/entries/:id/iocs/export?format=csv|stix|misp`
  (`lib/ioc-export.ts`), in the **More ▾ > Export IOCs (CSV / STIX 2.1 / MISP)** menu.
  - **What goes in:** the IOCs of the published reports, the file's SHA-256, the URL and
    the sample's domain.
  - **CSV:** `;` with BOM, like the list export.
  - **STIX 2.1:** a `bundle` with the "DeepLook" identity and one `indicator` per IOC, with
    the STIX `pattern` escaped and `indicator_types` by the verdict. The ids are UUID v5, the
    same on every export.
  - **MISP:** an event with `threat_level_id` and `analysis` by the verdict and the status;
    emails with `to_ids: false`.
  - **Change from the plan:** the indicator card did not get its own export. The
    export is per sample, and the card leads to the samples.

### 33. Static analysis on submission
- **Problem:** basic information about the file (real type, whether it is an executable, entropy)
  depends on opening the sandbox.
- **Proposal:** when receiving the file, the API computes:
  - the real type by the *magic bytes*, with a warning when the extension lies
    (`fatura.pdf` that is a PE);
  - the entropy (a sign of packing);
  - the most relevant readable strings (URLs, IPs, paths);
  - for PE: architecture, compile date, sections and imported DLLs.

  Everything appears in the card's "Static analysis" section.
- **Where to change:** `lib/static-analysis.ts` (reading the object in MinIO as a stream, with
  a size limit), an `Entry.staticInfo Json` column, a section in the Details tab.
- **Careful:** never execute the file; read with a byte and time limit; strings that
  look like IOCs can suggest (not record) IOCs in the report.
- ✅ **Implemented:** `lib/static-analysis.ts`, read-only access to the bytes (without executing or
  decompressing), stored in `Entry.staticInfo` (JSONB, migration
  `20261102000000_entry_static_info`) on upload. An analysis failure does not prevent the
  submission.
  - **Real type** by signature: PE, ELF, Mach-O, PDF, ZIP (with DOCX/XLSX/PPTX, JAR and
    APK by the internal names), OLE, 7z, RAR, GZIP, CAB, CHM, LNK, ISO, images, RTF,
    script and HTML. A diverging extension generates an alert; an executable named as another type
    is marked as **disguised** and shows a warning at the top of the card.
  - **Entropy** (0 to 8) of the first 16 MB, with a low, normal or high level (≥ 7.2:
    probable compression or encryption).
  - **Strings** ASCII and UTF-16LE (in both alignments), categorized into suspicious words,
    URLs, public IPs, emails, paths and registry keys; up to 20 of
    each.
  - **PE:** architecture, EXE/DLL, subsystem, compile date, sections with entropy,
    packer by the section names (UPX, ASPack, Themida, VMProtect...), imported DLLs
    and functions from the attention list (`VirtualAllocEx`,
    `WriteProcessMemory`...). Every header read checks the buffer limits:
    300 random MZ files in the test, no errors.
  - **Suggested IOCs** from the strings: links to the indicator card and the
    **Insert suggested IOCs** button in New report. They do not enter the index until they appear
    in a published report.
  - **Old samples:** `POST /api/entries/:id/static-analysis` (analysts) re-reads the
    file from MinIO; on the card, "Analyze now".
  - **Lists and export** do not carry the JSON (`omit`). The printed card gained
    "Real type" and "Entropy".
      update, "Mark all as read" and "See all";
    - keyboard the same as the user menu;
    - opening a notification marks it as read and takes you to the sample (updates open the History
      tab).
  - **Inbox** (`/inbox`, also at the navigator root with the counter): the
    last 100, with the "Unread only" filter and keyboard.
  - **Counter:** queried every minute and when returning to the window.

### 34. Mark as duplicate
- **Problem:** resubmissions of the same scam fill the queues and get repeated triage.
- **Proposal:**
  - A "Mark as duplicate of…" action (analysts): choose the main sample, which can
    be suggested by Related.
  - The duplicate inherits the verdict, goes to Completed and shows "Duplicate of #X" in the
    summary; the main one lists its duplicates.
  - Undoing goes back to the previous state.
- **Where to change:** `Entry.duplicateOfId` + a `MARKED_DUPLICATE` event in the history; queues
  and counters ignore duplicates.
- **Careful:** prevent cycles (A → B → A) and chains (a duplicate of a duplicate
  points to the main one).
- ✅ **Implemented:** `Entry.duplicateOfId` and the `MARKED_DUPLICATE` and
  `UNMARKED_DUPLICATE` events (migration `20261101000000_entry_duplicates`), in
  `routes/duplicates.ts`.
  - **API:**
    - `POST /api/entries/:id/duplicate { of }` (analysts) completes the sample with the
      main one's verdict and stores the previous situation in the event;
    - `DELETE /api/entries/:id/duplicate` restores that situation.
  - **Rules:**
    - the chain is always flattened: a duplicate of a duplicate points to the main one, and the
      duplicates of a sample that becomes a duplicate start pointing to the new
      main one;
    - a cycle → 400;
    - when the main one's verdict changes (triage, bulk or report), the duplicates
      follow, with the event "following the main sample" (`recordTriageChanges`);
    - a deleted main one releases the duplicates.
  - **Screens:**
    - the **More ▾ > Mark as duplicate…** menu opens the box with the suggested related
      samples (reason and verdict) or "Another sample (ID or link)", with
      the error in the box itself;
    - **Undo duplicate**, with confirmation;
    - in the summary, "Duplicate of: <link>" and, on the main one, "Duplicates: N", with the
      **Duplicates** section in the Details tab;
    - a "duplicate" mark next to the title in the lists and a row in the printed card.
  - **Queues:** the duplicate stays Completed, so it leaves Pending, In analysis,
    Assigned and Overdue.

### 35. External reputation (optional)
- **Proposal:** query VirusTotal, URLhaus or AbuseIPDB by hash, domain or IP (never
  the file), with a 24 h cache; the result appears in a "Reputation" section of the card.
- **Where to change:** `lib/reputation/*`, keys in environment variables
  (`VT_API_KEY`...), off by default.
- **Pending decision:** may the project send indicators to third parties? Even just the hash
  reveals that the sample is being analyzed.
- **Decision:** all the services cited (VirusTotal, MalwareBazaar, URLhaus, ThreatFox and
  AbuseIPDB), each enabled by its own key in `.env`. Automatic query on submission,
  independently of analysts. From the link, only the domain.
- ✅ **Implemented:** migration `20261107000000_reputation` (`ReputationResult` model, one
  per sample and service). Code in `lib/reputation.ts`.
  - **Indicator:** the file's SHA-256; the link's domain, or the IP when the host is an IP. The full
    URL and the file never leave (the test checks with fake servers).
  - **Services by indicator:**
    - **hash:** VirusTotal, MalwareBazaar and ThreatFox;
    - **domain:** VirusTotal, URLhaus and ThreatFox;
    - **IP:** the three domain ones plus AbuseIPDB.
  - **When:** on file, `.zip` and link submission, in the background, without delaying the
    response. It also applies to token submissions.
  - **Queue per service** with a minimum interval (VirusTotal: 15 s, because of the limit of 4
    per minute). A 15 s timeout per call.
  - **24 h cache** per service and indicator: another sample with the same hash or domain
    copies the result without querying again.
  - **Results:** Malicious, Suspicious, Clean, Not found or Failure (key refused,
    limit reached, no response), with a summary and a link to the service page.
    - **VirusTotal:** malicious from 5 engines.
    - **AbuseIPDB:** by the abuse confidence (75% malicious, 25% suspicious).
  - **API:**
    - `GET /api/entries/:id/reputation`, which brings `pending` while the query runs and
      also accepts a token;
    - `POST` "Check again", analysts only, ignores the cache.
  - **Card:**
    - **Top:** "Reputation: malicious in 2 of 3 services", "no alerts (… · 1 with
      a failure)" or "checking...".
    - **External reputation section** in the Details tab: the indicator queried and the notice of what
      does not leave; one row per service with result, summary, date and "Open in …"
      (`noopener`).
    - It refreshes by itself while checking. With no service on, nothing appears.
  - **System status:** an "External reputation" line with the services enabled or without a key,
    queries in the last 24 h and failures (alert).

### 36. Inbox / notifications
- **Problem:** assignments and completions are only seen when the person opens the list.
- **Proposal:**
  - A bell in the masthead with a counter and a list: "X assigned sample Y to you", "your
    sample Y was completed", "Z mentioned you".
  - Mark as read (one or all); clicking opens the record.
  - An "Inbox" page with history.
- **Where to change:** a `Notification { userId, type, entryId, actorId, readAt }` model
  created along with the history events; `GET/PATCH /api/me/notifications`; light
  polling (60 s, like the queues).
- **Careful:** do not notify the action itself; email stays for later (optional, SMTP).
- ✅ **Implemented:** a `Notification` model (migration `20261030000000_notifications`) and
  `lib/notifications.ts` (`notify`), called at the single points of the API:
  - `applyTriage` → **ASSIGNED** to the new assignee (including in the bulk
    update);
  - `recordTriageChanges` → **COMPLETED** to the owner, with the verdict (triage, bulk and
    report publication);
  - an update → **MENTION** to the mentioned ones and **COMMENT** to the owner and
    assignee. Whoever already received the mention does not receive the repeated COMMENT.

  Nobody is notified of their own action, and a deleted sample takes the notifications with it.
  - **API:**
    - `GET /api/me/notifications?limit=&unread=1`;
    - `GET /api/me/notifications/count`;
    - `POST /api/me/notifications/read { ids? }` (without `ids`, marks all).
  - **Bell** in the masthead (`HpsmInboxMenu`):
    - a red counter and an accessible label ("Inbox: 2 unread");
    - a panel with the 8 most recent: unread in bold with a blue dot, an excerpt of the
      update, "Mark all as read" and "See all";
    - a keyboard the same as the user menu;
    - opening a notification marks it as read and takes you to the sample (updates open the History
      tab).
  - **Inbox** (`/inbox`, also at the navigator root with the counter): the
    last 100, with the "Unread only" filter and keyboard.
  - **Counter:** queried every minute and when returning to the window.

### 37. Mentions in updates
- **Proposal:** `@` in the update field suggests active users; the mention becomes a link
  and generates a notification (36) for the mentioned person.
- **Where to change:** autocomplete in `EntryHistoryTab.tsx`; mentions stored as
  `@[Name](id)` in the text and displayed as the name; the API validates the ids.
- **Careful:** active users only; the mention does not give access to anything beyond what the person
  already has.
- ✅ **Implemented (with an adjustment):** the text keeps only "@Name", more readable in the history,
  in the printed card and in the CSV. The ids go separately (`mentions` in the POST).
  - **API:** validates the ids (active users whose "@Name" is still in the text) and records
    `[{ id, name }]` in the event `toValue`.
  - **Update field** (`components/MentionTextArea.tsx`, accessible combobox):
    - "@" lists the active people (`GET /api/users/mentionable?q=`: name only, no
      email, up to 8);
    - ↑/↓ choose, Enter or Tab insert "@Name ", Esc closes only the list;
    - with the list closed, Enter keeps breaking the line.
  - **In the history:** the mentioned "@Name" appears in bold (`renderMentions`).

### 38. Report templates
- **Problem:** reports of common cases (credential phishing, dropper, doc with a
  macro) are written from scratch.
- **Proposal:**
  - A "Template" field in New report fills in Summary, Findings, IOCs and the suggested verdict;
    it asks before overwriting text already typed.
  - The admin maintains the list in an "Templates" tab of Administration.
- **Where to change:** a `ReportTemplate` model, routes `/api/report-templates` (read for
  analysts, write for admin).
- ✅ **Implemented:** a `ReportTemplate` model with a unique name (migration
  `20261031000000_report_templates`) and `routes/templates.ts`.
  - **API:** `GET` for analysts and admin; `POST`, `PATCH` and `DELETE` only for the admin,
    with per-field errors and a repeated name → 409 pointing to the Name field.
  - **Administration:** a **Report templates** tab (also in the navigator, in
    Administration), in `components/AdminTemplatesTab.tsx`:
    - a New/Edit form (name, suggested verdict, summary, findings, IOCs) with
      HPSM validation, Ctrl+S and the unsaved changes warning;
    - a grid with Edit and Delete (with confirmation).
  - **New report:** a **Template** field, which only appears when there are templates. It fills in
    Summary, Findings, IOCs and the verdict; with text already typed, it asks first
    ("Replace" or "Keep the text").

### 39. Report review (four eyes)
- **Proposal:**
  - An option (by configuration) for the report to go through **In review** before
    publishing: another analyst approves it or returns it with a comment.
  - Approving publishes and completes the sample, as today.
- **Where to change:** `Report.status` (DRAFT, IN_REVIEW, PUBLISHED) in place of the boolean,
  with a migration; events in the history; a "Reports to review" queue.
- **Careful:** the author does not review their own report.
- ✅ **Implemented:** `Report.status` (DRAFT, IN_REVIEW, PUBLISHED) in place of the
  `published` boolean, with `submittedAt`, `reviewedBy`, `reviewedAt` and `reviewNote` (migration
  `20261103000000_report_review`, which converts the existing published ones).
  - **Configuration:** `REPORT_REVIEW_REQUIRED` (default `false`). With `true`, nobody
    publishes directly: only another analyst's approval publishes, and a published report cannot
    be edited.
  - **API:**
    - `POST /api/entries/:id/reports` accepts `status`;
    - `POST /api/reports/:id/submit`;
    - `POST /api/reports/:id/approve` (publishes and completes the sample);
    - `POST /api/reports/:id/return { note }` (goes back to draft with the comment);
    - `GET /api/reports/review-queue`;
    - `reviews` in `/api/entries/counts`.
  - **Rules:**
    - the author does not approve or return their own report (403);
    - in review the report is locked for editing (409);
    - publishing, direct or by approval, goes through a single function (completes the
      sample, records it in the history and indexes the IOCs).
  - **Visibility:** regular users only see published reports, on the card and in the API.
    Before, drafts appeared to everyone.
  - **History:** `REPORT_SUBMITTED`, `REPORT_APPROVED` and `REPORT_RETURNED` events.
  - **Notifications** `REPORT_APPROVED` and `REPORT_RETURNED` to the author, with the comment,
    opening the Reports tab.
  - **Screens:**
    - a **Reports to review (N)** queue in the navigator, in Queues
      (`pages/ReviewQueuePage.tsx`);
    - on each report: the situation (Draft, In review, Published · reviewed by…),
      the actions (Submit for review, Publish, Approve and publish, Return… with
      a comment) and the notice "Returned by…" for the author;
    - in New report, the **On save** field (Publish, Submit for review, Save
      as draft) replaces the "Publish" checkbox.

### 40. Analyst dashboard
- **Proposal:** a "Dashboard" page in the navigator with indicators in the HPSM style:
  - samples by status;
  - overdue and on alert;
  - completed in the week;
  - verdict distribution;
  - workload per analyst.

  Each number is a link to the already filtered list.
- **Where to change:** `GET /api/dashboard` (aggregations), `pages/DashboardPage.tsx`; simple
  charts in SVG, without a heavy library.
- **Careful:** regular users only see their own numbers.
- ✅ **Implemented:** `GET /api/dashboard?days=7|30|90&tz=` (`routes/dashboard.ts`) and
  `pages/DashboardPage.tsx` at `/painel`, at the navigator root. It can also be
  chosen as the home page in the preferences.
  - **Indicators:** pending, in analysis, on alert or overdue, overdue, submitted
    and completed in the period (without duplicates). Each one is a link to the filtered list.
  - **Chart** (`components/DailyChart.tsx`, its own SVG): columns per day of submitted
    × completed, with the days in the **browser time zone** (grouped in Postgres).
    - A single axis and a discrete grid.
    - A tip on mouse hover, beside the day (never on top of the columns).
    - A legend with totals and "View as a table".
    - A color pair `--dl-series-1/2` validated with the visualization skill script
      (color blindness and normal vision). The teal is below 3:1 contrast, which
      is why the legend and the table are mandatory.
  - **Verdicts:** horizontal bars of a single color (magnitude), with the state in the label.
  - **Workload per analyst:** pending, in analysis, overdue and completed in the period,
    with "No assignee" last; each number is a link.
  - **Scope:** regular users see only their own samples, with links to My
    Uploads and without the workload per analyst.
  - **List:**
    - new filters `assignee=<analyst id>`, `submittedFrom` and `completedFrom`;
    - the "Assignee" select lists the analysts;
    - the period filters (and the deadline one in My Uploads) appear as removable chips
      in the filter bar (`chips` of `HpsmFilterBar`).

### 41. Administrative audit
- **Proposal:** an "Audit" tab in Administration, with who did what and when:
  - suspend or reactivate a user, change role;
  - generate or revoke a key, reset a password;
  - logins with repeated failure.

  With filters and CSV export.
- **Where to change:** an `AdminEvent` model, recorded in the routes of `admin.ts` and `auth.ts`.
- **Careful:** never record passwords, nor the temporary ones.
- ✅ **Implemented:** an `AuditEvent` model (migration `20261104000000_audit_events`) with
  who did it, action, target user, target label at the time (email, key code, template
  name), detail and IP. Recorded by `lib/audit.ts`, in the same transaction as the action.
  - **Actions recorded:**
    - role changed ("USER → ANALYST"), account suspended and reactivated;
    - password reset by the admin and password changed by the user themselves;
    - key generated (role, uses, validity) and revoked;
    - report template created, changed and deleted;
    - sign-up with key (code and role);
    - refused login, with the reason: email not registered, wrong password or suspended
      account;
    - login blocked for too many attempts, once per 5 min window (`onExceeded`
      option in `attemptLimit`).
  - **Never records passwords**, neither the temporary nor the attempted one (the test checks).
  - **Deleted user:** the records stay (`SetNull`), with the target label.
  - **API** (admin only):
    - `GET /api/admin/audit?action=&days=&q=&limit=&offset=`;
    - `GET /api/admin/audit/export.csv` with the same filters (up to 10,000 rows, protection
      against formulas in Excel).
  - **Screen:** an **Audit** tab in Administration (`?tab=audit`) and a leaf in the navigator
    (`components/AdminAuditTab.tsx`).
    - Filters: Search (who, target, detail, IP), Action and Period (default 30 days).
    - Columns: Date, Who (or "(anonymous)"), Action with color, Target, Detail and IP.
    - 50 per page, and Export CSV.

### 42. System status
- **Proposal:** an admin page with green, orange or red for:
  - database;
  - MinIO (reachable, space);
  - Proxmox (reachable, DeepLook VMs running);
  - API version and uptime.
- **Where to change:** `GET /api/admin/status` with a timeout per check.
- ✅ **Implemented:** `lib/status.ts` and `GET /api/admin/status` (admin only). The
  checks run in parallel, with a 3 s limit each and "slow" above 1 s.
  - **What goes in:**
    - **API:** version, uptime, Node.js and environment;
    - **Database:** `SELECT 1`, active users, samples and open sessions;
    - **MinIO:** bucket reachable; it shows the bucket and the host, never the credentials;
    - **Proxmox:** version, template and active VMs against `SANDBOX_MAX_ACTIVE` (orange
      at the limit); "Off" with `SANDBOX_ENABLED=false` and the simulated mode indicated;
    - **Queues:** pending, in analysis and overdue (orange if there is an overdue one).
  - **Overall situation:** the worst among the checks; "Off" does not count as a
    problem. The failure reasons come out readable ("connection refused", "access denied
    (check the credentials)"...) instead of "AggregateError".
  - **Screen:** a **System status** tab in Administration (also in the navigator), with a
    colored situation, summary, time, details, a general failure or alert notice, the line
    with a failure highlighted, Refresh and automatic refresh every 30 s.
  - **Out:** MinIO disk space, which requires the MinIO administrative API.

### 43. Personal API tokens
- **Proposal:** in My Account, generate a token with name and validity to submit and query
  samples by script.
- **Scope:** submission and reading only; the token appears once and is revocable.
- **Where to change:** an `ApiToken` model (token hash), authentication by
  `Authorization: Bearer`.
- **Pending decision:** opening access outside the browser.
- **Decision:** the API is only released manually by an administrator, user by user.
- ✅ **Implemented:** migration `20261106000000_api_tokens` (`User.apiAccess`, `ApiToken`
  model; audit `API_ACCESS_GRANTED`, `API_ACCESS_REVOKED`, `API_TOKEN_CREATED` and
  `API_TOKEN_REVOKED`).
  - **Release:** Enable API / Withdraw API buttons in the Users tab, with confirmation, and the
    "API access" column (released and how many active tokens). Withdrawing revokes immediately
    all the person's active tokens.
  - **My Account > API Tokens:** the tab only appears with access released.
    - It generates a token with name and validity (7, 30, 60 or 90 days), at most 10 active.
    - The token (`dlk_` + 32 random bytes) appears once, with Copy; the database
      stores only the SHA-256.
    - The list shows the start of the token, the validity, the last use with IP and the situation
      (Active, Expired, Revoked), with Revoke…
    - The tab brings `curl` examples with the server address.
  - **Authentication** (`lib/api-tokens.ts`): `Authorization: Bearer <token>` in
    `requireUser`.
    - It only applies to a closed list of routes: submit file, `.zip` and link; list and
      query samples, reports, history and IOCs. The rest responds 403, including
      file download, triage, account and administration.
    - It refuses an expired, revoked or unknown token and a suspended account (401), and a user without
      the release (403).
    - A limit of 120 requests per minute per token (429).
    - `/api/auth/me` stays with the cookie only. Other `Authorization` schemes (e.g.
      Basic) fall back to the cookie.
  - **Administration > API Tokens** (`?tab=tokens`, also in the navigator): tokens of
    all users, active or all, with last use and IP, and Revoke….

### 44. Batch submission
- **Proposal:** several files at once in Submit Sample (one sample per file,
  with the same tags), or a `.zip` with the password `infected` split into samples.
- **Careful:** a file limit and a total size; the zip is opened only to list and
  extract, never executed.
- ✅ **Implemented:**
  - **Several files** in Submit Sample (up to 20):
    - the picker sums choices without repeating the same file (name and size), shows the
      total and has Remove per file;
    - the Title field disappears (each sample carries the file name); description and tags apply
      to all;
    - one submission per file through the usual route, so the size limit applies to
      each one.
  - **`.zip` split:** with a single `.zip`, the "Split" checkbox shows the Password field
    (default `infected`) and sends to `POST /api/entries/zip`.
    - **Our own reader** (`lib/zip.ts`, no new dependency): stored and deflate,
      ZipCrypto (including with a data descriptor) and WinZip/7-Zip AES (AE-1/AE-2, with
      HMAC). ZIP64 and PKWARE strong encryption are refused with a clear message.
    - **Security:** everything in memory, nothing goes to disk nor is executed; CRC and
      size checked; zip bomb blocked by the declared size and on decompression
      (`maxOutputLength`).
    - **Limits:** 20 files per package; each file up to `MAX_UPLOAD_MB`; total
      extracted up to 2× that value.
    - **Ignored files:** folders, `__MACOSX/` and `.DS_Store`. Empty ones and ones above the
      limit appear as "Ignored" with the reason.
    - **Password:** files with another password are skipped. If nothing opens with the password, the
      Password field is highlighted.
    - **Each sample** gets the static analysis and the CREATED event, with the description
      "Extracted from package.zip (path/inside)".
  - **Submission result:** a table with one row per file (Waiting, Sending...,
    Sent, Ignored, Failure with the reason), a link to each sample and a summary.
  - **"Already submitted before":** `POST /api/entries/file` and the `.zip` return `previous`, the
    first sample with the same SHA-256. The result shows the link.

### 45. Sample retention
- **Proposal:** automatic purge of the **file** after N days (`RETENTION_DAYS`),
  keeping the card, reports, IOCs and hash; a "trash" in the admin to delete or
  restore whole samples.
- **Careful:** a warning on the card ("file purged on…"); never purge a sample with an
  active sandbox.
- ✅ **Implemented:** migration `20261105000000_entry_retention_trash` (`Entry.filePurgedAt`,
  `deletedAt`, `deletedById`; events `FILE_PURGED`, `TRASHED` and `RESTORED`; audit
  `ENTRY_TRASHED`, `ENTRY_RESTORED` and `ENTRY_DELETED`).
  - **Retention** (`lib/retention.ts`): `RETENTION_DAYS` (default `0`, off).
    - **What it purges:** only the file of samples **completed** for more than N days
      (`statusChangedAt`), so as not to delete what is still in analysis.
    - **What it does not touch:** samples with an active sandbox and those in the trash.
    - **When it runs:** when the API starts and then every hour, up to 100 per round.
    - **Order:** it deletes the object in MinIO before marking the card; if something fails halfway,
      the next round finishes it.
    - **Card:**
      - "File: purged on…" in the summary and the Storage field with the policy;
      - Download sample disabled;
      - sandbox and "Analyze now" unavailable;
      - an event in the history.
    - **API:** download, re-analysis and sandbox respond 410.
    - **System status:** the storage shows the policy, how many files were
      purged and how many samples are in the trash.
  - **Trash** (admin only):
    - **Move:** "Move to trash…" at the end of the card's More menu, with confirmation
      (refused with an active sandbox). The card tab becomes the Trash, with the notice.
    - **Central filter:** `Entry` queries ignore the trash by default, through the Prisma
      extension in `lib/prisma.ts`. That way the sample disappears from lists, queues, counters,
      CSV, dashboard, search and IOCs, and the card responds 404. Triage and bulk update
      do not reach it either.
    - **Explicit filters** in the relations: favorites, notifications, review queue,
      user updates, IOCs, related, the card's duplicates and the dashboard SQL. Restoring brings everything back.
    - **Trash tab** in Administration (`?tab=trash`) and in the navigator, with search. Each
      row shows who submitted it, who moved it, since when, the size, whether the file was already
      purged and how many reports it has.
    - **Restore.**
    - **Delete permanently…:** confirmation; it deletes the file in MinIO first (if it
      fails, the sample stays in the trash) and then the card with reports, history and
      updates.
    - **Audit:** move, restore and delete.
  - **Types:** `Tx` and `Db` leave `lib/prisma.ts`, because the extended client is not
    compatible with `Prisma.TransactionClient`.

## Fourth batch — ideas 46 to 50

Account security and sample verification: leftovers from the previous batches (mandatory
password change and "Sign out" without warning), antivirus in its own container and optional 2FA.

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 46 | "Save" button on the password change | form buttons | ⚪ | P | ✅ |
| 47 | "Sign out" with unsaved changes | pending changes warning | 🟡 | P | ✅ |
| 48 | Mandatory password change after reset | password expiration | 🔴 | P–M | ✅ |
| 49 | ClamAV antivirus in its own container | integrations + System Status | 🟡 | M | ✅ |
| 50 | Optional two-factor authentication (2FA) | login with a second factor | 🔴 | M–G | ✅ |

**Order (one step per item, each with tests, documentation and its own commit):**
46 → 47 → 48 → 49 → 50. The first two are small and interface only; 48 touches
the login and prepares the ground for 50.

### 46. "Save" button on the password change
- **Problem:** in My Account > Password, the only way to save is "Save password" in the
  section's gray bar (or Ctrl+S). It is easy to miss.
- **Proposal:** a **Save** button in the form footer, right below "Confirm
  password", aligned with the fields. It does the same as the bar and Ctrl+S: it validates, shows
  "Saving..." and stays disabled while saving.
- **Careful:** the bar stays (the pattern of the other screens); the two buttons and the shortcut
  call the same function.
- ✅ **Implemented:** an `HpsmFormActions` component (`components/HpsmForm.tsx`), a form
  footer with the buttons starting in the control column. In the Password tab it brings
  **Save**, which becomes "Saving..." and stays disabled while saving, like the bar and
  Ctrl+S. Test in `account.mjs`: position below the confirmation, alignment with the
  fields, validation and password change through the button.

### 47. "Sign out" with unsaved changes
- **Problem:** switching screen with a changed form asks "Unsaved
  changes", but **Sign out** in the user menu ends the session straight away and loses what was
  typed (a known limit of item 4).
- **Proposal:** with any pending change (Submit Sample, New report, Change
  password, Preferences, API Tokens...), Sign out asks first: "There are unsaved changes.
  Sign out anyway? [Sign out] [Keep editing]". Without changes, it signs out directly as
  today.
- **Where to change:** `useUnsavedChanges` registers the dirty forms in a central point;
  the top bar's `handleLogout` consults that registry before calling the API.
- **Careful:** does the same apply to the inactivity ending? No: the expired session
  already expired; the inactivity warning (item 24) stays as it is.
- ✅ **Implemented:**
  - **Central registry:** `useUnsavedChanges` records each form with a pending
    change (`hasUnsavedChanges()`). It leaves the registry when the change is undone or
    when `allowNavigation()` is called after saving.
  - **Sign out** (`HpsmTopBar`): with something pending, it asks "There are unsaved changes
    on this screen. Do you want to sign out anyway and discard them?" [Sign out] [Keep editing].
    Keep editing keeps the screen and the text; Sign out ends the session.
  - **No double warning:** the navigation to the login happens inside
    `discardUnsavedChanges()`, which releases the screen change block.
  - Without a change, or with the change undone, Sign out leaves directly as before.
  - Test in `logout-unsaved.mjs`.

### 48. Mandatory password change after reset
- **Problem:** when the admin resets the password (item 2), the person receives a temporary
  password, which the admin saw, and can keep using it forever.
- **Proposal:**
  - The reset by the admin marks the account with a **mandatory change**.
  - On login with the temporary password, the person goes straight to a **Set new
    password** screen (current password already filled by the login, new and confirmation). Until they
    change it, the API refuses everything that is not that change, sign out and the session data (403
    with its own code), and the front end does not let them navigate to other screens.
  - On changing it, the mark disappears, the other sessions are ended and the person signs in
    normally.
  - The new password cannot be the same as the temporary one.
- **Where to change:** `User.mustChangePassword`; `POST /api/admin/users/:id/reset-password`
  turns it on; `POST /api/me/password` turns it off; a central check in `requireUser`; the person's
  API tokens are also blocked until the change.
- **Admin:** a "password change pending" column/indicator in the Users tab; the audit of the
  change already exists (`USER_PASSWORD_CHANGED`).
- ✅ **Implemented:** migration `20261108000000_must_change_password`
  (`User.mustChangePassword`).
  - **Reset by the admin:** turns the mark on. The confirmation and the temporary password
    notice explain the change, and the audit records "mandatory change on the next
    login".
  - **API:** with the mark on, `requireUser` responds 403
    `{ code: 'PASSWORD_CHANGE_REQUIRED' }` to everything, except `POST /api/me/password`.
    `/api/auth/me`, session and Sign out continue. The person's API tokens also receive 403.
  - **Mandatory change:**
    - turns the mark off and ends all sessions;
    - opens a new session (`signedIn: true`), so the person signs in directly;
    - in the audit it appears as "mandatory change after reset";
    - the new password must be different from the temporary one.
  - **"Set new password" screen** (`pages/ForcePasswordPage.tsx`), in the login layout,
    without the shell: it is the only route while the mark is on.
    - The temporary password typed at login stays only in memory and is used once; after
      reloading, the screen asks for the temporary one.
    - "Save and sign in" and "Sign out" buttons.
  - **Users (Administration):** "· password change pending" next to the status.
  - **Tests:** 21 integration (Postgres) and `force-password.mjs`.

### 49. ClamAV antivirus in its own container
- **Proposal:**
  - A new `clamav` service in `docker-compose.yml` (official `clamav/clamav` image, with
    `freshclam` updating the signatures by itself and a volume for the database).
  - The API talks to `clamd` over the internal network (TCP 3310, `INSTREAM` protocol), without
    writing the file to disk and without exposing the port outside.
  - **Automatic scan** of every uploaded file (including those extracted from a
    `.zip`), in the background, without delaying the submission.
  - **Result on the card:** an "Antivirus (ClamAV)" section with Clean / Infected (signature
    name) / Failure, engine version and database date; "Infected" also in the top
    summary. Analysts have "Scan again".
  - **System status:** an "Antivirus (ClamAV)" line with the `clamd` situation (it answers
    PING), version, signature database date (alert if older than 2 days) and
    scans/infections in the last 24 h.
- **Configuration:** `CLAMAV_HOST` (empty = off) and `CLAMAV_PORT` (3310).
- **Careful:** ClamAV uses a lot of memory (about 1.5 to 3 GB because of the database);
  files above the `clamd` limit (`StreamMaxLength`) become "Failure: file too
  large" instead of hanging; the result does not change the verdict, which stays with the analyst.
- ✅ **Implemented:** migration `20261109000000_antivirus` (`AntivirusScan` model, the
  most recent scan of each sample).
  - **Container:** a `clamav` service in compose (`clamav/clamav:stable`, database in
    `./data/clamav`, no published port). The API uses `CLAMAV_HOST=clamav`; empty turns it off.
  - **Client** (`lib/clamav.ts`): TCP with `PING`, `VERSION` (engine, number and database
    date) and `INSTREAM` in 64 KB blocks. Responses:
    - `stream: OK` becomes Clean;
    - `… FOUND` becomes Infected with the signature;
    - a size limit, being down and a timeout become Failure with the reason.
  - **Scan:** on submission, in the background, with the content already in memory; it also applies
    to the files extracted from a `.zip` and to token submissions.
  - **API:**
    - `GET /api/entries/:id/antivirus` → `{ enabled, pending, scan }`, also by token;
    - `POST` "Scan again", analysts only, reads from MinIO; it responds 410 if the file was
      purged.
  - **Card:**
    - **"Antivirus (ClamAV)" section:** situation with color, engine, database, date and the button.
    - **Top:** "Antivirus: infected (signature)".
    - It refreshes by itself only while `pending`. Files older than the antivirus show
      "Not scanned" and "Scan now".
  - **System status:** an "Antivirus (ClamAV)" line. Error when `clamd` does not
    answer; alert when the database is more than 2 days old.
  - **Tests:**
    - 23 integration tests against the **real ClamAV** in a container, with the EICAR
      test file built in memory: clean, infected, `.zip`, new scan, purge and
      status;
    - failure cases with a fake `clamd`: limit, down and old database;
    - `antivirus.mjs`.
  - **A finding in the test:** on the first startup, `clamd` may load the old database
    while `freshclam` is still downloading the new one. The System status showed the alert
    correctly, and a `RELOAD` solves it; the README explains.

### 50. Optional two-factor authentication (2FA)
- **Proposal:**
  - **Optional, per user**, configured in My Account in its own **2FA** tab.
  - **TOTP** (6-digit codes every 30 s), compatible with Google Authenticator,
    Microsoft Authenticator, Aegis, 1Password etc.
  - **Enable:** the tab shows the QR code and the key to type by hand; the person confirms
    with a code from the app and receives **10 recovery codes** (single use,
    shown once, with Copy and Download).
  - **Login:** after the right password, whoever has 2FA sees the "Verification code"
    step (it also accepts a recovery code). Without the code, no session is created.
  - **Disable** or **generate new recovery codes**: asks for the password and a code.
  - **Admin:** "Disable 2FA" in the Users tab for whoever lost the phone (with
    confirmation), and a column showing who has 2FA active.
- **Security:**
  - TOTP secret stored encrypted (AES-GCM with a key derived from
    `SESSION_SECRET`); recovery codes only as hashes.
  - A ±1 step (30 s) window for a fast/slow clock; a code already used does not
    work again.
  - An attempt limit at the code step, as at login; wrong attempts enter
    the audit.
  - Audit: 2FA enabled, disabled (by the person or by the admin), recovery codes
    generated and login with a recovery code.
- **Together with item 48:** whoever needs to change the password and has 2FA goes through the
  code first and then the change.
- **API tokens** keep working without 2FA (they are for scripts); 2FA protects the login
  through the browser.
- ✅ **Implemented:** migration `20261110000000_two_factor`.
  - **Database:**
    - `twoFactorSecret`, `twoFactorPendingSecret`, `twoFactorEnabledAt` and
      `twoFactorLastStep` fields in `User`;
    - a `TwoFactorRecoveryCode` model;
    - audit `TWO_FACTOR_ENABLED`, `TWO_FACTOR_DISABLED`,
      `TWO_FACTOR_RECOVERY_CODES` and `TWO_FACTOR_RECOVERY_USED`.
  - **`lib/two-factor.ts`** (no dependency for TOTP; `qrcode` only for the QR in SVG):
    - Base32, HOTP/TOTP checked against the RFC 6238 vectors;
    - a ±1 step window, without repeating the same step;
    - secret encrypted with AES-256-GCM;
    - recovery codes "xxxx-xxxx" (without 0/1/o/l) stored as SHA-256;
    - the login challenge signed with HMAC, valid for 5 minutes.
  - **Login:** the right password returns `{ twoFactorRequired, challenge }`, without a session.
    `POST /api/auth/login/2fa { challenge, code }` creates the session.
    - It accepts the app code or a recovery code.
    - A wrong code responds 401 and records "incorrect 2FA code" in the audit.
    - 5 attempts every 5 minutes per user; the block is audited.
  - **My Account > 2FA** (`components/TwoFactorTab.tsx`):
    - **Situation and recovery:** situation and how many codes remain (orange with 3 or
      fewer).
    - **Enable:** QR, key in groups of 4 with Copy and the code field. The activation
      shows the codes once, with Copy, Download (.txt) and "I saved the codes".
    - **Generate new codes / Disable 2FA…:** they ask for password and code, and disabling asks for
      confirmation.
  - **Login screen:** the "Two-step verification" step has the Code field, Back
    and the recovery code hint.
    - **Destination with a recovery code:** the auth context keeps the post-login destination
      and the "/" route respects it. Without that, the swap from visitor routes to
      logged-in user routes would override the `navigate`.
  - **Administration > Users:** a 2FA column and **Disable 2FA** (confirmation, audit
    "by the admin").
  - **With item 48:** the temporary password typed in the first step goes on to the mandatory
    change after the code.
  - **`SESSION_SECRET` changed:** the secret no longer decrypts. Login responds "This account's
    2FA needs to be set up again…" instead of a 500 error, and the recovery codes
    keep working.
  - **Tests:**
    - 34 integration (Postgres), with the codes computed as the app would;
    - `two-factor.mjs`.

## Standalone item — 51

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 51 | Password policy | password policy / expiration | 🔴 | M | ✅ |

### 51. Password policy
- **Decision:** minimum of 8 characters, with at least one number and one special character;
  validity of 90 days, except for admins. No email for now.
- **Proposal:**
  - **Format rule** everywhere someone chooses a password: sign-up with a
    key, Change password (My Account) and the "Set new password" screen. The API refuses with
    an error on the field ("include at least one number" / "…one special character"); the screens
    show the rule and highlight the field.
  - **Validity of 90 days** (`PASSWORD_MAX_AGE_DAYS`, `0` turns it off), counted from the last
    change (`User.passwordChangedAt`). Admins do not expire.
  - **Expired password:** on login, the person lands on the same "Set new password" screen as item
    48, with the text "Your password expired (90 days)…". Until changing it, the API refuses the rest,
    including the person's API tokens.
  - **Warning before it expires:** in the last 7 days, a strip at the top of the app "Your password
    expires in N days. [Change password]" and the validity date in the Password tab (it is the warning
    while there is no email).
  - **Admin:** "· password expired" next to the status in the Users tab.
- **Careful:**
  - Current passwords outside the rule keep working; the rule applies on the next change.
  - In the migration, the deadline starts counting from the migration date for all accounts.
  - The temporary password of the admin reset already forces the change (item 48), so it does not
    need to follow the rule.
  - The new password still has to be different from the current one.
- ✅ **Implemented:** migration `20261111000000_password_policy`
  (`User.passwordChangedAt`).
  - **Rule** (`lib/password-policy.ts`, mirrored in `web/src/auth/passwordPolicy.ts`):
    - zod with its own messages ("minimum of 8 characters", "include at least one
      number", "include at least one special character");
    - `issueMessage` starts passing the custom regex message through;
    - special character = not a letter (including accented), digit or space.
  - **Where it applies:** sign-up, `POST /api/me/password` and the "Set new password" screen. The
    front end blocks before sending, with the rule on the field and the highlight.
  - **Validity** (`PASSWORD_MAX_AGE_DAYS=90`):
    - `passwordState()` computes whether the password must be changed and why
      (`reset` | `expired`), and the validity date;
    - admins do not expire;
    - the session, the login and the tokens use that calculation. With an expired password, the same
      block as item 48 applies: 403 `PASSWORD_CHANGE_REQUIRED` and refused tokens, with
      its own message;
    - the mandatory change opens a new session and renews the validity; the audit records
      "mandatory change (expired password)".
  - **Warnings** (`components/PasswordExpiryNotice.tsx`):
    - **top of the app, in the last 7 days:** "Your password expires in N days. Change password",
      or "Your password expires today.";
    - **Password tab:** "Your password is valid until … (N days). Changing it gives 90 more days.", or
      "No expiry" for admin.
  - **"Set new password" screen:** the text changes when the password expired ("your password
    expired (90-day validity)").
  - **Users (Administration):** "· password expired" (computed in the API, without exposing the
    change date).
  - **Tests:**
    - 22 integration (Postgres): rule, accented letters and space, expired, token,
      admin, validity off, old password outside the rule and the priority of "reset";
    - `password-policy.mjs`;
    - `force-password.mjs` adjusted to the rule.

## Fifth batch — ideas 52 to 65

More value in the day-to-day triage, deeper analysis and a few account and
team adjustments, always in the HP Service Manager 9 visual pattern.

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 52 | "Take the next one" | Next in queue | 🔴 | P | ✅ |
| 53 | P1–P4 priority with its own deadline | Priority / SLA by priority | 🔴 | M | ✅ |
| 54 | Suspicious email (.eml) | record attachments | 🔴 | M–G | ✅ |
| 55 | Cases (group samples) | Incident linked to Interactions | 🔴 | G | ✅ |
| 56 | YARA rules | business rules | 🟡 | M | ✅ |
| 57 | Hex viewer | attachment viewed in the record | 🟡 | P | ✅ |
| 58 | Compare two samples | record comparison | 🟡 | M | ✅ |
| 59 | MITRE ATT&CK in the reports | categorization | 🟡 | M | ✅ |
| 60 | IOC alerts (watchlist) | Alerts | 🟡 | P–M | ✅ |
| 61 | Active sessions | account security | ⚪ | P | ✅ |
| 62 | Shared views | team queues | ⚪ | P–M | ✅ |
| 63 | Knowledge base | Knowledge Management | 🔴 | M–G | ✅ |
| 64 | Submission quota | limits | ⚪ | P | ✅ |
| 65 | Outbound webhooks | integrations | ⚪ | M | ❌ (out, for now) |

**Order (one step per item, with tests, documentation and its own commit):**
52 → 57 → 53 → 61 → 60 → 56 → 59 → 58 → 62. Then 54, 55 and 65 according to the decisions;
63 and 64 if they still make sense.

**Decisions (10/23/2026) and the batch's second stage:** 64 → 63 → 54 → 55.
- **54:** sender, recipients and email body appear to everyone.
- **55:** cases only for analysts and admins; a sample can be in several cases; the
  case has no report of its own and always has at least one sample.
- **63:** high priority.
- **64:** 20 submissions per day for regular users; analysts and admins without limit.
- **65:** no webhooks for now.

**Before any code:**
- **54:** emails carry personal data of the victims; who sees the full headers?
- **55:** it is the biggest in the batch (lists, Dashboard, reports); confirm that it fits the flow.
- **65:** it sends data outside; which destinations and what may go out?

### 52. "Take the next one"
- **Problem:** with several pending samples, each analyst chooses by hand and sometimes
  two take the same one.
- **Proposal:** a **Take the next one** button in the queues bar (Pending, Assigned to
  me, Overdue) and on the analysts' Home Page. It assigns to the analyst the
  **oldest pending sample without an assignee** (overdue ones first), changes it to In
  analysis and opens the card.
- **Careful:** two clicks at the same time cannot take the same sample (atomic assignment
  in the database); with nothing in the queue, it warns "No pending sample without an assignee";
  duplicates and samples in the trash stay out; it enters the history as an assignment.
- ✅ **Implemented:** `POST /api/entries/next` (analysts only).
  - **Order:** the oldest pending sample without an assignee in the status (`statusChangedAt`), so
    the overdue ones come first. Duplicates and samples in the trash stay out.
  - **No dispute:** the assignment only applies if the sample is still pending and without an owner
    (`updateMany` with those conditions). Whoever loses the race tries the next one, up to 5
    times; the test with 4 analysts at the same time checks that each sample ends up with a single
    owner.
  - **Effect:** the sample is assigned to whoever took it and In analysis, with both events
    in the history.
  - **Empty queue:** 404 "No pending sample without an assignee."
  - **Front end** (`components/useTakeNext.ts`): a **Take the next one** button in the
    Global History bar (all queues) and a link on the analysts' Home Page. It opens the
    card; with an empty queue, the notice appears in the bar and the screen does not change.
  - **Tests:** 8 integration (Postgres), including the race, and `take-next.mjs`.

### 53. P1–P4 priority with its own deadline
- **Proposal:** a **Priority** field (P1 Critical, P2 High, P3 Medium — default, P4 Low)
  in the triage, in the bulk update and in the column/filter of the lists; the alert and
  overdue deadline (item 24) starts depending on the priority (suggested default: P1 2 h/4 h, P2 8 h/24 h,
  P3 24 h/72 h, P4 72 h/120 h, configurable). The queues sort by priority and age.
- **Careful:** old samples become P3 (today's behavior); a priority change
  enters the history.
- ✅ **Implemented:** migration `20261112000000_priority` (`Priority` enum,
  `Entry.priority` defaulting to P3, an index with status and age, a `PRIORITY_CHANGED` event).
  - **Deadlines** (`lib/sla.ts`):
    - P1 2 h / 4 h, P2 8 h / 24 h, P3 24 h / 72 h and P4 72 h / 120 h;
    - P3 stays in `SLA_WARN_HOURS` / `SLA_LATE_HOURS`, and the others come from
      `SLA_P1_HOURS`, `SLA_P2_HOURS` and `SLA_P4_HOURS` ("alert/overdue");
    - `slaWhere()` builds the "past the deadline of its own priority" filter and replaces the
      single cutoff everywhere: the Deadline filter, the Overdue counter, the Dashboard and the
      System status.
  - **API:**
    - a `priority` filter and `sort=priority` (most urgent first, tie by
      age);
    - a field in the triage (`PATCH`) and in the bulk update, analysts only;
    - a Priority column in the CSV;
    - `sla.byPriority` in the responses;
    - "Take the next one" (52) now chooses by priority and then by age.
  - **Front end:**
    - **Lists:** a Priority column (P1 red, P2 orange, P3 blue, P4 gray); the
      first click on the column shows the most urgent first.
    - **Filter and deadline:** a Priority filter in the Global History; the Age uses the sample's
      priority deadline, and the tip shows its limits.
    - **Card:** priority in the summary, and in the triage the field shows the deadline of the chosen
      priority.
    - **Bulk and history:** a field in the bulk update; "Priority: P3 Medium → P2
      High" in the history.
  - **Tests:** 15 integration (Postgres) and `priority.mjs`.

### 54. Suspicious email (.eml) — pending decision
- **Proposal:** submit the `.eml` of a phishing email: the card shows sender, recipients,
  subject, date, authentication (SPF/DKIM/DMARC from the header), the server path and the
  links; each attachment becomes a "child" sample linked to the email (and goes through the antivirus and
  the reputation).
- **Decision:** personal data of the victims (recipients, body).
- **Decided:** sender, recipients and body appear to everyone who sees the sample.
- **How it will be:**
  - an `.eml` (or `message/rfc822`) submitted as a file is read in the API with `mailparser`
    (MIT); nothing is executed and the HTML is never rendered (it becomes text);
  - the card gains the **Email** section: sender, Reply-To, recipients (To/Cc), subject,
    date, Message-ID, SPF/DKIM/DMARC result (from `Authentication-Results`), the
    server path (`Received`, from the oldest to the newest), the links in the body and the
    body as text;
  - each attachment becomes a **child** sample ("Attachment of: …"), with antivirus, reputation,
    YARA and static analysis like any submission; the email card lists the attachments;
  - the links and the sender's domain enter as suggested IOCs for the report;
  - the submission quota (64) counts the email and each attachment.
- ✅ **Implemented:** migration `20261119000000_email_samples` (`Entry.emailInfo`,
  `Entry.parentEntryId`).
  - **Library:** we swapped `mailparser` for **`postal-mime` 2.7.6** (MIT-0, same
    author, no dependencies), pinned at an August/2026 version.
    - Why the swap: `mailparser` up to 3.9.10 brings dependencies with alerts
      (`linkify-it` with quadratic DoS, an old `nodemailer`), and a phishing email is
      attacker content. The fixed versions came out this week.
  - **Reading** (`lib/eml.ts`):
    - an `.eml` or `message/rfc822` file is only treated as an email if it has at least
      one typical header (From, To, Subject, Date, Received or Message-ID);
    - what is read: subject, sender, Reply-To, To/Cc (up to 50), date, Message-ID,
      SPF/DKIM/DMARC from the first `Authentication-Results` and the `Received` path,
      from the first server to the last;
    - http(s) links from the text and the `href`s (up to 100);
    - the body as **text**, up to 20 thousand characters. HTML becomes text: script, style and
      tags leave, and the entities become letters, including the accented ones.
  - **Submission** (`createFileEntry`):
    - each attachment becomes a child sample (`parentEntryId`), with antivirus, reputation,
      YARA and static analysis;
    - a forwarded email as an attachment is also read, up to 3 levels;
    - limits: 20 attachments per email, `MAX_UPLOAD_MB` per attachment; what stays out
      appears with the reason;
    - each attachment uses one quota slot (64): those over the limit become "not
      sent: submission quota reached";
    - without a title of its own, the sample receives "Email: <subject>";
    - the list does not load the `emailInfo`.
  - **Card:**
    - the **Email** section: subject, From, Reply-To (with a warning when the domain is
      different from the sender's), To/Cc, date, Message-ID, SPF/DKIM/DMARC with colors, the
      numbered path, the links as text only (with Copy) and the body as text;
    - the **Attachments** section, with a link to each child sample or the reason it was not
      sent;
    - the child shows "Attachment of: …" at the top;
    - "Insert suggested IOCs" in the report includes the links and the domains of the sender
      and of the Reply-To.
  - **Tests:** 15 integration (Postgres and MinIO, with a real `.eml`) and
    `email.mjs`.

### 55. Cases — pending decision
- **Proposal:** group samples of the same campaign in a **Case** with title, status,
  assignee, timeline and a report of its own; the card shows the case; a case list
  in the navigator.
- **Decided:** only analysts and admins see and touch them; a sample can be in several
  cases; **no report of its own** (the case shows the samples' reports); every case
  has at least one sample.
- **How it will be:**
  - a case with title, description, status (Open → In progress → Closed) and assignee;
  - create from the card ("More ▾ > Add to case…", new or existing) or from the
    samples checked in the list ("Create case with the N"); there is no empty case: removing the
    last sample is refused (close the case);
  - the case screen: editable data, samples (with verdict and status), published
    reports of the samples, timeline (created, sample added/removed, status,
    assignee, comments) and comments;
  - the sample card shows its cases; a **Cases** folder in the navigator (open,
    mine, all) with a counter; the sample history records the addition/removal.
- ✅ **Implemented:** migration `20261120000000_cases`:
  - `Case`: a sequential number shown as `CASO-0001`, title, description, status,
    assignee, author and `closedAt`;
  - `CaseEntry` (sample ↔ case, with who added it and when) and `CaseEvent` (the
    timeline);
  - `CASE_ADDED`/`CASE_REMOVED` events in the sample history.
  - **API** (`routes/cases.ts`, analysts and admins only; a regular user receives 403):
    - `GET /api/cases?status=&assignee=&q=` (`active` = not closed; the search accepts
      the code, e.g. `caso-0002`) and `GET /api/cases/counts` (`{ active, mine }`);
    - `POST /api/cases { title, description?, entryIds[] }` requires at least one sample
      and creates the case with the creator as assignee;
    - `GET /api/cases/:id` brings the samples (verdict, status, priority, who
      added it) with the **published** reports of each one, and the timeline;
    - `PATCH` changes title, description, status (closing records the date; reopening clears
      it) and assignee (active analyst only). Each change becomes an event;
    - `POST /:id/entries` adds only the new samples; `DELETE /:id/entries/:entryId`
      refuses to remove the last one (409: "close the case");
    - `POST /:id/comments`; `GET /api/entries/:id/cases` brings the sample's cases.
  - **Front end:**
    - a **Cases** folder in the navigator (analysts only): "Active cases (n)", "My cases
      (n)" and "All cases";
    - the `/casos` list with search, status and assignee, all in the URL;
    - the `/casos/:id` screen, with the code in the workspace tab:
      - editable data (Ctrl+S, confirmation when leaving without saving);
      - samples with "Remove…" (with confirmation, disabled on the last one) and "Add
        sample" by ID or link;
      - published reports of the samples (verdict, analyst, ATT&CK, summary);
      - timeline and comments;
    - an **Add to case…** box (active or new case, with search), in the card's More menu
      and in the bar of the checked samples;
    - the card shows "Cases: CASO-0001" at the top;
    - a regular user does not see the folder, the menu or the screen.
  - **Tests:** 28 integration (Postgres) and `cases.mjs`.

### 56. YARA rules
- **Proposal:** a **YARA Rules** tab (analysts and admin): create, edit, enable/disable
  rules with syntax validation; the ClamAV that already runs loads the rules (`.yar` files
  in its database) and each hit appears in the card's Antivirus section ("YARA: rule_name").
- **Careful:** a rule with a syntax error never reaches ClamAV (otherwise it does not reload);
  reload ClamAV after saving.
- ✅ **Implemented** (with a change of route): instead of writing `.yar` to the ClamAV database,
  the API compiles and applies the rules with **YARA-X** (`@virustotal/yara-x`, VirusTotal's
  official engine, in WebAssembly and without a native binary).
  - **Why the change:** a rule with an error is refused immediately, with the line, and never gets
    to bring the antivirus down. No need to reload `clamd` or share a volume.
    The result is also richer: rule, set, tags, description and occurrences.
  - **Database:** migration `20261115000000_yara_rules`:
    - `YaraRule`: unique name, description, source, active, author and last editor;
    - `YaraScan`: the last scan per sample, with the hits in JSON;
    - audit `YARA_RULE_CREATED`/`UPDATED`/`DELETED`.
  - **Engine** (`lib/yara.ts`):
    - the active rules are compiled together, each set in its own namespace (two
      sets may repeat the identifier);
    - the compilation is cached and only redone when some rule changes;
    - the scan has a 10 s time limit and at most 100 occurrences per string;
    - a set that stops compiling does not bring the others down.
  - **When it scans:** every uploaded file (including the ones from a `.zip` and token
    submissions), in the background and only if there is an active rule. Analysts have "Scan again"
    on the card. A new rule applies to the next submissions; there is no retroactive scan.
  - **API** (`routes/yara.ts`, analysts and admins):
    - `GET`/`POST /api/yara/rules`, `PATCH`/`DELETE /api/yara/rules/:id`;
    - the `PATCH` with only `{ enabled }` enables or disables;
    - `POST /api/yara/validate` validates without saving;
    - a compilation error comes back as 400 in `details.source`;
    - `GET`/`POST /api/entries/:id/yara` brings the result and scans again.
  - **Front end:**
    - a **YARA Rules** screen (`/yara`), in the navigator's **Detection** folder, only for
      analysts and admins (a regular user goes back to the start);
    - a monospaced editor with **Validate**, **Save rule** (Ctrl+S) and the "Compiler"
      box with the YARA-X output;
    - the list has situation, editor and date, with Edit / Enable / Disable / Delete;
    - on the card, the **YARA Rules** section brings the situation, the applied sets and the
      hits table (rule, set, tags, description, occurrences);
    - the top of the card shows "YARA: rule, rule (+N)";
    - the section stays hidden while there is no active rule or scan.
  - **Tests:** 28 integration (Postgres and MinIO, with the real YARA-X) and `yara.mjs`.

### 57. Hex viewer
- **Proposal:** a **Content (hex)** section in the Analysis tab: the first 4 KB of the file in
  hexadecimal + text, with "Show more" 4 KB at a time (up to 64 KB) and a highlight of the known
  header (MZ, PK, %PDF...). Analysts only; nothing is downloaded or executed.
- **Careful:** read from MinIO by range (without bringing the whole file); a purged file
  shows the retention notice.
- ✅ **Implemented:** `GET /api/entries/:id/hex?offset=&length=` (analysts only).
  - It reads from MinIO only the requested range (`Range`), in blocks of up to 4 KB, up to 64 KB from the
    start of the file. Returns `{ offset, size, limit, data }`, with `data` in base64.
  - It refuses a link (400), a purged file (410) and whoever is not an analyst (403).
  - **"Content (hex)" section** in the Analysis tab (`components/HexViewer.tsx`):
    - it only loads with **Show content**;
    - lines with offset, 16 bytes (split 8 + 8) and text, and **Show 4 KB more**;
    - the **known header** highlighted and named: MZ, ELF, PK, %PDF, OLE, RAR, 7z,
      PNG, JPEG, GIF and GZIP.
  - **Tests:** 10 integration (real MinIO, checking the bytes of each range) and
    `hex-viewer.mjs`.

### 58. Compare two samples
- **Proposal:** "Compare with…" in the card's More menu (or two checked in the list): side by
  side the real type, size, entropy, SHA-256, strings and IOCs, with what is common and what is
  only in each one.
- ✅ **Implemented** (no migration; analysts and admins only):
  - **API** `GET /api/entries/compare?a=&b=` (`routes/compare.ts`):
    - the fields on each side: type, real type, file, size, SHA-256, entropy,
      total strings, PE summary, URL, verdict, status, priority, who submitted it and
      when;
    - `sameContent` when the SHA-256 is equal;
    - for each list, `{ common, onlyA, onlyB }` (up to 200 items). The lists are the IOCs
      (published reports + the hash/domain itself), the URLs, IPs, emails, paths,
      registry keys and suspicious strings from the static analysis, the DLLs and suspicious
      imported functions, the PE sections, the YARA rules (56) and the ATT&CK techniques
      (59, only from published reports);
    - the same sample gives 400; nonexistent, 404; regular user, 403.
    - Nothing is executed or read from MinIO: it uses the analysis stored at submission.
  - **Front end:**
    - "Compare the 2" in the list selection bar, only with exactly two checked;
    - "Compare with…" in the card's More menu, with the same box as the duplicate:
      suggested related ones or ID/link. The box became `EntryPickDialog`, which both
      use;
    - the **Compare samples** screen (`/comparar?a=&b=`, its own workspace tab):
      - a "Side by side" table with the differing rows highlighted and marked
        "(differs)"; empty rows on both sides do not appear;
      - one section per list with three columns: "Only in A", "Common" and "Only in B";
      - "Swap sides" and a same-content notice;
    - a regular user goes back to the start.
  - **Tests:** 17 integration (Postgres) and `compare.mjs`.

### 59. MITRE ATT&CK in the reports
- **Proposal:** an ATT&CK technique field in the report (search by code or name, e.g.
  T1566 Phishing); the techniques appear on the card, become a filter in the lists and a "most
  seen" panel on the Dashboard. An embedded technique list (without querying outside).
- ✅ **Implemented:** migration `20261116000000_attack_techniques`
  (`Report.attackTechniques`, `text[]` with a GIN index).
  - **Embedded list:** `lib/attack-enterprise.json` brings ATT&CK Enterprise v20.0:
    706 techniques and sub-techniques (without the revoked or deprecated ones) and 15 tactics. It was extracted
    from the official `mitre-attack/attack-stix-data` repository, with code, name and tactics.
    Nothing is fetched outside at runtime. To update, replace the file.
  - **API:**
    - `GET /api/attack` returns the list, with a one-day cache in the browser;
    - `attackTechniques` in `POST /api/entries/:id/reports` and in `PATCH /api/reports/:id`:
      at most 30, normalized (uppercase, without repeats, in ATT&CK order);
    - an unknown code comes back as 400 in `details.attackTechniques`;
    - an `attack=T1566` filter in `GET /api/entries` and in the CSV: samples with a
      **published** report with the technique. The parent technique code also finds the sub-techniques;
    - `techniques` in `GET /api/dashboard`: the 10 most seen in reports published
      or edited in the period, counting each sample once and without the trash. A regular
      user sees only their own samples.
  - **Front end:**
    - a **ATT&CK techniques** field in the new report, a combobox: search by code or by
      name (without accents and case), arrows + Enter or click to choose, tags with
      ×, and Backspace in the empty field removes the last one;
    - in the report, the techniques appear as links ("T1566.001 Spearphishing
      Attachment", with the tactics in the title) to the filtered Global History;
    - the top of the card shows "ATT&CK: …" with the techniques of the published reports;
    - an **ATT&CK** filter in the Global History, with browser suggestions; it only applies a
      code that exists;
    - in My Uploads, the filter appears as a removable tag;
    - on the Dashboard, the **Most seen ATT&CK techniques in the period** panel: bars, and the
      number leads to the filtered list.
  - **Also:** `refine`/`superRefine` messages now reach the field (before they
    became "invalid value").
  - **Tests:** 24 integration (Postgres) and `attack.mjs`.

### 60. IOC alerts (watchlist)
- **Proposal:** "Follow" on the indicator card (IP, domain, email, hash): when the
  indicator appears in a new sample (hash/domain on submission) or in a published report,
  whoever follows it receives a notification in the Inbox. A list "Indicators I follow" in
  My Account.
- ✅ **Implemented:** migration `20261114000000_ioc_watch` (`IocWatch` model, one per
  person and indicator; `IOC_SEEN` notification).
  - **When it warns** (`lib/ioc-watch.ts`):
    - **new sample:** the file's SHA-256, or the link's domain/IP (including the
      files of a `.zip` and the token submissions);
    - **published report:** `syncReportIocs` compares the indicators before and
      after and only warns about the new ones; editing the report without a new indicator does not repeat.
  - **How it warns:** one notification per person and per event, with the first indicator and
    "(+N)". Whoever did the action is not warned, and the initial indexing on startup does not warn
    anyone.
  - **API:**
    - `POST`/`DELETE /api/iocs/:kind/:value/watch`, with the same validation as the card and at
      most 200 per person;
    - `watching` in `GET /api/iocs/:kind/:value`;
    - `GET /api/me/watches`.
  - **Front end:**
    - **Follow / Unfollow** (with the bell) in the indicator card bar;
    - an **Indicators** tab in My Account, with type, link to the card, since when and
      "Unfollow";
    - the notification "Indicator you follow: Domain x (+1) in a published report",
      which opens the Reports tab when it came from a report.
  - **Tests:** 16 integration (Postgres and MinIO) and `ioc-watch.mjs`.

### 61. Active sessions
- **Proposal:** a **Sessions** tab in My Account: each session with browser/system, IP,
  start and last access, the current one marked; "End" one and "End the others".
  Audit of the ending.
- ✅ **Implemented:** migration `20261113000000_session_details` (`Session.userAgent`,
  `ip`, `lastSeenAt`; audit `SESSION_REVOKED`).
  - **Recording:** `createSession` records the User-Agent and the IP (login, 2FA and mandatory
    change). `loadUser` updates the last access at most every 5 minutes, or right
    away if the IP changes.
  - **API** (`routes/sessions.ts`):
    - `GET /api/me/sessions` with browser and system (`lib/user-agent.ts`: Chrome,
      Edge, Firefox, Safari, Opera; Windows, macOS, Linux, Android, iOS), IP, entry,
      last access and which one is the current;
    - `DELETE /api/me/sessions/:handle`; the current one leaves through Sign out;
    - `POST /api/me/sessions/revoke-others`;
    - audit with the device and the IP.
  - **Security:** the session id is the cookie secret itself, so the list uses only a short
    hash of it (`handle`). The test checks that the id does not appear.
  - **My Account > Sessions** (`components/SessionsTab.tsx`):
    - a table with the current one marked and the full User-Agent in the tip;
    - **End…** with confirmation;
    - **End the other sessions**, disabled when there is only the current one.
  - **Tests:** 18 integration (Postgres), including another person's sessions
    untouched, and `sessions.mjs`.

### 62. Shared views
- **Proposal:** when saving a view (filters), analysts choose "share with the
  team": it appears in a **Team views** folder in every analyst's navigator,
  with a counter. Only whoever created it (or an admin) edits/removes it.
- ✅ **Implemented:** migration `20261117000000_team_views` (`TeamView`: name, unique
  address, who shared it).
  - **API** (`routes/team-views.ts`, analysts and admins only):
    - `GET /api/team-views` brings the views in alphabetical order, with `count` and `canEdit`;
    - the `count` is computed with the same filter as the list (`ListQuery`/`listWhere`) for
      whoever is viewing, so "Assigned to me" counts each one's. The trash does not
      enter, and an address that is no longer valid becomes `null`;
    - `POST` accepts only Global History views (`/history?…`). A repeated address
      gives 409 with the name already used; the limit is 30;
    - `PATCH` (rename) and `DELETE` only for whoever shared it or an admin (403 for the
      others). If the author is deleted, the view stays and only the admin changes it.
  - **Front end:**
    - a **Share view** button in the Global History filter bar, only for
      analysts, with the name suggested as in "Save view";
    - a **Team views** folder in every analyst's navigator, with the counter
      (updates every minute) and "shared by …" in the title;
    - whoever can change it has a context menu (Open, Rename, Remove from the team) and
      the Shift+F10, F2 and Delete keys. Removing asks for confirmation, warning that it disappears
      for everyone;
    - a regular user does not see the folder or the button and does not query the API.
  - **Tests:** 20 integration (Postgres) and `team-views.mjs`.

### 63. Knowledge base (optional)
- **Proposal:** articles (Markdown) about malware families and scams, with search, linked
  to the reports that cite them.
- **Decided:** important (goes up to high priority).
- **How it will be:**
  - an article with title, summary, category (Malware family, Scam, Technique, Procedure),
    tags and body in Markdown; analysts and admins write, everyone reads;
  - Markdown rendered by its own safe renderer (headings, paragraphs,
    lists, bold/italic, code, quotes, http/https links and links to the app itself);
    no HTML from the text is accepted;
  - a **Knowledge base** screen (`/kb`) with search (title, summary, tags and body) and
    a category filter; the article with "Edit" (preview beside it) and a history of
    who changed it;
  - reports cite articles ("Knowledge base articles" field with search); the report shows the
    links and the article lists the published samples/reports that cite it;
  - "Go to:" finds articles by title.
- ✅ **Implemented:** migration `20261118000000_knowledge_base`:
  - `KbArticle`: unique title, summary, category, tags, body, author and last editor;
  - `KbArticleRevision`: the previous version, kept on every edit;
  - a many-to-many link `Report.kbArticles`.
  - **API** (`routes/kb.ts`):
    - `GET /api/kb?q=&category=` (everyone): case-insensitive search in title, summary, text and
      tags; matching titles come first; it brings `citations` (published reports);
    - `GET /api/kb/:id`: body, author, the last 20 edits (who and when) and the
      **published** reports that cite the article, without the trashed samples;
    - `POST`/`PATCH` only for analysts and admins. A repeated title gives 409, and the tags go
      lowercase, without repeats (up to 10). Each `PATCH` keeps the previous version;
    - `DELETE`: whoever created it or an admin. The reports only lose the link;
    - reports: `kbArticleIds` in the `POST`/`PATCH` (up to 10; a nonexistent article gives 400
      on the field), and `kbArticles` (id and title) in the report and on the card.
  - **Front end:**
    - **Knowledge base** at the top of the navigator, for everyone;
    - the `/kb` list with search and category (kept in the URL) and cards with category, tags,
      update and "Cited in N reports";
    - the `/kb/:id` article, with the title in the workspace tab, Edit, Delete (for whoever
      can), "Cited in" and "Changes";
    - the `/kb/novo` and `/kb/:id/editar` editor: required fields highlighted, Ctrl+S,
      confirmation when leaving without saving and **preview beside it**;
    - **Markdown** (`components/Markdown.tsx`): its own renderer, without HTML and without a
      new dependency. It draws headings, lists, quotes, code, bold/italic and
      links. Only http/https addresses become links (in a new tab, without an opener) and app
      paths; a bare URL stays as text, so nobody clicks a malicious domain by
      mistake, and `<script>` appears as text;
    - report: a **Knowledge base articles** field (search, arrows + Enter, tags) and links when
      reading;
    - "Go to:" with the exact title opens the article, and `kb: term` searches the base.
  - **Tests:** 24 integration (Postgres) and `kb.mjs`.

### 64. Submission quota (optional)
- **Proposal:** a submission limit per regular user per day (`UPLOAD_DAILY_LIMIT`), with a
  clear message on reaching it; analysts and admin without limit.
- **Decided:** 20 per day for regular users; analysts and admins without limit.
- **How it will be:** `UPLOAD_DAILY_LIMIT=20` (0 turns it off), counted in the last 24 hours
  (file, link, each file of a `.zip` and token submissions); above the limit, 429
  with "you have already submitted 20 samples in the last 24 hours; the next one is released at HH:MM";
  "Submit Sample" shows how many submissions remain.
- ✅ **Implemented** (no migration):
  - **Rule** (`lib/quota.ts`): `UPLOAD_DAILY_LIMIT` (default 20; 0 turns it off) submissions per
    regular user in the **last 24 hours**; analysts and admins have no limit. It counts
    file, link, each file extracted from a `.zip` and the token submissions, which go
    through the same routes;
  - **Above the limit:** `POST /api/entries/file`, `/url` and `/zip` return 429 with
    `resetAt` and the message "You have already submitted 20 samples in the last 24 hours (limit
    for regular users). The next one is released in 2 h 5 min.". The `.zip` creates only the
    files that fit; the others appear as ignored with the reason ("20-submission quota
    in 24 hours reached");
  - **`GET /api/me/upload-quota`** returns `{ limit, used, remaining, resetAt }`;
  - **Submit Sample:** "N submissions left of 20 in the next 24 hours" in the bar. With the
    quota exhausted, the notice appears with the local time of the next slot and the Submit
    button stays disabled;
  - **Tests:** 13 integration (Postgres and MinIO) and `quota.mjs`.

### 65. Outbound webhooks — pending decision
- **Proposal:** notify Slack/Teams/SIEM (POST JSON) when a sample is completed as
  malicious or suspicious.
- **Decision:** allowed destinations and what may go out (only the hash? title? report?).
- **Decided (10/23/2026):** no webhooks for now.

## Technical item — 66. Migration to Prisma 7

- **Why:** the API's `npm audit` flags `deepmerge-ts` < 8 (a high alert), which comes
  pinned inside Prisma 6.19.3. The fix only exists in Prisma 7.10.1, which uses
  `deepmerge-ts` 8.0.2.
- **What changes in Prisma 7** (the official upgrade guide):
  - the `prisma-client-js` generator gives way to `prisma-client`, with a mandatory `output`
    (the client leaves `node_modules` and starts being generated in the project);
  - every database needs a **driver adapter** (PostgreSQL: `@prisma/adapter-pg`, with
    `pg`);
  - the database URL, the migrations and the seed leave `schema.prisma` and `package.json` and
    move to `prisma.config.ts`;
  - `.env` is no longer loaded by itself, and `migrate diff` swaps
    `--shadow-database-url` for the configuration;
  - Node ≥ 20.19 / 22.12 and TypeScript ≥ 5.4 (we already meet it: Node 22 in Docker,
    TypeScript 5.6).
- **Plan (in steps, without changing behavior):**
  1. **Packages:** `prisma` and `@prisma/client` 7.10.1 and `@prisma/adapter-pg` 7.10.1,
     with pinned versions.
  2. **Schema and configuration:**
     - `prisma-client` generator with `output = "../src/generated/prisma"` and
       `moduleFormat = "cjs"`. The API stays in CommonJS, without converting everything to ESM;
     - `prisma.config.ts` with the schema, the migrations, the seed and `DATABASE_URL` (and
       `SHADOW_DATABASE_URL` for whoever generates migrations);
     - no `url` in the schema's `datasource`; the `prisma.seed` block leaves `package.json`.
  3. **Client:** `lib/prisma.ts` creates the `PrismaClient` with `PrismaPg`, preserving the
     trash filter (`$extends`). The pool stays close to Prisma 6: a 5 s connection timeout,
     because `pg` has no limit by default.
  4. **Imports:** the 29 files that import from `@prisma/client` start importing from the
     generated client (`src/generated/prisma/client`), including `prisma/seed.ts`.
  5. **Build and Docker:**
     - the generated code stays out of git, lint and prettier;
     - the Dockerfile copies `prisma.config.ts` before `prisma generate`;
     - the entrypoint keeps `migrate deploy` and `db seed`.
  6. **Verification:**
     - typecheck, lint and build;
     - migrations from scratch on a new database and `migrate diff` without differences between the schema and
       the migrations;
     - the integration tests (Postgres and MinIO) of the most sensitive areas: transactions,
       the Dashboard raw SQL, JSON, arrays, enums, the trash filter;
     - the "System status" with the database down (the adapter's error message);
     - the full Playwright suite and `npm audit` without `deepmerge-ts`.
  7. **Documentation:** the README (how to generate the client and the migrations) and this item with the
     Implemented block.
- ✅ **Implemented** (no database migration):
  - **Packages:**
    - `prisma` and `@prisma/client` 7.10.1 and `@prisma/adapter-pg` 7.10.1, pinned;
    - the API's `npm audit` ended with **0 vulnerabilities** (`deepmerge-ts` 8.0.2).
  - **Schema and configuration:**
    - `prisma-client` generator with output in `src/generated/prisma`, CommonJS;
    - `prisma.config.ts` with the schema, the migrations, the seed (`tsx prisma/seed.ts`),
      `DATABASE_URL` and `SHADOW_DATABASE_URL`;
    - no `url` in the schema; `prisma.seed` left `package.json`. Without
      `DATABASE_URL`, `prisma generate` keeps working (image build).
  - **Client** (`lib/prisma.ts`):
    - `createPrismaClient()` uses `PrismaPg` with a 5 s connection timeout, as
      in Prisma 6;
    - the trash filter stays the same, and the seed uses the same function.
  - **Imports:** 29 files moved from `@prisma/client` to the generated client. The API
    exports the same names (enums, `Prisma`, model types), without another code
    change.
  - **System status:** with the adapter, database failures arrive as "Raw query
    failed… Code: …". `describeError` translates the common Postgres codes:
    - password refused;
    - nonexistent database;
    - database under maintenance;
    - connection limit;
    - unreachable server.
  - **Build and Docker:**
    - the Dockerfile copies `prisma.config.ts` and generates the client after copying the
      code;
    - `src/generated` stays out of git, lint, prettier and the Docker context.
  - **A side adjustment:** an old lint error in `lib/eml.ts` (a literal non-breaking
    space became `\u00a0`).
  - **Verification:**
    - typecheck, lint and build;
    - the 33 migrations applied from scratch, and `migrate diff` empty between schema,
      migrations and database;
    - idempotent seed;
    - 9 integration tests (183 checks: the Dashboard with raw SQL, JSON, arrays,
      transactions, the trash filter, P2002/P2025, email, YARA, quota, cases, knowledge
      base);
    - the real API coming up, with login, System status and Dashboard;
    - the **Docker image** applying the migrations, the seed and coming up against an empty database;
    - the database failures translated;
    - the full Playwright suite.

## Sixth batch — ideas 67 to 80

Deepen the analysis (documents, similarity, retroactive YARA), find things faster
(advanced search), divide the team's work by itself (assignment and
escalation) and close the ends of the cases and reports, always in the HP
Service Manager 9 visual pattern.

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 67 | Retroactive YARA (new rule on old samples) | business rules | 🔴 | M | ✅ |
| 68 | Advanced search (samples, reports, comments, base, cases) | Advanced Search | 🔴 | M | ✅ |
| 69 | Indicator allowlist (false positives) | exception lists | 🟡 | P–M | ✅ |
| 70 | Document analysis (PDF and Office) | calculated record fields | 🔴 | M–G | ✅ |
| 71 | Fuzzy hash similarity (TLSH) | related records | 🟡 | M | ✅ |
| 72 | Automatic assignment rules | Assignment Groups | 🟡 | M | ✅ |
| 73 | Deadline escalation | SLA escalation | 🟡 | P–M | ✅ |
| 74 | Export the case (Markdown and printing) | print the record | 🟡 | P–M | ✅ |
| 75 | Report versions (history and differences) | change history | 🟡 | P–M | ✅ |
| 76 | Evidence in the report (images) | record attachments | 🟡 | M | ✅ |
| 77 | Management report | Reports | ⚪ | M | ✅ |
| 78 | Import indicators (CSV and STIX) | data import | ⚪ | M | ✅ |
| 79 | Email notifications (SMTP) | notifications | ⚪ | M | ⏸ (no SMTP) |
| 80 | Link page capture (isolated browser) | integrations | ⚪ | G | ✅ |

**Suggested order (one step per item, with tests, documentation and its own commit):**
67 → 69 → 68 → 70 → 71 → 73 → 74 → 75 → 76 → 77 → 78. Then 72, 79 and 80 according to the
decisions.

### 67. Retroactive YARA
- **Problem:** a new YARA rule only applies to the next submissions; to know whether it
  catches old samples, one has to "Scan again" one by one.
- **Proposal:** on the YARA Rules screen, **Apply to existing samples** (per rule):
  it scans the still stored files in the background, with progress ("1,240 of 3,000"),
  and lists the samples that matched, with a link. The result stays in the card's YARA section.
- **Careful:** one retroactive scan at a time; purged files stay out;
  cancel at any time; a size limit per file; it does not block the API.
- ✅ **Implemented:** migration `20261121000000_yara_retroscan`:
  - `YaraRetroscan`: rule, rule name at the start, situation, total, scanned,
    matched, unreadable, above the limit, who started it, start and end;
  - `YaraRetroscanHit`: the samples that matched, with the identifiers.
  - **Execution** (`lib/yara-retro.ts`):
    - in the background, **one at a time** (the second gives 409);
    - the files still stored, outside the trash and up to 100 MB enter. The purged ones
      stay out, and the larger ones are counted as "above 100 MB";
    - it reads from MinIO in pages of 100 and records the progress every 10 samples;
    - a file that cannot be read counts as "unreadable" and does not interrupt the
      scan;
    - cancellation is checked on every sample; if the API restarts halfway, the
      scan stays "Failed: interrupted (API restarted)".
  - **Card:** the hits enter the YARA Rules section, merged with those of the other
    rules. Old hits of the same rule that no longer match leave.
  - **Reuse:** the compilation and the scan of `lib/yara.ts` became
    `compileRuleSets` and `scanBuffer`, used by the submission and by the retroactive scan.
  - **API** (analysts):
    - `POST /api/yara/rules/:id/retroscan` (202);
    - `GET /api/yara/retroscans`, the last 10;
    - `GET /api/yara/retroscans/:id`, with up to 500 hits;
    - `POST /api/yara/retroscans/:id/cancel`;
    - if the rule is deleted, the history keeps the name.
  - **Front end:**
    - "Apply to existing…" on each rule, with confirmation; it stays disabled
      while another scan runs;
    - a **Retroactive scans** section: situation, progress bar ("1,240 of 3,000
      (41%)"), unreadable and above the limit, how many matched and who started it. It refreshes
      every 2 s while running;
    - "View hits" shows the samples (link, verdict, status, identifiers), and
      there is "Cancel".
  - **Tests:** 15 integration (Postgres and MinIO) and `yara-retro.mjs`.

### 68. Advanced search
- **Problem:** the list search only looks at title, hash, URL and file name; what is
  in the reports, comments, knowledge base and cases does not appear.
- **Proposal:** a **Search** screen with a single field and results grouped by type: samples,
  reports (summary, findings, IOCs), comments, articles and cases, each with the excerpt
  that matched highlighted. Filters by type and period; "Go to:" leads there when the
  text is not an ID, hash or indicator.
- **Careful:** Postgres text search (Portuguese dictionary, with an index),
  respecting what each person can see (a regular user does not see cases or drafts).
- ✅ **Implemented:** migration `20261123000000_search_unaccent`, which only enables the
  Postgres `unaccent` extension.
  - **Search** (`routes/search.ts`, `GET /api/search?q=&type=&days=`):
    - Postgres text search with the Portuguese dictionary, ignoring accents:
      "cobranca codigo" finds "cobrança … código", and the typed form appears
      highlighted;
    - search engine syntax: quotes for an exact phrase and `-` to exclude a word;
    - groups:
      - samples: title, description, file and URL;
      - reports: summary, findings and IOCs;
      - comments;
      - knowledge base: title, summary, text and tags;
      - cases: title and description;
    - each result comes with the found excerpt, marked with `⟦ ⟧`. The front end highlights
      without HTML; a `<script>` in the text appears as text;
    - order by relevance; 10 per group in "All" and 50 in a single group; a period
      filter;
    - samples in the trash stay out; a regular user sees only published reports
      and does not see cases.
  - **No index for now:** an index over an expression would stay outside the Prisma
    schema, and every new migration would try to delete it. With the current volume the direct search
    is enough; if it grows, create a `tsvector` column with a GIN index.
  - **Front end:**
    - a **Search** screen (`/busca`, at the top of the navigator) with Search, In (All or one
      group) and Period, all in the URL;
    - groups with a count, links (the report opens in the Reports tab, the comment in the
      History) and "See all N in …";
    - **"Go to:"** with text that is not an ID, hash or indicator opens the Search (before
      it went to the filtered Global History).
  - **Tests:** 16 integration (Postgres) and `search.mjs`. `quick-search.mjs` and
    `iocs.mjs` were adjusted to the new "Go to:" destination.

### 69. Indicator allowlist
- **Problem:** legitimate domains and IPs (microsoft.com, google.com, the company's own domain)
  appear in the suggested IOCs, in Related and in the alerts, generating noise.
- **Proposal:** an **Allowed indicators** tab (analysts): domain (with subdomains),
  IP/range or hash, with a reason. Allowed indicators disappear from the suggestions, do not link
  samples in Related, do not trigger IOC alerts and appear marked on the indicator
  card.
- **Careful:** they never hide what was typed in the report; audit of who
  added it; an initially empty list (no "magic list").
- ✅ **Implemented:** migration `20261122000000_allowlist`:
  - `AllowedIndicator`: type, normalized value, reason and author; one per type and value;
  - audit `ALLOWLIST_ADDED`/`ALLOWLIST_REMOVED`.
  - **Rules** (`lib/allowlist.ts`):
    - a domain applies to its subdomains;
    - IPv4 accepts an IP or a CIDR range, stored by the network address
      (`10.1.2.3/8` becomes `10.0.0.0/8`);
    - hashes and emails are exact; an email is also covered by its domain, and a
      URL by the host;
    - the list is cached for 30 s and discarded on every change.
  - **Where it applies:**
    - it does not link samples in **Related**, neither by domain (including the
      base domain) nor by a shared IOC;
    - it does not trigger **IOC alerts**;
    - the **indicator card** shows "Allowed indicator (covered by …): reason",
      for everyone;
    - it disappears from the report's **suggested IOCs**, with the count of the hidden ones;
    - what the analyst writes in the report does not change.
  - **Detail:** the fixed list of omnipresent domains of the extractor (google.com,
    microsoft.com…) stays; the allowlist is the team's part.
  - **API** (analysts):
    - `GET`/`POST /api/allowlist` and `DELETE /api/allowlist/:id`. An invalid value gives
      400 on the field, with a hint for a range; a repeated one gives 409;
    - `POST /api/allowlist/filter { values }` says which suggestions are covered;
    - `allowed` in `GET /api/iocs/:kind/:value`.
  - **Front end:**
    - an **Allowed indicators** screen (`/permitidos`, Detection folder, analysts only),
      with type (the hint changes with it), indicator and reason; add with Ctrl+S; the type
      stays for the next one;
    - a table with author and "Remove" (with confirmation).
  - **Tests:** 21 integration (Postgres) and `allowlist.mjs`.

### 70. Document analysis (PDF and Office)
- **Problem:** phishing often arrives as PDF and Office; today we only see type, entropy and
  strings.
- **Proposal:** in the static analysis, for **PDF**: JavaScript, automatic actions
  (OpenAction/AA), embedded files, forms and links; for **Office** (OOXML and the old OLE
  format): the presence of **VBA macros** (module names and suspicious
  fragments: AutoOpen, Shell, CreateObject, URLDownloadToFile), embedded OLE objects and
  external links (remote template). A "Document" section on the card, with alerts.
- **Careful:** read-only access to the bytes, with limits (zip bomb, recursion); nothing is executed;
  an analysis failure does not prevent the submission.
- ✅ **Implemented** (no migration: the result goes in `staticInfo.document`):
  - **Analysis** (`lib/doc-analysis.ts`), with no new dependency. It only reads bytes, with
    limits; a failure becomes "no data", never an exception:
    - **PDF:** JavaScript, OpenAction/AA, Launch, embedded files, AcroForm/XFA,
      encryption, pages and links (`/URI`). It decodes obfuscated names
      (`/J#61vaScript`) and opens the FlateDecode streams, up to 8 MB per stream and 32 MB in
      total, where the malicious content usually hides;
    - **modern Office (OOXML):**
      - macros (`vbaProject.bin`);
      - external links and a **remote template** (`attachedTemplate`) from the `.rels`;
      - embedded objects (`/embeddings/`) and DDE fields;
    - **old Office (OLE):** its own reader of the OLE/CFB format (sectors, FAT,
      mini stream, directory tree) and of the VBA compression (**MS-OVBA**, validated
      with the specification vector). The **macro modules** come out with the source
      code (up to 20 KB per module and 100 KB in total), the routines that run on open
      (AutoOpen, Document_Open, Workbook_Open…) and the suspicious calls (Shell,
      CreateObject, URLDownloadToFile, PowerShell, Environ, Chr…);
    - **RTF:** embedded OLE objects (`\objupdate` = automatic update), DDE and
      HYPERLINK.
  - **Risk:** high when there is something that runs by itself or downloads content; medium for
    embedded objects, XFA and macros without anything suspicious; low for the rest.
  - **IOCs:** the document links enter the suggested IOCs.
  - **Card:**
    - a warning at the top when the risk is high ("document with active content…");
    - a **Document** section with risk, colored alerts, links (text only, with
      Copy) and embedded objects;
    - **VBA Macros**, with lines, "runs on open", suspicious calls and **View code**
      (the code text appears raw: a `<script>` appears as text);
    - samples submitted before get the analysis with "Analyze now" / re-analysis.
  - **Tests:**
    - 20 checks with files built in the test itself: PDF with obfuscated
      JavaScript and a link in a compressed stream, an OLE `.doc` with a VBA project, a `.docm` with
      `vbaProject.bin`, a remote template and DDE, a clean `.docx`, RTF and corrupted files;
    - `document.mjs`.

### 71. Fuzzy hash similarity (TLSH)
- **Problem:** variants of the same malware have a different SHA-256 and do not appear as
  related.
- **Proposal:** compute the **TLSH** of each file on submission and show in the Related
  tab the similar samples ("94% similar"), with an adjustable threshold.
- **Careful:** computation in pure JavaScript or WASM (no native binary); efficient
  comparison (pre-filter by size and type); old samples computed in the background.
- ✅ **Implemented** (migration `20261124000000_entry_tlsh`: `Entry.tlsh` column):
  - **Hash** (`lib/tlsh.ts`): its own implementation in TypeScript with typed arrays,
    without a new dependency. It generates the same digest as the reference (checked with tlsh-js on
    62 files and with the README vector); 16 MB in ~0.3 s.
    - A file with fewer than 512 bytes, without variety or above 32 MB ends with `''`
      ("not computable"); `null` = not computed yet.
    - TLSH distance (0 = equal) becomes **similarity** = 100 − distance (minimum 0).
  - **Submission:** the TLSH is computed along with the SHA-256.
  - **Old samples** (`lib/tlsh-backfill.ts`): computed in the background after the API
    starts, one file at a time, reading from MinIO. A purged or unreadable one becomes `''`
    so it is not repeated.
  - **Related:**
    - a new `SIMILAR` reason ("Similar file (TLSH): 85%"), weighing 0.9 × the %;
    - `?similarity=` from 50 to 99 (default 70, that is, a distance up to 30);
    - it compares with the 20 thousand most recent hashes. The distance is a 35-byte
      calculation, so the pre-filter by size and type was not needed;
    - the identical copy stays only as "Same file (SHA-256)".
  - **Screen:**
    - the Related tab with the **Similar files starting at** filter (50–90%, Clear
      returns to 70%); the empty list keeps the filter so the threshold can be lowered;
    - the card with the **TLSH** ("T1…", with Copy) in the File section, or "Not computable" /
      "Computing…".
  - **Tests:**
    - 10 checks on Postgres/MinIO: computation on submission, small file, similar
      variant (90%), random outside, identical copy without `SIMILAR`, higher threshold,
      old ones computed, purged/unreadable and not repeating;
    - `similar.mjs`.

### 72. Automatic assignment rules
- **Proposal:** rules "when a sample arrives with type/tag/priority X, assign it to
  analyst Y" or a **rotation** among the analysts of a group, skipping whoever is absent.
- **Decision (10/24/2026):** **groups + rules**, which **analysts and admins** configure.
  - Analyst groups (e.g. Phishing, Malware), each with its members.
  - Rules in order: "sample of type / with tag / of priority X → group". The first
    that matches applies; without a rule, the sample stays without an assignee (as today).
  - Inside the group, a **rotation** among the members, skipping whoever is **absent** (marked
    in My Account or by an admin) and whoever is inactive.
  - Everything in the sample history, with author "System" and the rule applied; the assignee
    receives the assignment notice as today.
- ✅ **Implemented** (migration `20261129000000_auto_assignment`: `AssignmentGroup`,
  `AssignmentGroupMember`, `AssignmentRule` and `User.away`):
  - **Rotation** (`lib/auto-assign.ts`), called when creating any sample (file,
    link, email attachment, ZIP content):
    - the first **enabled** rule that matches applies: type, tag and priority, with an empty field
      matching any value;
    - inside the group, it goes to the active member, analyst or admin, **not absent**, who
      received longest ago (whoever never received comes first);
    - a per-group lock in Postgres prevents simultaneous submissions from landing on the same
      person;
    - it never replaces an assignee already defined. Without a rule or without anyone available, the
      sample stays without an assignee. An assignment failure does not prevent the submission;
    - in the history: "Assignee: — → Ana (automatic: group Phishing (type link, tag
      phishing))", author System, and the notice "The system assigned the sample to you".
  - **API** (`routes/assignment.ts`, analysts and admins):
    - `GET /api/assignment` brings groups with members and availability, rules with the
      description and the analysts;
    - groups: create, rename, set members (active analysts and admins only; whoever
      leaves keeps their turn) and delete, which takes the group's rules with it;
    - rules: create at the end, enable/disable, move up/down and delete;
    - `PUT /api/assignment/away/:userId`: the person marks themselves, an admin marks
      any analyst. `auth/me` brings `away`.
  - **Screen** `/atribuicao` (Management folder):
    - **Rules** in order, with Move up/down, Enable/Disable and Delete; the disabled rule
      appears faded; add by group, type, tag and priority;
    - **Groups**, with the members (absent and inactive ones marked) and how many rules;
      Members…, Rename… and Delete (warns about the rules);
    - **Availability**: an "Absent" checkbox per analyst (the admin marks anyone).
  - **Tests:**
    - 28 checks on Postgres: without a rule, permissions, repeated name, valid members,
      order, rotation among three, history and notice, absent/inactive skipped, nobody
      available, order and disabled rule, does not replace the assignee, simultaneous submissions
      without repeating, reading and deleting the group;
    - `assignment.mjs`.

### 73. Deadline escalation
- **Problem:** an overdue sample only appears in the "Overdue" queue; nobody is warned.
- **Proposal:** on entering alert, warn the assignee in the Inbox; on going overdue, warn
  the admins too and, if enabled, raise the priority one level. Everything in the
  sample history.
- **Careful:** one notice per state change (without repeating every minute); without an
  assignee, it warns the analysts.
- ✅ **Implemented** (migration `20261125000000_sla_escalation`):
  - **Round** (`lib/sla-escalation.ts`): on startup and every 5 minutes, using the
    deadlines of each priority (`lib/sla.ts`). The overdue state is handled first: whoever skipped
    straight to overdue receives only the overdue notice.
  - **One notice per level and per status:** `Entry.slaStage` (alert/overdue) stores how far
    it has already warned. The same trigger that keeps `statusChangedAt` zeroes the field when the
    status changes; other changes do not zero it. The marking only applies if the sample did not change
    in the middle, so two rounds at the same time warn only once.
  - **Who receives it** (`SLA_WARN` / `SLA_LATE` notifications in the Inbox,
    "Deadline on alert: more than 24 h in the same status" / "Sample overdue: …"):
    - **alert:** the assignee; without an assignee, the active analysts;
    - **overdue:** the assignee (or the analysts) and the active admins.
  - **Priority:** with `SLA_ESCALATE_PRIORITY=true` (default `false`), on going overdue the
    priority rises one level (P4 → P3 → P2 → P1), with the event "Priority: P3 Medium →
    P2 High (escalation due to overdue)". The shorter deadline of the new priority does not generate
    a new notice.
  - **History:** "Deadline on alert: more than 24 h in the current status (P3 Medium)" /
    "Overdue: …", with author **System**.
  - **No flood:** a deadline crossed more than 24 h ago (the first run with a full queue,
    API down for days) is only marked, without a notice, without an event and without raising the priority.
  - **Tests:**
    - 25 checks on Postgres: who receives it, inactive and completed out, trash, not
      repeating, direct overdue, priority (and P1), old ones only marked, the trigger zeroing
      on a status change, simultaneous rounds;
    - `sla-escalation.mjs`.

### 74. Export the case
- **Proposal:** on the case, **Export (Markdown)** and **Print**: data, samples with
  hash and verdict, published reports, IOCs of all the samples (without repeats),
  ATT&CK techniques and the timeline; case IOCs also in CSV/STIX.
- **Careful:** the same look as the print card.
- ✅ **Implemented** (no migration):
  - **Case IOCs** (`entriesIocs` in `routes/iocs.ts`): those of the published reports and
    those of the samples themselves (SHA-256, URL, domain), without repeats, each with the
    samples where it appears. "Published report" beats "sample itself"; drafts and
    trashed samples stay out.
    - `GET /api/cases/:id/iocs`.
    - `GET /api/cases/:id/iocs/export?format=csv|stix|misp` (`lib/ioc-export.ts`):
      - **CSV:** a column with the samples;
      - **STIX 2.1:** the same indicator ids as the sample export, type by the worst
        verdict among the samples, plus a `grouping` with the case;
      - **MISP:** threat by the worst verdict and analysis by the case status.
  - **Case screen:**
    - a new **Indicators of the samples (N)** section, with a link to the indicator card
      (the URL stays as text only) and to the samples;
    - **Print** and the **Export** menu: "Full case (Markdown)" and "Case IOCs"
      in CSV, STIX 2.1 and MISP (disabled without indicators).
  - **Markdown** (`components/caseExport.ts`): data, samples with hash/URL, status,
    priority and verdict, published reports (summary, findings, IOCs, ATT&CK),
    indicators, ATT&CK techniques with the name and the samples, and the timeline with the
    comments.
  - **Printing** (`/casos/:id/imprimir`, `pages/CasePrintPage.tsx`): the same
    sections, in the printed card look (outside the shell, `?auto=1`, "Printed by /
    on", a notice in the footer).
  - The case detail started bringing the samples' SHA-256/URL and the findings/IOCs of the
    reports.
  - **Tests:**
    - 17 checks on Postgres: detail, IOCs without repeats (order, origin, two
      samples), draft and trash out, CSV, STIX (grouping, worst verdict, same
      sample id), MISP (threat, analysis), permissions and errors;
    - `case-export.mjs`.

### 75. Report versions
- **Problem:** a published report can be edited (without mandatory review) and no
  record of what changed is kept.
- **Proposal:** each edit keeps the previous version; the report shows "Versions (3)" and
  the difference between two versions (lines added and removed), with who and when.
- ✅ **Implemented** (migration `20261126000000_report_revisions`):
  - **API:**
    - `ReportRevision`: each `PATCH /api/reports/:id` that changes the content (summary,
      findings, IOCs, verdict or ATT&CK techniques) keeps the previous version, with the
      status at the time (draft/published). Changing only the status (Publish) or sending
      the same content does not generate a version. The cited knowledge base articles have no version.
    - `GET /api/reports/:id/versions` (analysts only, because old versions may have
      draft text) returns from the 1st to the current, with author and date: the 1st is the author's on
      creation, the following ones from whoever edited it, when they edited it.
    - The report list brings `_count.revisions`.
  - **Editing on screen:** the Reports tab had no editing (only the API edited). Now the
    author or an admin has **Edit**: summary, findings, IOCs, ATT&CK, articles and
    verdict, with Ctrl+S, Cancel and the unsaved change warning. It also serves to
    adjust a returned report. It stays out in review and, with mandatory review,
    in the published one (the API already refused).
  - **Versions (N):** choose two versions ("Version 2 (current) — Bruno Lima, date ·
    published") and it shows:
    - the line-by-line difference of Summary, Findings and IOCs (`components/textDiff.ts`,
      longest common subsequence), with a +/− count, green lines and red struck-through
      lines, and text for the screen reader;
    - the verdict "Unknown → Suspicious" and the ATT&CK techniques added and removed;
    - "same content" when there is no difference.
  - **A fix along the way (a `fix:` commit before this one):** with zod 4, the report PATCH
    set the verdict back to "Unknown" and unpublished when the field did not come
    (`.partial()` keeps the `.default()`s). The "Publish" button also wrote
    "Unknown" into the sample.
  - **Tests:**
    - 19 checks on Postgres: version kept with the old content and status,
      authors and dates, no version for the same content or only the status, admin edits,
      empty field, draft, permissions, in review, mandatory review and the counter;
    - 9 checks of the PATCH fix;
    - `report-versions.mjs`.

### 76. Evidence in the report
- **Proposal:** attach **images** to the report (screenshots of the fake page, of the sandbox
  VM, of the email), stored in MinIO, with thumbnails and an enlarged view; they enter
  the print card and the case export.
- **Careful:** images only (PNG, JPEG, WebP), a maximum size, EXIF metadata removed,
  real type verification (do not trust the extension).
- ✅ **Implemented** (migration `20261127000000_report_evidence`):
  - **Image** (`lib/evidence-image.ts`, no new dependency): it only reads and crops bytes,
    without decoding anything.
    - **Real type** by signature: PNG, JPEG or WebP. SVG, GIF, an executable with
      an image extension, a truncated or malformed file are refused.
    - **Metadata removed:**
      - PNG: `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`;
      - JPEG: APP1 (EXIF/XMP), APP3–APP13 (IPTC), APP15 and comments. JFIF,
        the ICC color profile and Adobe stay;
      - WebP: `EXIF` and `XMP `, with the bits cleared in VP8X;
      - in all of them, the bytes after the end of the image (hidden data).
    - Dimensions read from the header; a side above 12,000 px is refused.
    - **Checked in Chromium:** real images with EXIF/GPS, XMP, IPTC and garbage at the end
      decode the same (same pixels) before and after the cleanup.
  - **API** (`routes/evidence.ts`):
    - `POST /api/reports/:id/evidence` (multipart with `file` and `caption`): up to 10 MB
      per image and 20 per report. It writes to `evidence/<report>/<uuid>.<ext>` in the
      samples bucket and responds with how many metadata items left;
    - `PATCH /api/evidence/:id` changes the caption (up to 300 characters);
    - `DELETE /api/evidence/:id` deletes the image in MinIO before the row;
    - `GET /api/evidence/:id` serves the image with `nosniff`, `Content-Security-Policy:
      sandbox` and `inline`. A regular user only sees those of a published report; a sample in
      the trash does not show.
    - Whoever changes it is whoever edits the report (author or admin): out of review and, with
      mandatory review, not in the published one.
    - The report (list, case) brings the evidence in order. Deleting the sample for good
      in the trash also deletes the images.
  - **Screen:**
    - an **Evidence (N)** field in the report, with thumbnails (the whole image fits in the
      frame) and a caption (without a caption, "Evidence N");
    - an **enlarged view** with caption, dimensions, size, who uploaded it and when;
      arrows and buttons change the image, Esc closes it and the focus returns to the thumbnail, and there is
      "Open in a new tab";
    - for whoever edits: an optional caption and **Add images…** (several at once,
      with the reason for each refusal), "Caption…" and "Delete" with confirmation.
  - **Printing and export:**
    - the print card and the case printing show the images, two per row, without
      breaking between pages;
    - the case Markdown lists the evidence by caption (the images stay in
      DeepLook).
  - **Thumbnails:** they are the image itself reduced in the browser. Generating a thumbnail on the
    server would require decoding the image (a native library); it stays for later if the
    size becomes a problem.
  - **Tests:**
    - 28 checks on Postgres/MinIO: real type with a swapped name, metadata out,
      headers, PNG/WebP, refusals (SVG, executable, 10 MB, caption), permissions,
      caption, published/regular user, mandatory review, in review, limit of 20,
      delete in MinIO, case and trash;
    - 28 checks of the cleanup with real images;
    - `evidence.mjs`; `case-export.mjs` with evidence.

### 77. Management report
- **Proposal:** a **Reports** screen (admin and analysts) with the summary of a period:
  samples received and completed, average time to complete (by priority), verdicts,
  most seen techniques, cases opened and closed and workload per analyst; export to CSV
  and print.
- ✅ **Implemented** (no migration):
  - **API** (`routes/management.ts`): `GET /api/management?from=&to=&tz=` (analysts and
    admins). The dates are whole days in the browser time zone (invalid falls back to UTC), up to
    366 days. It brings:
    - received (files and links) and completed in the period: those that reached Completed,
      without duplicates, that had no analysis;
    - **time to complete** (from submission to completion): average and median, in total and by
      priority;
    - verdicts of the completed ones and ATT&CK techniques of the published reports written in
      the period;
    - cases opened, closed and open today;
    - **workload per analyst:** completed as assignee and average time, reports
      published and reviews done. Active ones always appear; inactive ones, only with
      activity.
    - `&format=csv`: Excel CSV with one row per indicator (section, item, quantity,
      times, reports, reviews).
  - **Screen** `/gerencial` (**Management** folder in the navigator):
    - period shortcuts (7, 30 and 90 days, current month, previous month, current year) and From/To
      dates, kept in the URL; default: the last 30 days;
    - indicators, a table by priority (above 48 h shows in days), verdict and technique
      bars and the table per analyst;
    - **Export CSV** and **Print** (`/gerencial/imprimir`, in the print card
      look, with the explanation of the calculations in the footer).
  - **Tests:**
    - 23 checks on Postgres: counts with a duplicate, trash and another month out,
      average and median by priority, total, techniques, cases, workload (inactive, admin
      zeroed, order), the day boundary in the São Paulo time zone, invalid time zone, CSV and
      validations;
    - `management.mjs`.

### 78. Import indicators
- **Proposal:** import a list of indicators (CSV or STIX 2.1 package) to **follow**
  (IOC alerts) or to the **allowlist**, with a preview of what was
  recognized before confirming.
- **Careful:** a line limit; invalid indicators listed separately; nothing is fetched
  on the internet.
- ✅ **Implemented** (migration `20261128000000_audit_allowlist_import`: audit action
  `ALLOWLIST_IMPORTED`):
  - **Reading** (`lib/ioc-import.ts`, text only, nothing is fetched on the internet):
    - **CSV/list:** one indicator per line, with or without a type column ("ip;1.2.3.4",
      "domain,x.test"). Separator `;`, `,` or tab; header and Excel BOM accepted;
      hxxp and [.] disarmed; a URL becomes the host;
    - **STIX 2.1:** `indicator` with a pattern (`ipv4-addr`, `domain-name`, `email-addr`,
      `url` and `file` hashes, with OR/AND) and loose observables (`ipv4-addr`,
      `domain-name`, `email-addr`, `url`, `file`). A pattern without a supported indicator or in
      another language goes to the invalid ones;
    - limits: 5000 lines or objects and 2 MB; repeats count once.
    - **Validation per destination:** following only accepts what can appear in the reports (no
      CIDR range and no private IP); the allowlist accepts ranges.
  - **API** (`routes/ioc-import.ts`):
    - `POST /api/iocs/import/preview { target, text }` → recognized ones with the situation
      ("new", "already followed/allowed", "already covered" by domain or range, "no slot"
      above the limit of 200 followed), invalid ones with the reason, repeats and slots;
    - `POST /api/iocs/import { target, items, reason? }` revalidates everything on the server and
      writes only the new ones. Following is per user (anyone); allowed ones are only for
      analysts, with a mandatory reason and a line in the audit with the quantity.
  - **Screen:** an **Import indicators** dialog, opened from My Account > Indicators
    ("import a list") and from the **Import…** button of the Allowed indicators:
    - paste or **Choose file…** (.csv, .txt, .json);
    - **Preview**: summary, table of the recognized ones (those that do not enter appear
      faded) and "Not imported" with the reason;
    - reason (allowed ones) and **Import N**. Esc closes it.
  - **Tests:**
    - 24 checks on Postgres: CSV (type in the column, URL, range, private IP, text,
      repeat), situation, revalidation, limit of 200, allowed (already, covered, range,
      reason, author, audit, list reloaded), STIX and errors;
    - `ioc-import.mjs`.

### 79. Email notifications — deferred
- **Proposal:** send by email (SMTP) what today only goes to the Inbox
  (mentions, assignments, returned report, IOC alert), with an option per person;
  also "Forgot my password" by email.
- **Decision (10/24/2026):** **deferred** — there is no SMTP server for now. The notices
  stay only in the Inbox; the password keeps being reset by the admin.

### 80. Link page capture
- **Proposal:** for link-type samples, open the page in an **isolated browser**
  (its own container, without access to the internal network) and store the screenshot, HTML,
  redirects and certificate, as evidence and so the analyst does not have to open the
  link.
- **Decision (10/24/2026):** the server may access the links; capture **on demand**
  ("Capture page" on the link card), in an isolated browser in its own container, without
  access to the internal network (internet only), with time and size limits.
- ✅ **Implemented** (migration `20261130000000_page_capture`: `PageCapture` and the
  `PAGE_CAPTURED` event):
  - **`capture` service** (`apps/capture`): Chromium from the Playwright 1.49.0 image with a
    minimal HTTP server (`POST /capture` with a token, `GET /health`).
    - **Outbound proxy** (`src/proxy.mjs`): all browser traffic goes through it, which
      resolves the name once and refuses private, loopback, link-local,
      CGNAT, reserved and cloud metadata addresses (169.254.169.254), including IPv6 and
      mapped IPv4. The connection goes to the checked IP, without a new DNS resolution
      (no DNS rebinding); what was refused comes back in the response.
    - **Browser:** WebRTC/QUIC and DNS prefetch off, only `http(s)` (file:, ftp:…
      refused), no downloads and no service workers; a new context for each capture;
      an invalid certificate is accepted and recorded.
    - **Limits:** 20 s to open, a screenshot 1280 px wide and up to 6,000 px high,
      HTML up to 2 MB, one capture at a time; Chromium errors translated ("the page
      did not respond in 20 s", "domain not found").
    - **docker-compose:** a container only on the `capture` network (without database, MinIO or ClamAV),
      `no-new-privileges`, an unprivileged user, `shm_size` 512 MB and 1 GB of
      memory.
  - **API** (`lib/page-capture.ts`, `routes/captures.ts`):
    - `POST /api/entries/:id/capture` (analysts, links only, one in progress per
      sample) runs in the background;
    - the screenshot and HTML go to MinIO (`captures/<sample>/<id>.png | .html.txt`);
      redirects, certificate and blocked ones stay in the database; the history records
      "Page captured";
    - `GET /api/entries/:id/captures` (everyone who sees the sample);
    - `GET /api/captures/:id/screenshot` serves it with `nosniff` and CSP `sandbox`;
      `GET /api/captures/:id/html` **only as a text attachment**;
    - captures in progress when the API restarts become a failure; a service down or a
      wrong token becomes a failure with the reason; deleting for good in the trash erases the
      files;
    - `CAPTURE_URL`/`CAPTURE_TOKEN` (empty = off); the **System status** gained
      the "Page capture" line.
  - **Screen** (link card, Details tab): **Capture page** / "Capture again",
    with monitoring while it runs. It shows:
    - the screenshot (click opens it whole);
    - title, **final address as text** (with Copy, never a link) and the HTTP response;
    - the redirect chain and the certificate (issuer, validity, "expired");
    - what was blocked, **Download HTML (text)** and the previous captures.
  - **Tests:**
    - 21 end-to-end checks with the real service in a container and a test site:
      redirects 302→301→200, title, PNG screenshot, HTML as an attachment, internal IP,
      169.254.169.254 and loopback blocked, internal target refused, HTML cut at
      2 MB, file without a page, wrong token, service down, off,
      restart;
    - `capture.mjs`.

---

## Seventh batch — ideas 81 to 94

Analyze what slips through today (password-protected ZIP, scripts, shortcuts and disk
images), automate the triage (tags and priority by rule), talk to whoever submitted it (resolution and
general notices), protect the operation (backup, AD login) and see the campaigns
(relationship map, domains that look like the company's), always in the HP
Service Manager 9 visual pattern.

| # | Idea | HPSM 9 pattern | Priority | Effort | Status |
|---|---|---|---|---|---|
| 81 | Backup in a ZIP to download | system administration | 🔴 | M | ⬜ |
| 82 | Password-protected ZIP ("infected") | calculated record fields | 🔴 | M | ↩ already exists (item 44) |
| 83 | Script analysis (PowerShell, JS, VBS, BAT, HTA) | calculated record fields | 🔴 | M | ✅ |
| 84 | Shortcuts (.lnk) and disk images (.iso, .img, .vhd) | calculated record fields | 🟡 | M | ✅ |
| 85 | Decoder (Base64, hex, XOR, PowerShell, gzip) | record tools | 🟡 | P–M | ✅ |
| 86 | Automatic tags and priority by rule | business rules | 🟡 | M | ✅ |
| 87 | Resolution for the submitter | Solution / Resolution | 🟡 | P–M | ⬜ |
| 88 | System messages (general notice) | Broadcast messages | 🟡 | P | ⬜ |
| 89 | Mentions and notices in cases | Activities / Notifications | 🟡 | P | ⬜ |
| 91 | Relationship map (samples, indicators, cases) | related records | ⚪ | M–G | ⬜ |
| 92 | Domains that look like the company's | watchlists | ⚪ | M | ⬜ |
| 93 | API documentation (OpenAPI) | Web Services | ⚪ | M | ⬜ |
| 94 | Login with AD/LDAP (optional) | external authentication | ⚪ | M–G | ⬜ |

**Order (one step per item, with tests, documentation and its own commit):**
83 → 85 → 84 → 86 → 87 → 88 → 89 → 91 → 92 → 93 → 81 → 94 (82 already existed).

**Decisions (10/29/2026):** 81 becomes a ZIP generated on screen and downloaded; 90 (business hours and
holidays in the deadline) left the project; 94 only with AD/LDAP and optional.

### 82. Password-protected ZIP ("infected")
- **Problem:** malware samples circulate in a password-protected ZIP (almost always `infected`).
  Today a password-protected ZIP enters as a single file, without the files inside.
- **Proposal:** a **ZIP password** field on submission, already filled with `infected`. The ZIP is
  opened with the password (ZipCrypto and AES) and each file becomes a child sample, as in a
  common ZIP. Wrong password: a clear notice and the ZIP stays as a single sample.
- **Careful:** the same limits as a common ZIP (zip bomb, quantity, size); the password
  is not stored; nothing is executed.
- ↩ **Already exists:** the batch submission of [item 44](#44-batch-submission) already splits a `.zip`
  with a password (default `infected`, ZipCrypto and AES) into samples. Nothing to do.

### 83. Script analysis (PowerShell, JS, VBS, BAT, HTA)
- **Problem:** malicious scripts arrive obfuscated (`-EncodedCommand`, `FromBase64String`,
  `eval`, concatenations) and the analyst deobfuscates by hand.
- **Proposal:** in the static analysis, recognize scripts and show the **Script** section:
  - suspicious commands and functions (`IEX`, `DownloadString`, `Invoke-WebRequest`,
    `WScript.Shell`, `eval`, `ActiveXObject`, `certutil`, `bitsadmin`);
  - **decoded layers**: `-EncodedCommand` (UTF-16LE), Base64 and gzip/deflate in
    PowerShell, `String.fromCharCode` and `unescape` in JS;
  - URLs and domains found in the layers, in the suggested IOCs.
- **Careful:** reading and decoding only; nothing is executed; a limit of layers and of
  size; text always shown as text.
- ✅ **Implemented** (no migration: the result goes in `staticInfo.script`):
  - **Analysis** (`lib/script-analysis.ts`, no new dependency):
    - **Language** by the extension (`.ps1`, `.js`/`.jse`/`.wsf`, `.vbs`/`.vbe`,
      `.bat`/`.cmd`, `.hta`) or, without one, by the content (`@echo off`,
      `<hta:application`, `CreateObject`, `$var =`). It accepts UTF-8 and UTF-16 with BOM;
      binary and plain text stay out.
    - **Findings** (27 rules), each with the reason and the type:
      - download: DownloadString, Invoke-WebRequest, Net.WebClient, BITS,
        certutil, XMLHTTP, ADODB.Stream;
      - execute: IEX, Start-Process, WScript.Shell, .Run, eval, ActiveX,
        CreateObject, mshta/rundll32/regsvr32/wmic;
      - evasion: hidden window, ExecutionPolicy Bypass, Defender exclusion, AMSI
        bypass, delete shadow copies, `attrib +h`;
      - persistence: Run, scheduled task;
      - obfuscation: -EncodedCommand, FromBase64String, fromCharCode, unescape/atob,
        a series of Chr().
    - **Decoded layers**, in a chain, up to 5 levels and 12 layers: `-EncodedCommand`
      (UTF-16LE), `FromBase64String` (with GZip/Deflate/zlib), `atob`,
      `String.fromCharCode`, `unescape`/`decodeURIComponent`, `Chr() & Chr()` and long
      Base64 blocks. Repeats are recognized by the hash of the whole text.
    - URLs from the file and from the layers enter the suggested IOCs. A Script Encoder
      file (`#@~^`) is marked, but not decoded.
    - **Risk:** high when it downloads and executes, attempts evasion, or when a hidden
      layer downloads or executes; medium with only one of those or only obfuscation;
      low in the rest.
  - **Card:**
    - a warning at the top with high risk ("script … with malicious behavior (…). Do not
      run it outside the isolated environment");
    - a **Script** section with language, risk, lines, findings (the reason and where: in the
      file or in layer N), URLs as text only (with Copy) and the layers with
      method, origin and size. **View text** shows the plain text: HTML inside the
      script does not become HTML.
  - **Tests:**
    - 25 checks with scripts built in the test: BAT with `-enc`, PowerShell with
      Base64 + GZip in two layers, JScript, VBScript without an extension, HTA with
      `eval(atob)`, UTF-16 with BOM, benign, plain text, binary, Script Encoder,
      depth limit and the submission through the API recording the analysis;
    - `script.mjs`.

### 84. Shortcuts (.lnk) and disk images (.iso, .img, .vhd)
- **Problem:** `.lnk` shortcuts and `.iso`/`.img` images are common vectors (they bypass the Mark
  of the Web) and today they only appear as "binary".
- **Proposal:**
  - **LNK:** target, arguments (with the hidden command), working directory, icon,
    machine and MAC of origin, dates;
  - **ISO/IMG (ISO 9660 and UDF) and VHD:** a file list with size and, optionally,
    "Extract as child samples" (like the ZIP).
- **Careful:** direct reading of the bytes, with limits; hidden files marked.
- ✅ **Implemented** (migration `20261201000000_files_extracted`: `FILES_EXTRACTED` event):
  - **Shortcut** (`lib/lnk-analysis.ts`, MS-SHLLINK format):
    - target (through LinkInfo or the Shell item list, with the long name of the
      BEEF0004 extension), arguments, directory, description, icon and how the window opens;
    - target environment variable, NetBIOS machine and MAC of origin (TrackerDataBlock)
      and the dates;
    - **alerts:** interpreter or system binary (PowerShell, cmd, mshta,
      rundll32…), long arguments or ones hidden behind spaces, a URL in the arguments,
      a minimized window, an icon of another file type. The URL in the arguments enters the
      suggested IOCs.
  - **Disk image** (`lib/disk-image.ts`):
    - **ISO 9660** with the long **Joliet** names (it covers `.iso` and `.img`, which is usually
      an ISO with another name);
    - **FAT12/16/32**, with long names (VFAT), folders and the hidden attribute, in a raw
      image or in a **fixed VHD** with an MBR;
    - VHDX, dynamic VHD, NTFS and pure UDF are recognized and marked as "not listed";
    - up to 500 files (cuts indicated), 16 folder levels;
    - alerts for executables or scripts inside the image, hidden files and a "visible .lnk with
      hidden files".
  - **Extract as samples** (`POST /api/entries/:id/extract-image`, analysts):
    - up to 50 files at a time; each one becomes a **child** sample of the same owner, with the
      image's tags and analyzed like a submission (antivirus, YARA, static analysis);
    - once per image (409 on the second); a purged file = 410; the history
      records how many came out;
    - `GET /api/entries/:id/children` lists the children (email ones too).
  - **Card:**
    - a warning at the top for a dangerous shortcut;
    - a **Windows shortcut (.lnk)** section (arguments as text only, Copy of the full
      command);
    - a **Disk image** section with format, label, alerts and the file table
      (hidden ones marked; after extracting, each row leads to the sample with status and
      verdict);
    - the child shows **"Extracted from:"** (and keeps "Attachment of:" when the parent is an
      email).
  - **Tests:**
    - 32 checks with files generated by real tools (`xorriso`, `mkfs.fat`,
      `mtools`, `sfdisk`, `pylnk3`): ISO with Joliet and accents, FAT16 with a long name,
      a folder and a hidden file, FAT32, a fixed VHD with an MBR, VHDX, LNK with target, arguments,
      window and alerts, truncated files, static analysis, submission, extraction (owner,
      tags, title with the path), children, 409, history, not an image, purged;
    - `disk.mjs`.

### 85. Decoder (Base64, hex, XOR, PowerShell, gzip)
- **Problem:** to decode an excerpt, the analyst copies it to another tool outside
  DeepLook.
- **Proposal:** a **Decode** tool (More menu and Ctrl+Shift+D): paste the text and
  chain steps (Base64, hex, URL, PowerShell `-EncodedCommand`, XOR with a key,
  gzip/deflate, ROT13), with the result as text and in hex. "Decode" also appears
  in the selection of the static analysis strings.
- **Careful:** everything in the browser; the result never becomes HTML or a link; limited size.
- ✅ **Implemented** (front end only, no new API):
  - **Steps** (`components/decoder.ts`), over bytes and chained in any order:
    - Base64 (including URL-safe and without `=`), hex (with spaces, `0x`, `\x`), URL
      (`%xx` and `%uXXXX`), PowerShell `-EncodedCommand` (Base64 + UTF-16LE), UTF-16LE;
    - XOR with the key as text or bytes (`0x20` or `0x41 0x42`), decompress
      (gzip, zlib or deflate, through the browser's `DecompressionStream`), ROT13,
      reverse and character codes (`72,101,…` or `0x48`).
    - A step that fails is marked in red, with the reason ("not hex",
      "Base64 with invalid length"), and the following ones wait. Input up to 1 MB.
    - a **suggestion** of the next step from the shape of the result: Base64, hex, `%xx`,
      numbers, UTF-16 (alternating zeros) or gzip (`1f 8b`).
  - **Decode box** (`components/DecoderDialog.tsx`):
    - text, the list of steps (change, remove, XOR with the key) and "+ Add step…";
    - the result in **Text** or **Hex** (offset, bytes and characters; the
      first 4 KB), a byte count and **Copy** (it takes the whole result,
      even when the screen cuts at 200 thousand characters);
    - the result is always text: HTML or script inside it does not become a page.
  - **Where it opens:**
    - **Ctrl+Shift+D** on any screen, already with the selected text (e.g. an excerpt
      of the strings);
    - **More ▾ > Decode text…** on the card (analysts);
    - **Decode…** on each layer of the Script section (item 83).
    - Esc closes it and the focus returns to where it was. The shortcut entered the list (`?`/F1) and
      the Tips.
  - **Tests:** `decoder.mjs`; `more-print.mjs` with the new menu item.

### 86. Automatic tags and priority by rule
- **Problem:** triage repeats the same markings ("macro → tag macro, P2").
- **Proposal:** rules "when the analysis finds X, apply Y":
  - conditions: real type, YARA that matched, antivirus detection, link domain or TLD,
    email sender, document with a macro, disguised extension;
  - actions: add tags and set the priority. It runs after the analyses, before the
    automatic assignment (item 72), which already uses tag and priority;
  - everything in the history ("tag macro by the rule Document with macro").
- **Careful:** it never removes a tag nor lowers a priority set by a person; maintained by
  analysts, like the assignment rules.
- ✅ **Implemented** (migration `20261202000000_triage_rules`: `TriageRule` and the
  `TRIAGE_RULE` event):
  - **Rules** (`lib/triage-rules.ts`), with name, condition, value, tags and priority.
    **All** the enabled rules that match apply (not only the first). Conditions:
    - real type (`pe`, `ole`, `pdf`…);
    - YARA rule that matched (name or any) and antivirus that detected (signature or
      any);
    - link domain (equal, subdomain or `.top`) and email sender (address or
      domain);
    - document with a macro, disguised executable, script or document with high risk,
      suspicious shortcut.
  - **Actions:** add tags (normalized, without repeats) and **raise** the priority. It never
    removes a tag nor lowers it: P1 stays P1.
  - **When it runs:**
    - on arrival, right after the analyses and **before the automatic assignment**
      (item 72), which already sees the new tags and priority;
    - again when **YARA** matches or the **antivirus** detects, because those
      scans finish in the background.
    - Applying again repeats nothing.
  - **History:** "Triage rule "Document with macro": tags macro; priority P2"
    and "Priority: P3 Medium → P2 High (triage rule)", with author System.
  - **API** (`routes/triage-rules.ts`, analysts): list (with the description of the
    condition), create (a mandatory value for real type, domain and sender; at least
    one tag or the priority), enable/disable and delete (the tags already applied stay).
  - **Screen** `/regras-triagem` (Detection folder): a list with condition, tags, priority and
    situation (disabled faded). The new rule only shows the Value field when the
    condition asks for it, with the format hint.
  - **Tests:**
    - 20 checks on Postgres: validations, arrival with tags and priority, automatic
      assignment by the rule's tag, history, not repeating, each condition, a disabled
      rule, never lowering, real YARA at the end of the scan, antivirus, deletion;
    - `triage-rules.mjs`.

### 87. Resolution for the submitter
- **Problem:** whoever submitted it sees the verdict, but does not know what to do ("can I open it?",
  "I already clicked, what now?").
- **Proposal:** a **Resolution for the requester** field on completion, with templates ("It is
  a scam: do not click, delete the email", "Safe: you can open it", "Clicked? Change your password and
  tell support"). It appears highlighted on the card, in My Uploads and in the completion
  notice.
- **Careful:** short text and no technical details; the full report stays only
  for the analysts.
- ✅ **Implemented** (migration `20261204000000_entry_resolution`: `Entry.resolution`, the
  `RESOLUTION_SET` event and the `RESOLUTION` notification):
  - **The "Resolution for the submitter" field** in the Analysis tab, below the triage (analysts):
    - up to 500 characters, with a counter;
    - templates that **add up** to the text ("It is a scam…", "Clicked the link…", "Opened the
      attachment…", "Still suspicious…", "Safe: you can open it.", "Legitimate, but unnecessary…");
    - it saves on the "Save resolution" button and warns of unsaved changes; empty removes it.
  - **Where it appears**, always as plain text:
    - a "What to do" highlight at the top of the card, for everyone, in the verdict color;
    - below the title in My Uploads;
    - in the completed notice (inbox and bell), with the current resolution.
  - **Notices:** writing or changing it on a sample **already completed** warns whoever submitted it
    ("wrote what to do with your sample"). While open it does not warn, because the completed
    notice already carries the resolution.
  - **Duplicates:** they inherit the resolution of the main one (and whoever submitted them is warned). When
    marking as a duplicate, the sample receives the main one's; if the main one has none,
    it keeps its own.
  - **History:** "Resolution for the submitter: "…"", "… removed" and "(from the main one)".
  - **Tests:**
    - 20 checks on Postgres: permission, limit, trimming, the completed notice with the
      resolution, duplicates, repeating without effect, changing on a completed one, the card and My
      Uploads, open without a notice, removing, marking as a duplicate;
    - `resolution.mjs`.

### 88. System messages (general notice)
- **Proposal:** analysts publish a notice for everyone ("Phishing campaign for the 'overdue
  invoice' in progress"), with a level (information, alert), validity and, optionally,
  linked to a case. It appears in a strip at the top and on the Home Page until it expires or the person
  dismisses it.
- **Careful:** at most three active notices; plain text.
- ✅ **Implemented** (migration `20261203000000_broadcasts`: `Broadcast` and
  `BroadcastDismissal`):
  - **Strip** at the top of the work area, on all screens (including the Home
    Page), for all profiles:
    - alerts first, in orange; information in blue;
    - plain text, the linked case as a link ("(CASO-0001)"), who published it and until when;
    - "×" dismisses it **for that person only**; it refreshes every 2 minutes and when returning to the window.
  - **Management** `/avisos` (Management folder, analysts):
    - publish with text (5 to 300 characters), level, validity (4 hours to 30 days) and an
      optional case;
    - with 3 active notices the form warns of the limit instead of appearing;
    - a list of the last 30 days with level, author, validity and how many people dismissed it;
    - "End" (with confirmation) brings the validity forward to now: it leaves the strip of
      everyone and stays in the list, faded.
  - **API** (`routes/broadcasts.ts`): active and not dismissed for everyone; dismiss;
    list, publish (409 with 3 active, 400 if the case does not exist) and end for
    analysts.
  - **Tests:**
    - 19 checks on Postgres: permissions, validations, case, order, dismissal per
      person, limit of 3, end, list with dismissals, an expired one disappears by itself;
    - `broadcasts.mjs`.

### 89. Mentions and notices in cases
- **Proposal:** "@" in the case comments, like in the sample updates; the
  case assignee is warned when someone comments, adds or removes samples; the
  notices open the case.
- **Careful:** it does not warn the person themselves; it reuses the Inbox.
- ✅ **Implemented** (migration `20261205000000_case_notifications`: the notification becomes
  about a sample **or** a case, with a database constraint, and gains 5 types):
  - **Mentions:** "@" in the case comment, with the same autocomplete as the
    updates, but **analysts only** (whoever can open the case):
    - only the ids of whoever still has "@Name" in the text go;
    - the mention is highlighted in the timeline.
  - **Notices** to the case assignee:
    - a comment (with the excerpt);
    - samples added ("added 2 sample(s) to your case") and removed (with the title);
    - and, beyond the proposal, the case assigned to them.
  - **Rules:** the mentioned person receives "mentioned you"; the mentioned assignee receives
    only the mention. It never warns whoever did the action, and adding again what was already there does not
    warn.
  - **Inbox and bell:** the column becomes "Sample or case" ("CASO-0001 ·
    title"), and the case notices open the case. The sample trash keeps
    hiding only their notices.
  - **Tests:**
    - 23 checks on Postgres: comment, own assignee, mentions (analysts only,
      only whoever is in the text, the assignee receives only the mention), add/remove,
      assignment, without an assignee, read, sample notices unchanged, trash, the database
      constraint, autocomplete;
    - `case-notifications.mjs`.

### 91. Relationship map (samples, indicators, cases)
- **Problem:** the links of a campaign are spread across Related,
  indicators and cases.
- **Proposal:** a **Map** tab on the sample card and on the case: a drawing with the sample at the
  center, the indicators, the linked samples (same file, similar, shared IOC) and
  the cases, with color by verdict. Clicking opens the card; "Expand" fetches the next level.
- **Careful:** a node limit (with "+N"); it works with the keyboard (an equivalent list
  beside it); it respects the allowlist.
- ✅ **Implemented** (no migration):
  - **API** (`routes/graph.ts`): sample, indicator and case nodes, plus the links with
    labels. The Related tab search became `findRelated` (`routes/related.ts`) and is
    the same in both.
    - **Sample:** indicators of the published reports; samples with the same file,
      similar, of the same domain or with a shared indicator (that link goes through the
      indicator when it is on the map); a tag alone does not enter.
    - **Cases:** analysts only; a regular user sees the map without them.
    - **Case:** its samples and the indicators, the ones that link more than one first.
    - Indicators from the allowlist stay out; trashed samples too.
    - **Limits:** sample 12/12/8 and case 20/15; what is left comes in `hidden` and appears
      as "+N".
  - **Drawing** in its own SVG, without a new library:
    - a **Map** tab on the card (everyone) and a "Relationship map" section on the case;
    - samples in a circle in the verdict color, indicators in a diamond, cases in a
      rectangle; link labels ("same file", "similar 82%");
    - a legend with "Not shown: +N";
    - clicking opens the card, the case or the indicator.
  - **Equivalent list beside it** (keyboard and screen readers): by group, with links, the
    reason for the link and **Expand**. It brings that sample's links into
    the same drawing without changing what was already there and shows its "+N".
  - **Tests:**
    - 19 checks on Postgres (center, indicators, allowed out, same file,
      link through the indicator, tag alone out, cases for analysts only, limit with
      "+N", case map with the shared ones first, 403/404, trash);
    - 9 regression tests of the Related tab;
    - `relation-map.mjs`.

### 92. Domains that look like the company's
- **Problem:** scams use domains that look like the company's
  (`empresa-seguranca.com`, `ernpresa.com`).
- **Proposal:** the admin registers the company domains. DeepLook generates the common
  variations (letter swapped, missing or repeated, homoglyphs, another TLD, hyphen, words like
  "login" and "security") and:
  - marks links, senders and IOCs that match ("looks like empresa.com.br");
  - shows the list of variations seen, with the samples.
- **Careful:** nothing is queried on the internet; the company's own domains enter the
  allowlist.
- ✅ **Implemented** (migration `20261206000000_company_domains`: `CompanyDomain` and
  `LookalikeHit`):
  - **Detection** (`lib/lookalike.ts`). Instead of **generating** the list of variations (thousands,
    with the homoglyphs), each domain seen is **compared** with the company ones by the
    same rules:
    - another TLD (`empresa.com`);
    - similar letters: `rn`/`m`, `vv`/`w`, `0`/`o`, `1`/`l`, accents and Cyrillic/Greek,
      also in IDN `xn--`;
    - typo: letter swapped, missing, repeated, one extra, transposed or an extra
      hyphen;
    - name with an extra word (`empresa-seguranca`, `loginempresa`);
    - name in the subdomain (`empresa.com.br.verifica.top`).
    - The domain itself and its subdomains do not count. Nothing is queried on the internet.
  - **Where it looks:** the submitted link, the senders (From, Sender, Reply-To,
    Return-Path) and the email links, the suggested indicators and those of the published
    reports.
  - **When:** on the sample arrival, on re-analysis, when publishing or changing a report and,
    when the list changes, on all the samples (in the background, in batches).
  - **Card:** a warning at the top "Domain that looks like the company's — probable scam", with the
    domain, the reason and where it appeared, for all profiles.
  - **Screen** `/dominios-empresa` (Detection folder):
    - the admin adds (it accepts a URL and `www.`, at most 20) and removes;
    - the domain enters the allowlist (item 69) and, on removal, only the item that
      the registration added leaves;
    - analysts see the **variations seen**, one row per domain, with the reason, where
      it appeared and the samples (5 with the verdict and "+N").
  - **Tests:**
    - 35 checks on Postgres: each rule, the domain itself, short names, registration,
      allowlist, rescan, each origin, card, published and unpublished report, variations
      seen, permissions, deletion;
    - `lookalike.mjs`.

### 93. API documentation (OpenAPI)
- **Problem:** the API tokens exist, but whoever integrates has to guess the routes.
- **Proposal:** an OpenAPI 3 specification generated from the route validations, served at
  `/api/openapi.json`, and the **API documentation** page (My Account > API Tokens),
  with curl examples to submit a sample, query the result and download the IOCs.
- **Careful:** only the routes that accept a token; no "try it out" that calls the real API
  from the page.
- ✅ **Implemented** (no migration and no new dependency):
  - **Specification** OpenAPI 3.1 (`lib/openapi.ts`, `GET /api/openapi.json`, with session
    or token):
    - parameters and bodies generated from the zod schemas of the routes themselves (`z.toJSONSchema`
      from zod 4): list filters, link and export format;
    - multipart upload, responses, errors and the bearer scheme described by hand.
    - Only the routes that accept a token (now exported in `ALLOWED_ROUTES`); the test
      fails if the two lists diverge.
  - **API documentation page** (`/user/api`, link in My Account > API Tokens):
    - a step by step;
    - curl examples with the DeepLook address and Copy: submit a file, submit a link,
      query the result, download the IOCs;
    - the routes read from the specification, with method, path, fields (path, query,
      JSON, form; type, values, default, required) and responses;
    - "Download the specification". Nothing on the page calls the API on the person's behalf.
  - README with the link.
  - **Tests:**
    - 12 checks: access (401 without login, token, session), routes equal to
      `ALLOWED_ROUTES`, schemas from zod, multipart, `$ref` resolved, path
      parameters declared;
    - `api-docs.mjs`.

### 81. Backup in a ZIP to download
- **Problem:** the database and MinIO live on local volumes; there is no backup routine nor a restore
  test.
- **Decision (10/29/2026):** **generate a ZIP and make it available for download**.
- **Proposal:** in Administration, a **Backup** tab (admin only):
  - **Generate backup** builds, in the background, a ZIP with the database dump (`pg_dump`,
    custom format) and the files stored in MinIO (evidence, captures and,
    optionally, the sample files), plus a manifest with version, date,
    counts and the SHA-256 of each part;
  - it follows the progress and shows **Download** when it is ready; the last backups
    stay listed (old ones expire) and everything goes to the audit;
  - README with the restore step by step (`pg_restore` and copy to the bucket).
- **Careful:** one backup at a time; the ZIP stays in MinIO, downloads only with an admin logged in and
  expires; with the sample files, the ZIP has malware: a clear warning, and the manifest
  says what went in.
- ✅ **Implemented** (migration `20261207000000_backups`: `Backup` and the audit actions
  `BACKUP_CREATED`/`BACKUP_DOWNLOADED`/`BACKUP_DELETED`):
  - **Generation** (`lib/backup.ts`), in the background and one at a time (409):
    - `pg_dump --format=custom` into a temporary file;
    - the bucket objects with the same path, without `backups/` and, without the option, without
      `samples/`;
    - `LEIA-ME-RESTAURACAO.txt` and `manifest.json`: version, date, who generated it, whether it has
      malware, counts and the SHA-256 of each file;
    - the ZIP goes to `backups/<id>.zip` in the bucket, uploaded in parts.
    - The stage and progress stay in the row; a failure becomes "Failed" with the reason (e.g.
      the pg_dump output).
  - **ZIP** (`lib/zip-writer.ts`), its own writer without a new dependency:
    - without compression (the dump already comes compressed);
    - CRC-32 computed while the data passes;
    - ZIP64 when it goes past 4 GB;
    - it refuses a repeated name, `../` and a size different from the expected one.
    - Checked with `unzip -t`, Python's `zipfile` and 7-Zip, including in a forced ZIP64.
  - **Validity:** `BACKUP_RETENTION_DAYS` (default 7). Every hour and when listing, the
    expired ones leave the bucket and stay as "Expired". On API startup, what was in
    progress becomes "Failed (the API restarted)".
  - **API** (`routes/backups.ts`, admin with session; a token does not work): list, generate,
    download (with a file name and audited) and delete.
  - **Screen:** the Administration **Backup** tab (and a leaf in the navigator):
    - the "Include the sample files" option, with a "real malware" confirmation;
    - a progress bar with the stage, refreshed every 2 s;
    - a list with situation, content, size, validity, Download and Delete.
  - **API image:** `postgresql-client-16` from the official PostgreSQL repository
    (PGDG). Debian brings an older pg_dump, which does not export Postgres 16;
    `BACKUP_PG_DUMP` changes the command.
  - README with "Backup and restore", and `.env.example`/compose with the variables.
  - **Tests:**
    - 22 checks with real Postgres and MinIO: permissions, one at a time, manifest, ZIP
      checked by Python (SHA-256 of each part), without samples and without backups,
      a **real restore** with `pg_restore` into a new database (the counts match),
      with samples (malware), a pg_dump failure with the reason, expired (leaves the bucket,
      does not download), delete, audit, interrupted on startup;
    - `backup.mjs`.

### 94. Login with AD/LDAP (optional)
- **Decision (10/29/2026):** for now only **AD/LDAP**, **not mandatory**. Without AD
  configured, everything stays as today (activation key and normal sign-up); with AD
  configured, the key and the normal sign-up also keep working.
- **Proposal:**
  - variables `LDAP_URL`, `LDAP_BIND_DN`/`LDAP_BIND_PASSWORD`, base and search filter;
  - at login, whoever does not have a local account signs in with the AD user/password: the account is created
    on the first access (name and email from AD), with the role from the groups
    (`LDAP_ANALYST_GROUP`, `LDAP_ADMIN_GROUP`; without a group, regular user);
  - AD accounts have no local password (password change and policy stay in AD), but DeepLook's
    2FA keeps working;
  - the System status gains the "AD/LDAP" line.
- **Careful:** LDAPS/StartTLS with certificate verification; without enumerating users
  ("invalid user or password" the same for everything); the same attempt limit as login;
  an account suspended in DeepLook does not sign in even with the right AD password.
- ✅ **Implemented** (migration `20261208000000_ldap_accounts`: `User.authSource`
  LOCAL/LDAP and `ldapDn`; new dependency `ldapts` 9.2.0, exact version):
  - **Configuration** (`lib/ldap.ts`): `LDAP_URL`, `LDAP_STARTTLS`, `LDAP_TLS_CA`, service
    account, base, filter (`{login}`; AD default with sAMAccountName, userPrincipalName
    or mail), name and email attributes, and the analyst and admin groups (by
    `memberOf`).
  - **TLS only:** `ldaps://` or StartTLS, with the certificate verified against the informed
    CA; `ldap://` without StartTLS is refused (and the Status shows the error).
  - **Login:** a local account signs in as always. Without a local account (or with an AD account):
    - bind of the service account and search with the escaped value (RFC 4515);
    - exactly one account found, then bind with the person's password (empty password
      never: it would be an anonymous bind).
    - On the first access the account is created (name, email, role from the groups; audited).
      On the following ones, name, email and role are updated, and the role change is
      audited.
    - DeepLook's 2FA works the same.
  - **Careful:**
    - every failure responds "Invalid credentials", with the real reason only in the Audit log;
    - the attempt limit is the same as login;
    - a suspended account does not sign in, even with the right password (with the wrong one, 401 like
      any other);
    - an AD email that already belongs to a local account: AD does not take over the account.
  - **AD accounts:** no local password (the hash is random and never matches), no validity
    nor mandatory change. Changing the password (My Account) and "Reset password" (admin)
    respond 409.
  - **Screen:**
    - with AD on, the login asks for "Email or network username" (text field), with an
      explanation (`GET /api/auth/options`);
    - the Password tab of the AD account explains that the password is the network one;
    - the user list marks "AD" and disables "Reset password".
  - **System status:** an "AD/LDAP" line (connection and TLS, base, groups, AD accounts).
  - README, `.env.example` and compose with the variables.
  - **Tests:**
    - 34 checks with a **real OpenLDAP** (LDAPS and StartTLS with its own CA):
      - without AD nothing changes;
      - first access, by username and by email, roles from the groups;
      - the same response for a wrong password and a nonexistent user, injection in the filter,
        an account without an email (reason only in the audit);
      - local account not taken over, suspended, 2FA, change and reset refused;
      - role updated when leaving the group;
      - no TLS refused, wrong CA refused, Status;
      - empty password and the attempt limit;
    - `ldap-login.mjs`.

## Eighth batch — items 95 to 124

The result of the project sweep on 10/31/2026. Unless indicated, each problem was
confirmed by reading the code; item 101 was also reproduced in a test. Agreed order:
95 to 99 first; the rest will be ordered later. Decisions on 122 and 123 made on 10/31/2026.

### Biggest risk

### 95. Images installed from the lockfile
- **Problem:** the API and web Dockerfiles copy only `package.json`; with the `^`,
  production may run versions different from the tested ones.
- **Proposal:** `COPY package*.json` and `npm ci`, which fails if the lockfile diverges.
- ✅ **Implemented:** API and web with `package-lock.json` and `npm ci`. Tested: the two real
  images build with the lockfile versions (in web, build and `nginx -t`), and a diverging `package.json` makes `npm ci` fail.

### 96. Updated Chromium in the capture
- **Problem:** the capture opens hostile pages with Playwright 1.49.0 (November 2024) and
  has no lockfile.
- **Proposal:** a recent Playwright (exact version, at least two weeks old) in the capture and
  in the tests, its own lockfile and `npm ci`; a real capture test with the new image.
- ✅ **Implemented:** Playwright 1.64.1 (published on 10/14/2026) in the capture and in the tests, with
  its own lockfile and `npm ci`. Tested with the real image: it opens the page, with a screenshot and
  redirects, and refuses the internal network and metadata. `run.ps1` now runs all the
  scenarios and lists the ones that failed (`run-all.sh`); two scenarios started waiting for the dialog,
  because the new `click` does not wait for the navigation.

### 97. Default secrets refused
- **Problem:** the stack comes up with `SESSION_SECRET`, `CAPTURE_TOKEN` and default passwords, and the admin
  `admin12345` does not have to change the password.
- **Proposal:** the API does not start with known `SESSION_SECRET` or `CAPTURE_TOKEN` (a clear
  message; `ALLOW_INSECURE_DEFAULTS=true` for demonstration); the System status warns about the
  default database and MinIO passwords; the admin created by the seed, or whoever still uses the default
  password, changes it on the first access.
- **Careful:** installations with a default secret need to adjust `.env` before updating.
- ✅ **Implemented:**
  - in production the API does not start with a known `SESSION_SECRET` or `CAPTURE_TOKEN` (with the capture on)
    and explains what to do; `ALLOW_INSECURE_DEFAULTS=true` releases it for demonstration;
  - a "Configuration" line in the System status: default database and MinIO passwords;
  - a new admin changes the password on the first access, and the existing one who still uses the default password
    too, on every startup; the change screen with neutral text;
  - smoke scripts with `SMOKE_ADMIN_PASSWORD`; README and `.env.example`.

### 98. API without root and without development dependencies
- **Problem:** the container that analyzes malware runs as root and carries the development
  dependencies.
- **Proposal:** an unprivileged user, a final image with only what is needed to migrate, create
  the admin and run; `no-new-privileges` and `cap_drop: ALL` in compose.
- ✅ **Implemented:** a multi-stage image, the final one with `npm ci --omit=dev` and `USER node`, and the
  code owned by root (read-only for the process). The seed went to `src/seed.ts` and is
  compiled; the `prisma` CLI became a production dependency, to migrate on startup; compose with
  `cap_drop: ALL` and `no-new-privileges`. Tested with the real image without capabilities: migrations,
  admin, sample submission (native YARA) and backup with `pg_dump`.

### 99. Integration tests in the repository
- **Problem:** the tests against real Postgres, MinIO and LDAP live in a temporary folder (one
  was already lost), and there is no command to run them.
- **Proposal:** `apps/api/tests/` and `npm run test:integration`, which brings up what it needs in
  docker. CI waits for when the repository has a `remote`.
- ✅ **Implemented:** `apps/api/tests/`, with 14 files (290 checks) and
  `npm run test:integration`, which brings up Postgres, MinIO and OpenLDAP, generates certificates and disk
  images, and uses a new database per file; `npm run test:images` tests the real images (22
  checks). Lint and types cover the tests. **CI was not created:** the repository has no `remote`,
  and there would be no way to see the workflow run.
- **Limit:** the integration tests from before item 81 were lost; only the screen ones keep
  covering those items.

### Bugs

### 100. General notice leaks the case title
A regular user receives the title of the case linked to the notice, and the link leads to a screen without access.
No case for whoever is not an analyst.
✅ **Implemented:** a regular user receives the notice without the case.

### 101. Lookalike domain: false positive with a registered subdomain
With `portal.empresa.com.br` registered, `mail.empresa.com.br` and `empresa.com.br` become
"probable scam". The same base domain is not similar.
✅ **Implemented:** the same base domain is never "similar".

### 102. Resolution draft carries over to another sample
When using Next and Discard, the text stays if both samples have the same resolution, and
saving writes to the wrong sample. The form restarts for each sample.
✅ **Implemented:** the form restarts for each sample. The bug only happened when going back to a sample already visited (it comes
from the cache, without the "loading" screen), and that is how the scenario reproduced it.

### 103. Unmarking a duplicate keeps the inherited resolution
The main one's resolution stays highlighted and the original was lost. Store and return the
previous one, as already happens with status and verdict.
✅ **Implemented:** marking stores the previous resolution; unmarking returns it. Inheritance and return appear in the history.

### 104. Backup progress without error handling
`void setStep` can bring the API down on a database failure and overwrite the row already ready.
✅ **Implemented:** recording the progress never brings down the API or the backup, and the upload waits for each write, so as not to overwrite the ready row.

### 105. Restore without mentioning `SESSION_SECRET`
With another secret, the 2FA stop working. Include it in the README (inside the ZIP) and in the README.
✅ **Implemented:** the ZIP's README and the README mention `SESSION_SECRET`.

### 106. Backup restored without the samples
The download gives an error instead of "file unavailable", and the README does not warn.
✅ **Implemented:** a file outside the bucket responds 404 "The file of this sample is not in storage" (on the download and on any other route), it does not go to the audit, and the README warns.

### 107. AD account role editable on screen
The next login undoes the change without warning. Disable the selector and refuse in the API.
✅ **Implemented:** selector disabled on screen; the API responds 409.

### 108. Accesses that survive the loss of trust
An API token survives a password change or reset; a token and a session survive the
person leaving AD. Revoke on password changes and define the rule for AD accounts.
✅ **Implemented:** a voluntary change and an admin reset revoke the tokens (the change due to an expired password does not, so as not to break scripts every cycle). AD rule (`lib/ldap-sweep.ts`): every hour, an account removed or disabled is suspended, with sessions and tokens revoked and audited; AD being down changes nothing, and if most seem to have disappeared nobody is suspended.

### 109. Interrupted domain rescan
Two simultaneous scans collide (`createMany` without `skipDuplicates`) and the second stops.
✅ **Implemented:** `skipDuplicates` in the writes; tested with three simultaneous scans.

### 110. 500 error on the AD login
A new email that already exists or two simultaneous first accesses.
✅ **Implemented:** simultaneous first accesses use the same account; a new email that already belongs to another account keeps the current one.

### 111. Race between checking and writing
Activation key above the limit, more than 3 active notices, two backups at the same time.
✅ **Implemented:** activation key with a conditional count in the transaction; notices and backups with a lock in the transaction. Against the old code, a single-use key created 5 accounts and 4 requests generated 4 backups. Simultaneous sign-ups with the same email respond 409 instead of 500.

### Security

### 112. Forgeable IP
`trustProxy: true` with the `X-Forwarded-For` appended by nginx lets the client forge the
IP in the audit and in the sessions. Trust only the known proxy.
✅ **Implemented:** nginx replaces the `X-Forwarded-For` and only accepts the `CF-Connecting-IP` from a private network connection (the local `cloudflared`); the API only trusts a private network proxy. Tested on the real nginx: a forged value discarded, the Tunnel respected, and without a proxy the connection applies.

### 113. Login: third-party blocking and enumeration
A limit only by email allows locking another person's account and testing one password on many
accounts; "Account suspended" appears without checking the password; a nonexistent email responds faster.
- **Decision (10/31/2026):** in test there is no proxy; in production the access always goes through the
  Cloudflare Tunnel, so the `CF-Connecting-IP` coming from `cloudflared` applies.
✅ **Implemented:** a limit by email + IP, so nobody locks someone else's account from another IP; plus 30 failures per IP and 20 per email in 5 minutes; "Account suspended" only with the right password; a nonexistent email also pays for bcrypt; sign-up with a limit of 10 attempts per IP.

### 114. Incomplete audit
Company domains (they change the allowlist), triage rules, automatic assignment
and general notices.
✅ **Implemented:** company domains, triage rules, automatic assignment (groups, rules, order and absence) and general notices, with six new actions and a filter on the screen.

### 115. Headers and cookie
No CSP and HSTS in nginx; `COOKIE_SECURE` comes as `false`.
✅ **Implemented:** CSP and HSTS in nginx; the production CSP applies in the screen scenarios (a violation fails the scenario); the System status warns while `COOKIE_SECURE` is off, without changing the default, because in test the access is over HTTP.

### 116. Backup without encryption and without checking the disk
The ZIP has password hashes and 2FA secrets, stays in the source bucket, and the generation does not check
the disk space. Evaluate a password/encryption and a space warning.
- **Decision (10/31/2026):** a password provided when generating the ZIP, with the option to export without a password.
✅ **Implemented:** a mandatory password when generating, of 12 characters or more, or the explicit option to export without it, with confirmation. AES-256 in the WinZip AE-2 standard, checked in 7-Zip. The password only stays in memory during the generation: it does not go to the database, the audit or the response. **Limits:** the file names inside the ZIP are not encrypted, and the standard uses PBKDF2 with 1000 iterations, hence the minimum of 12 characters. Disk: the backup fails right away, with the reason, if it does not fit. The ZIP stays in the source bucket until it expires.

### Operation and polish

### 117. Upload in memory
Each submission goes entirely into memory (up to 200 MB), the API has no `mem_limit`, and nginx accepts
1 GB.
✅ **Implemented:** a memory budget for simultaneous submissions (`MAX_UPLOAD_MEMORY_MB`, default 600): above it, 503 "try again shortly". A file above the limit is refused by the `Content-Length`, before being read. `mem_limit` in the API container (`API_MEM_LIMIT`, default 4g). **Different from the proposal:** writing to disk would not help, because the analysis, the ZIP, the `.eml`, the antivirus and YARA read the whole file into memory. **Limit:** the antivirus and YARA, in the background, hold the file after the response, outside the budget; what covers that case is the `mem_limit`.

### 118. Cleanup and indexes
Expired sessions are never deleted; `Notification` without an index on `entryId` and `caseId`.
✅ **Implemented:** hourly cleanup of the expired sessions; indexes on `entryId` and `caseId` in the notifications.

### 119. Containers
No controlled shutdown (SIGTERM) or API healthcheck; `minio:latest` and `clamav:stable`
without a pinned version.
✅ **Implemented:** controlled shutdown on SIGTERM/SIGINT, with a 15 s ceiling; API healthcheck, and the web waits for it to be healthy; ClamAV in `1.5`. The `quay.io/minio/minio:latest` default no longer resolves (401), so the default became the digest of `elestio/minio`, from 10/15/2025.

### 120. Messages without accents
About 60 API messages, such as "Credenciais invalidas" and "Dados invalidos".
✅ **Implemented:** user-facing API messages with accents. Logs and the sandbox ISO text stay without accents.

### 121. Lookalike domains: noise with short names
`empresarial.com` looks like `empresa.com.br`. A higher limit or a list of typical scam
words.
✅ **Implemented:** "extra word" only counts with a typical scam word (login, security, support, account...). **Effect:** `empresa-anything.com` stops being flagged.

### Decisions made

### 122. Who downloads samples
Today any regular user downloads anyone's sample, without audit.
- **Decision (10/31/2026):** only whoever submitted it and the analysts download, always with audit.
- ✅ **Implemented** (migration `20261209000000_entry_downloaded_audit`): the download responds 403
  to whoever did not submit it and is not an analyst, before revealing any state of the file, and each completed download
  goes to the Audit log ("Sample downloaded", with who downloaded it, the sample, the owner and the
  SHA-256). "Download sample" only appears for whoever can. An API token still does not download.

### 123. Email of whoever submitted it
The global list and the CSV show that email to all users.
- **Decision (10/31/2026):** regular users see only the name; analysts and administrators see the
  email.
- ✅ **Implemented:** `ownerForViewer` (`lib/auth.ts`) removes the email in the list, on the card, on the indicator card
  and in Related; the person themselves keeps seeing theirs. The CSV already exported only the
  name. The card and the print show only the name when there is no email.
- **Tests of both items:** `tests/integration/sample-access.test.ts` (30 checks) and
  `sample-access.mjs`.

### Suggestions

### 124. Product ideas
Resolution in the bulk update and in the CSV; a "lookalike domain" condition in the triage rules;
nested AD groups; a quick test against the real API, to complement the mock.

**Decisions:**
- **a. Quick test (`npm run test:smoke`):** a real browser, with the real web and API
  images, plus Postgres and MinIO, on its own network. It runs the main path (first access, submission,
  triage, regular user) and opens the screens; any unexpected 4xx/5xx API error, console error
  or CSP violation fails it. It does not enter the screen suite, because it needs to build the images.
- **b. Resolution in bulk and in the CSV:** a field in the bulk update bar, with the templates as
  a suggestion. Empty keeps it; removing stays on the card, because deleting on many at once by
  mistake is worse than the work of removing one by one. Same rules as the card: history, inheritance
  of duplicates and notice to whoever submitted it. A "Resolution" column in the CSV for everyone, because the card already
  shows it to everyone.
- **c. "Lookalike domain" condition:** an optional value with the company domain (empty = any).
  It applies on arrival, like the others. Changing the company domain list or publishing a report does not
  reapply rules to the old samples: it redoes the findings, but does not touch tags and priority.
- **d. Nested AD groups:** `LDAP_NESTED_GROUPS`, off by default, because enabling it may give a
  role to more people. It climbs through the groups' `memberOf`, which works in AD and in the test OpenLDAP.
  Up to 200 groups per login. A group the server refuses or does not find is ignored; AD dropping halfway
  fails the login, instead of lowering the role for no reason.

✅ **124a implemented:** `npm run test:smoke`, with the real web and API images. **It found a bug on the first round:** the regular user opened `/revisoes` by URL and got 403 from the API. The route now sends them to the start, like the other analyst screens. **Outside the test:** antivirus, capture, sandbox and AD stay off.

✅ **124b implemented:** a "Resolution" field in the bulk update bar, with the templates as a suggestion, and a column in the CSV. **A caution found in the test:** with the main one and the duplicate checked together, the duplicate recorded two events and warned twice; now it is a single one, re-reading the resolution inside the transaction.

✅ **124c implemented:** condition "Looks like a company domain", with an optional value. It looks at the same domains as the scan: link, sender, email links and indicators. It applies on arrival and when YARA or the antivirus finish.

✅ **124d implemented:** `LDAP_NESTED_GROUPS=true` climbs through the groups' `memberOf`, without repeating a group, so cycles end. Tested on the real OpenLDAP; **not tested on a real AD**. **Limits:** the primary group ("Domain Users") does not appear in `memberOf`, and a group from another domain is ignored. The AD test also stopped oscillating: OpenLDAP generated DH parameters on startup, sometimes for more than a minute, and now uses a ready file.

## Ninth batch — items 125 to 140

They came from the usability validation of 10/31/2026, on 35 admin screens and 9 regular-user screens, at
four widths, with the simulated API and `axe-core`. Items 125 to 133 come first; the others
stay recorded.

### High priority

### 125. Long name breaks the list
With 200 characters without spaces, the table reaches 2200 px and Status, Verdict and Date disappear from the screen.
**Decision:** at most two lines and 28rem in the column, with the full name in the `title` and on the card.
✅ **Implemented:** in the sample tables, at most two lines and 28rem, with the full name in the `title`. The following columns stay visible.

### 126. Long name breaks the card
The title leaves the screen and the page scrolls 485 px sideways. **Decision:** break the title over several lines.
✅ **Implemented:** the title and the card fields break at any point; nothing leaves the screen.

### 127. Mobile: the page scrolls sideways
At 390 px, the card scrolls 14 px for the regular user and 73 px for the analyst; Global History and
Administration scroll about 350 px. **Decision:** the tab strip scrolls by itself and keeps the active one visible.
✅ **Implemented:** the page tabs scroll in their own strip and keep the active one visible, without touching the page scroll. **Cause in the Global History:** screen-reader-only text escaped the table's clipping.

### Medium priority

### 128. Network drop on submission
The person reads "Failed to fetch". **Decision:** a Portuguese message, in all calls to the API.
✅ **Implemented:** a Portuguese message in all calls to the API. The chosen file stays on screen to try again.

### 129. Size limit does not appear
The screen says "as configured on the server". **Decision:** show the real limit and refuse the file
larger than it before sending; the API keeps checking.
✅ **Implemented:** the help shows the real limit (`maxUploadMb` in `/api/me/upload-quota`) and the larger file is refused before sending, with the name in the notice. A batch with a file too large is not sent until it leaves. The API keeps checking.

### 130. Submission without progress
A large file stays only at "Sending...". **Decision:** a percentage during the upload and "analyzing" afterwards.
✅ **Implemented:** a percentage during the upload and "analyzing" afterwards, in a single file, batch and `.zip`. The quick test proves the single-file path against the real API, with the upload limited to 2 MB/s. **Limit:** there is no button to cancel the submission.

### 131. Browser tab title
It is always "DeepLook". **Decision:** screen or sample name + "DeepLook".
✅ **Implemented:** screen or sample name + "DeepLook"; only "DeepLook" outside the session.

### 132. No "skip to content"
More than 70 Tabs did not reach the first row of the list. **Decision:** a link on the first Tab, which goes
to the screen content.
✅ **Implemented:** it is the first Tab and goes to the content. In the Global History, the first row is now at 25 Tabs, against more than 70; what remains are filters and sorting headers.

### 133. Menu on mobile
Esc does not close it, the button does not report whether it is open, and the links of the closed menu receive focus.
✅ **Implemented:** the button reports the state, the focus enters the menu on opening, Esc closes it and returns the focus, and the links of the closed menu no longer receive focus.

### Low priority

### 134. Contrast
Help texts at 3.94:1 (minimum 4.5:1) and links in the middle of the text at 1.78:1 (minimum 3:1).
✅ **Implemented:** help texts in `#666666` and underlined links in the middle of the text and in the messages. `axe-core` no longer finds a contrast violation in the 43 audited screens, with the simulated API data.

### 135. Enter on the link submission
It does not send; only the button and Ctrl+S work.
✅ **Implemented:** Enter in a single-line field sends and goes through the same validation; in the description, it keeps breaking the line.

### 136. Empty list
"My Uploads" with no submission gives the same message as a filter with no results, without a shortcut to
submit, and still shows the "select all" checkbox.
✅ **Implemented:** its own message when nothing was submitted, with a shortcut to "Submit Sample"; "No samples found" stays for a filter with no results; without rows, no "select all".

### Suggestions

### 137. Card for non-technical people
The regular user sees SHA-256, TLSH and MIME type first. Idea: the situation in plain language at the top.
**Decision:** a warning only for the regular user, without a written resolution, and the "File" section starts
collapsed; they can open it. Analysts do not change.
✅ **Implemented:** a "Situation" notice by status and verdict, with the promise of a notice only for whoever submitted it; "File" starts collapsed for the regular user.

### 138. Dashboard and Home Page of the regular user
Remove "ATT&CK techniques", "72 h in status" and the shortcut list; add "I clicked or opened it, what now?".
**Decision:** only for the regular user; their dashboard stays without deadlines and without ATT&CK.
✅ **Implemented:** a dashboard without deadlines and without ATT&CK; a Home Page with "I clicked or opened it, what now?" and without the shortcut list, which keeps working.

### 139. The word "community"
It appears on three screens. Review if DeepLook goes to companies.
**Decision:** swap it for "team" or remove it, where the sentence still makes sense.
✅ **Implemented:** swapped for "team" or removed on the three screens and on the public page.

### Decision made

### 140. Global History open to everyone — deferred
The regular user keeps seeing and exporting everyone's samples, because DeepLook will not be
deployed in companies yet. **Later:** an option in Administration that restricts each user to what they
submitted themselves.
**Decisions:**
- **Default off:** nothing changes until an admin turns it on, in Administration > Settings, with audit.
- **Regular user only:** analysts and admins keep seeing everything.
- **Applies in the API, not only on screen:** another person's sample responds 404, without revealing that it exists, in
  every `/api/entries/:id...` route, including future ones, and also through an API token. Lists, CSV,
  counters, search, indicator card, related, map, notices, favorites, knowledge base citations,
  evidence and the "already submitted" notice stay with only theirs.
- **What stays the same:** the knowledge base. The watched indicator notice keeps being
  generated, but only appears to the regular user if the sample is theirs.
- **The Global History** leaves their menu, and the address leads to My Uploads.
✅ **Implemented:** an option in Administration > Settings, off by default. A test sweeps every `/api/entries/:id...` route, including future ones, and requires 404 for someone else's sample; the other routes were reviewed one by one. **Limits:** their duplicate keeps the resolution inherited from someone else's sample, because it is its guidance; the main one's id stays in the response, without title or access; and the number of citations in the knowledge base list keeps counting all of them, without saying which.

### User request

### 141. Side menu remembers what was collapsed
The Navigator folders went back to all open on every session. **Decision:** store it in the user
preferences, on the server: it applies to the next sessions and on another computer. "Restore defaults" and
"Save" in Preferences do not touch it.

✅ **Implemented:** the collapsed folders stay in `closedFolders` in the preferences, written 400 ms after the last click. They apply to the next sessions and on another computer. **If the write fails,** the folder stays collapsed in the session, without an error notice, and the change does not apply to the next one.

## Tenth batch — items 142 to 146: pre-configured YARA rules

Evaluation of 11/01/2026: each set compiled in YARA-X 1.21 and scanned over 1,122 benign files
(430 MB). ReversingLabs, bartblaze and signature-base did not fire on any. YARA Forge stayed out
because of a 7.7 MB file, with mixed licenses and twice the time. Elastic (Elastic License 2.0)
and Yara-Rules (GPL-2.0) also stayed out, only because of the license.

### 142. Private rule counted as a detection
YARA-X returns private rules in the result, marked with `isPrivate`, and DeepLook counted them.
An auxiliary rule flagged almost every file and triggered the triage rules.
✅ **Implemented:** `scanBuffer` ignores the private ones; it also applies to the retroactive scan. **Old results** only change when the sample is scanned again.

### 143. Rule packs enabled by default
ReversingLabs and bartblaze (without the `generic` folder, which the source itself says does not indicate malware).
**Decisions:**
- files in the repository, without changing the content, with the license and the origin commit; nothing is downloaded
  on startup;
- one set per file, installed only once: what the analyst disables or deletes does not come back;
- a pack rule is not edited, so as not to lose the authorship; disabling, deleting and the retroactive scan
  keep working, and the 64 KB limit only applies to the team rules.
✅ **Implemented:** 310 ReversingLabs sets and 89 bartblaze sets, installed on startup, in `apps/api/rules`. **Bug found in the measurement:** a set that did not compile made the whole compilation fail, although the comment promised the opposite; now it stays out and the others continue. **Limit:** detection was not measured with real malware, only with rules triggered by harmless content; the absence of false positives applies to the 1,122 tested files.

### 144. Optional signature-base
A disabled pack, which Administration turns on in Administration > Settings. It is only installed when turned on,
without the files that need external variables (`filename`, `filepath`, `extension`). Decision
recorded on 11/01/2026.
✅ **Implemented:** 739 sets, 13 files out. Disabling keeps the rules and what was disabled.

### 145. Author in the detections
Author and pack appear in the scan result. The signature-base DRL 1.1 license requires keeping
the author in the detection messages, which was accepted.
✅ **Implemented:** the author comes from the rule's `meta` or, without it, from the pack; the card shows author and pack. Old scans stay without the author until scanned again.

### 146. Performance with the packs
The scan runs on the API's main thread. **Decision:** measure with the packs; if it blocks the API for a
perceptible time, move the compilation and the scan to a separate thread.
✅ **Implemented:** measured first: compiling blocked the API for 2.8 s (5.9 s with signature-base) and scanning 200 MB for up to 2 s. The compilation and the scan, including the retroactive one, went to a separate thread, one scan at a time. The test requires the API to keep answering while it compiles. **Cost:** the file is copied to the thread during the scan, and the compiled rules take about 70 MB.

### 147. The 13 signature-base files with external variables
They ask for `filename`, `filepath`, `extension`, `filetype` and `owner`, which come from scanning a disk.
**Decisions:** DeepLook defines only what it really knows:
- `filename` and `extension`: the original name of the submitted file;
- `filetype`: the type detected in the analysis (EXE, ELF, MACH-O, RTF, PowerShell, VBS, BATCH), otherwise empty;
- `filepath` and `owner`: empty, because a submission has no folder or owner. A rule that requires a path
  never fires; the one that only excludes paths (browser cache) keeps applying, which is the right thing for
  a submitted file.
- The `Suspicious_Size_*` rules are ignored: they compare the size of Windows files and flagged
  the legitimate `winlogon.exe` of this Windows 11. The file stays unchanged.
✅ **Implemented:** the 752 signature-base files enter, none out. In 2,064 benign files with the real names (System32, drivers and others), the 13 only flagged `winlogon.exe`, by `Suspicious_Size_winlogon_exe`, now ignored. **Limit:** a rule that requires a path, such as the ScreenConnect folder, does not fire on a submission.

### 148. YARA engine stops working after about 16 thousand calls
Found on 11/01/2026 while testing the variables, with versions 1.21.0 and 1.22.0 of `@virustotal/yara-x`:
the scan and `setGlobal` always add up to about 16,270 calls, and after that every scan fails with
`unreachable` until the API restarts. It already applied before the variables, in about 16 thousand scans.
**Decision:** recycle the thread before the limit and when the engine breaks, repeating the scan once.
✅ **Implemented:** the thread is swapped every 9 thousand calls, about a thousand scans after compiling everything, and the scan that finds the broken engine is repeated in a new thread. Tested with 3 thousand scans in a row. **Cost:** recompiling takes about 8 s with the three packs, without blocking the API; whoever arrives in that interval waits in the queue. **Open:** 1.22.1 was not finished in the test and does not have the required two weeks of age yet.

### 149. Scan memory
The file was copied twice to the thread, and WebAssembly never gives memory back.
**Decision:** a single copy, transferred; recycle the thread after a large file; measure before changing
the `mem_limit`.
✅ **Implemented:** measured with the three packs and a 200 MB file: compiled rules at about 220 MB and a 909 MB peak, which goes back to about 300 MB when the thread is swapped, done after files of 100 MB or more. The 4 GB `mem_limit` stays as it is. **Not tested** in a limited container, with several large submissions at the same time.

### 150. Automatic pack update — planning
**Decisions of 11/01/2026:** it applies by itself what passes the filters, holds the rest for an admin, and comes
enabled by default.
**Plan:**
- **Source:** only the three repositories, fixed in the code. The commit ZIP is read in memory, with a size
  limit; nothing is written to disk or executed.
- **Frequency:** a weekly check and a "Check now" button. In 90 days, signature-base had 15
  commits, and the other two, none.
- **Filters before applying:** a commit at least 7 days old; identical license; each file compiles,
  otherwise the previous version of it stays; up to 20% of sets changed or removed; no new rule
  firing on the recent samples with a Clean verdict; compilation up to 2x slower. If a pack
  filter fails, the update is held, awaiting an admin's approval.
- **Applying:** everything in one transaction, with the previous version kept and a button to roll back. A disabled
  rule stays disabled; a deleted rule does not come back (remembered by the file path); a new
  file enters active; a file removed at the source leaves.
- **Afterwards:** audit, a notice to the admins and a line in the System status. Old samples are not
  scanned by themselves.
- **Without internet:** nothing changes, and the check tries again next time.
- **Steps:** (1) identify the rule by pack and file and remember the deleted ones; (2) check without
  applying, showing what would change; (3) apply and roll back; (4) schedule and turn it on in Settings.

✅ **Implemented:** a weekly check and a "Check now" button, with a preview; it applies by itself what passes the filters, holds the rest to approve or discard, and the last applied one comes back with one click. Tested with a simulated source and in a check without applying against the real GitHub. **Found in the test:** the notices table constraint required a sample or a case and would break the update when warning the admins; it was adjusted. **Limits:** without samples with a Clean verdict, that filter has nothing to check; a new rule only applies to the next files; and a real update has not happened yet, because the commits 7 days old are older than the installed ones.

### 151. Page capture refused every site with IPv4
Found on 11/01/2026 in the general review: the `::ffff:0:0/96` range of the outbound proxy also catches IPv4 in Node's `BlockList`, so any site with an IPv4 address gave "internal address blocked". The tests only used an allowed `localhost` and simulated responses.
✅ **Implemented:** range removed and `npm test` in the capture service. Tested with a real capture of `example.com` and `1.1.1.1`; the internal network, loopback, metadata and an internal IPv4 inside IPv6 stay blocked. Teredo, 6to4 and `64:ff9b:1::/48` entered the list.

### 152. A page with an infinite loop stopped the capture queue
Reading the content of a stuck page has no time limit. A single page like that left all the following captures without a response until the service restarted, with `/health` saying everything was fine.
✅ **Implemented:** a 60 s ceiling per capture; on timeout, the browser is closed and the next one opens another. Reproduced before and after: the next capture works again. The container now runs with `cap_drop: ALL` and `pids_limit: 512`.

### 153. Capture screenshot and HTML outside the "own samples only" restriction
`/api/captures/:id/*` did not apply the item 140 filter, and the test only swept `/api/entries/:id` routes.
✅ **Implemented:** another person's sample responds 404, with a test.

### 154. Session and 2FA
- The session id, which is the cookie value, was a cuid, largely predictable. Now it has 256 random bits. Open sessions keep working until they expire.
- The same TOTP code was accepted by simultaneous requests (8 of 8 in the test). Now only one passes.
- The console WebSocket, which authenticates outside `requireUser`, ignored the password to be changed. Now it refuses.
✅ **Implemented:** the three with a test, which failed before the fix.

### 155. GCM tag truncated in the 2FA secret and vite exposing denied files
Found on 11/01/2026 by Strix and reproduced before the fix.
- `decryptSecret` did not fix the tag size. On Node 22, the one in the production image, a 4 to 15 byte tag was accepted. Exploiting it requires writing to the database, and whoever has that can already delete the secret; the real severity is low. Node 26 already refuses it by itself, so the test only really protects when it runs on Node 22.
- vite 6.4.4 served files from `server.fs.deny` with `?raw` and variants (GHSA-8g5g-mxqh-grgj, CVE-2026-118662; the report cited another CVE). It only affects `npm run dev`, but `vite.config.ts` uses `host: true`, so any machine on the network reaches a `.env` in `apps/web`. Production does not use vite.
✅ **Implemented:** `authTagLength: 16` and vite 6.4.5. Tested on Node 22 (4, 8, 12 and 15 byte tags refused, the 16 byte one decrypts) and with a test `.env` in vite (200 before, 403 after).
**No fix for now:** minimatch below 11.0.1 (GHSA-g3hv-75wg-m249), through eslint and typescript-eslint. Their latest versions still ask for `^10`, and `npm audit fix` would downgrade. It requires a glob pattern coming from the attacker, and here the globs only come from the lint configuration.

### 156. Hostile file hanging or bringing down the API
Found on 11/01/2026 by Strix (second round) and reproduced before the fix. A 1.5 KB OLE ran out of memory and brought the process down; FAT, PDF, OOXML, script and .zip blocked the API for tens of seconds on every submission. The review found worse cases than the report: a 2.4 KB .docx blocked for 52 s and a 2.3 KB one for 73 s (quadratic regex in `<Relationship` and `instrText`), and a PDF with many small streams also ran out of memory.
✅ **Implemented:** a work limit in each analyzer (entries already visited in OLE and in the FAT and ISO directories; streams, `/URI` tokens and bytes that failed in the PDF; unique parts and 64 MB in OOXML; script rules limited to 1000 characters per line; in the .zip, attempts and bytes count even when the extraction fails, and nothing decompresses beyond the declared size). The static analysis moved to its own thread, with 60 s and 1.5 GB: if it overflows, only it falls and the sample stays without analysis. Tested with the same files, in the production build and on Node 22. A name or text with NUL in the file no longer gives a 500 on submission.
**Limits:** extracting a .zip still runs on the main thread, and the worst package costs about 1 s per submission. The analyses run one at a time, so a file that reaches 60 s delays the following ones, but not the rest of the API.

### 157. Access that survived suspension and demotion
Found by Strix and reproduced before the fix.
- Reactivating the account returned the sessions and tokens from before the suspension.
- A demoted analyst kept controlling the isolated environment they opened: extend, power, discard and get the console password.
✅ **Implemented:** suspending deletes sessions and revokes tokens in the same transaction, with the count in the audit. Only whoever is still an analyst operates the environment (routes and WebSocket), and suspending or demoting ends the open environments, also through AD. Each extension is worth at most one TTL; before, a huge value gave a 500.

### 158. Analyst and other people's data in the responses
Found by Strix and reproduced before the fix.
- The history gave regular users the reviewer's note and the draft verdict, which the reports route hides. The Proxmox error (`SANDBOX_FAILED`) left with it.
- The PATCH of a sample returned the submitter's email.
- `GET /api/entries/:id/sandbox` showed node, VM, IP and analyst to whoever sees the sample.
- With "own samples only" on, another person's sample title and id appeared in the duplicate history and in `duplicateOfId`/`parentEntryId`. The report says it is also a leak with the option off; it is not, because then everyone sees all the samples.
✅ **Implemented:** the four closed, with a test. The list gained `isDuplicate`, to keep the duplicate notice without the id.

### 159. AD account taking over another through the email
Found by Strix and reproduced in OpenLDAP. The login looked for the account by email when it did not find it by DN, and then swapped the DN and the role: another AD account with the same `mail` signed in as the victim and locked them out.
✅ **Implemented:** an email of an account linked to another DN is refused and audited. It only relinks if the old DN no longer exists in AD (the person changed OU), with a new audit and sessions and tokens revoked. With AD down, it refuses.
**Limit:** between someone leaving AD and the following sweep (up to 1 h), a new account with the same email still relinks. After the sweep the account is suspended, and the login is refused.

### 160. Login blocking by email
Found by Strix. The report treats it as an oversight, but the 20-failures-per-email window is the decision of item 113 against an attack from many IPs. The problem is real anyway: four IPs are enough to lock an account. The forged IP in the proof only works from a private network; in production four real IPs are needed.
✅ **Implemented:** the right login writes a signed cookie (`dl_device`, 90 days), and whoever has it no longer stops at that window. The limit by email + IP keeps applying to them.
**Limit:** in a new browser, or with the cookie deleted, the person is still subject to the block during the attack.

### 161. Submission quota exceeded with simultaneous submissions
Found by Strix, which measured 27 of 20. In the reproduction 30 of 30 passed.
✅ **Implemented:** the quota is checked again with a per-person lock, in the same transaction that writes the sample (file, link, .zip and attachments); the file beyond the quota is deleted from storage. Tested with 30 simultaneous submissions: 20 written and 10 with 429.

### 162. MinIO CVEs (CVE-2026-40344 and CVE-2026-41145)
Real in the pinned image, and only reachable from inside the `deeplook` network. `minio/minio` was archived and the official fix only came out in AIStor, so there was no tag from the same source to update.
✅ **Implemented:** the default became the community fork `pgsty/silo` (`RELEASE.2026-10-26T00-00-00Z`, pinned by digest), which declares both fixed since `RELEASE.2026-04-17T00-00-00Z`. Tested: a copy of `data/minio` read the same in the two images (objects, hashes and metadata), a test volume went back and forth between the images, with simple and multipart submissions, and the integration suite passed on Silo.
**Limit:** the CVE fix comes from the project's announcement; there was no proof of exploitation before and after. To go back, just set `MINIO_IMAGE` to the previous image, but it has both CVEs.

## Eleventh batch — items 163 to 181

Chosen on 11/01/2026, after a survey of what the tool already does: search inside the analysis,
URL and IPv6 IOCs, reading ELF, APK and JAR, opening 7z and RAR, automatic link capture,
notice preferences and collection in the sandbox. Webhooks (65), email (79) and AI stay out. Delivery
order: the parsers before the search, the capture queue before the rule action, the extraction
service before the route, and the guest agent client before the collection.

**Decisions of 11/01/2026:**
- search in the analysis: the regular user searches only their own samples, even with "own samples only" off;
- 7z and RAR: only analysts extract, as with the disk image, without automatic recursion;
- collection in the sandbox: it only turns on with a Proxmox pool, and the privilege stays limited to it;
- automatic capture: a global switch, off, that only the admin turns on; with it, analysts mark the
  capture in each rule.

**Assumed in the plan:** the email body does not enter the index; an imported URL stays a URL, and not the
domain; the extraction service comes up enabled, like the capture one; the indexed strings leave when
retention purges the file; the collection also runs when discarding the environment, without delaying the
destruction.

### 163. Fixes found in the survey
- The indicator card returns the allowlist reason to any user, and the list itself is only
  for analysts.
- The link submission accepts `javascript:` and `ftp:`, without a size limit.
- The query string goes to the API and nginx logs; with the full URL searchable, that includes links
  with the victim's token.
- The disk image extraction reads the image on the main thread.
- To check with a test: triage rule events show the rule name and tags to the regular user.

The first four and the fifth were confirmed, all reproduced with a test before the fix.
✅ **Implemented:**
- **Allowed:** whoever is not an analyst receives `allowed: null` on the indicator card, without the reason nor the
  item that covers the indicator, which would also reveal the list.
- **Link:** only `http` and `https`, up to 2048 characters; `javascript:`, `ftp:` and `data:` receive 400 with
  "invalid URL". Links already recorded stay as they are.
- **Logs:** the API records the path without the query string, and nginx uses a format with `$uri`, without the
  query and without the referer, which on the site itself is the whole URL.
- **Disk image:** the listing runs on the analysis thread. The copy of each file stays on the
  main one: it is linear and bounded by the size, and returning everything at once would let a hostile ISO, with
  files that point to the same bytes, multiply the memory.
- **Triage rule:** the event leaves the history of whoever is not an analyst, like the report review
  ones. The applied tags stay on the sample.

**Limit:** the old logs keep the query string, and the nginx error log still brings the request
line when the API does not respond.

### 164. Notice preferences by type
Each person chooses, in My Account, which notices reach the Inbox. **Decision:** what asks for someone's
action is not muted: assignment (sample and case), overdue, YARA pack update,
resolution and returned report. Muting applies to the next notices; the history does not change.
✅ **Implemented:** a **Notifications** tab in My Account, with the types the person can receive by
role (`GET /api/me/notification-types`); the locked ones appear checked, disabled and with "(always
arrives)". The list stays in `mutedNotifications`, in the preferences, without a migration. `notify()` discards the
muted one **before** removing the repeated ones: with the mention muted, the update of the same sample
still arrives. An unknown or locked type leaves on write and on read, and the server checks again when
notifying, so writing straight to the database also does not mute what asks for action. The classification is a
`Record` of the types, and a new type without classification does not compile. The Preferences tab does not touch the
list. **A finding along the way:** the preferences table of `interface-hpsm.md` did not have `closedFolders`
nor the `dashboard` start page.

### 165. URL and IPv6 IOCs: extraction and index
The types today are IPv4, domain, email and hashes. **Decision:** URL only http/https, without user, password and
fragment, up to 2048 characters; IPv6 in canonical form (RFC 5952), with `::ffff:` becoming IPv4. The
reputation does not change: the full URL never leaves the server.
✅ **Implemented** (migration `20261217000000_ioc_url_ipv6`: `IPV6` and `URL` types, `IocUrl` table and
`Entry.urlKey`):
- **Normalization** in `lib/ioc-normalize.ts`. **URL:** only http/https, without user, password and fragment, up to
  2048 characters; path and query stay as they came. **IPv6:** canonical form, without zone and without
  internal network; `::ffff:` becomes IPv4, and a bare IPv6 only counts with three groups or more, so `add::` and
  `bad::` do not become indicators.
- **Extraction:** the email and the domain inside a link's query no longer become an indicator. Before,
  `?user=vitima@empresa.com` linked unrelated samples in Related. The host still comes before
  the URL, so "Go to:" keeps opening the domain.
- **Link sample:** it starts having the URL and the host as IPv4 or IPv6. Before, the IP host appeared as a
  domain. The IPv4 and IPv6 cards also find the links hosted at the address; before, that only
  applied to a domain. Whoever follows a URL is warned with only `https://host/…` in the text.
- **Export** CSV, STIX (`ipv6-addr`) and MISP already carry IPv6.
- **Analysis suggestions:** up to 15 of each type, in place of the first 50.
- **Existing databases:** on startup, once and in the background, the key of the links and the IOCs of the
  published reports are redone without warning whoever follows them.

**Left for the following items:** the URL card and "Go to:" with a URL (166); IPv6 in the import and
in the allowlist (167), which until then respond "IPv6 is not imported yet".

### 166. URL indicator page
The `/iocs/:type/:value` path does not hold a URL, and it would take the victim's token into the browser history
and the logs. **Decision:** the URL is opened by its SHA-256; only whoever has a visible
sighting or the watch itself sees the value.
✅ **Implemented:** the URL card stays at `/iocs/url/<SHA-256 of the link>`, on screen and in the API, and the web
computes the key without a server round trip. The sample list, the case, the analysis suggestions and My Account
open that card; before, the URL was text only. The card shows the link and the host, which leads to the
domain or IP card, and "It is the sample's link" on link samples. "Go to:" sends the text in the body
(`POST /api/iocs/resolve`), and a link on its own opens the URL card; a domain keeps opening the
domain one. Following and unfollowing also go by key.
**Decision along the way:** the card returns the link of any known key, and not only for whoever has a
visible sighting. The key is the SHA-256 of the link, so whoever has it already knows the link, and no response
lists keys of links the person cannot see. The sightings keep following "own samples only". The
URLs suggested by the analysis are stored by key when the file is analyzed.
**Limit:** a suggested URL from a sample analyzed before this item opens "Indicator not found" until
the sample is analyzed again.

### 167. URL and IPv6 in allowed, import, export, related and map
It includes IPv6 ranges in the allowlist. Today the imported URL becomes its domain.
✅ **Implemented:**
- **Allowlist:** accepts IPv6, as an address or a CIDR range compared over 128 bits, and an exact URL.
  A URL without an exact item inherits the host's permission, whether domain, IPv4 or IPv6. Allowing a URL does not
  release the domain.
- **Import:** the URL enters as a URL, to follow and to allow; before it became the domain, "(from
  a URL)". IPv6 enters through the format, including with MISP's `ip-dst` column, and through STIX
  (`ipv6-addr`). A line that is a whole link no longer goes through the `;` and `,` cut, which broke
  links with those signs in the query. Following refuses an internal IPv6, as it already refused IPv4.
- **Related:** the IP host of a link links by the IP, and no longer as a domain. A link cited in a
  report links the sample of that link, by key. A link with another query does not count as the same
  link, and keeps linking by the domain.
- **Map:** the URL and IPv6 nodes open the right card.

### 168. ELF
Sections, libraries, interpreter, suspicious symbols, RWX segments and packer, without a new dependency.
Together, `parsePe` gains an entropy budget and limited string reading.
✅ **Implemented** (`lib/elf-analysis.ts`, on the analysis thread):
- **Card:** an "Linux executable (ELF)" section with architecture (32 or 64 bits, endian), type (executable,
  PIE, library, object), loader, required libraries and imported functions that need attention
  (`ptrace`, `memfd_create`, `execve`...). It also shows sections with entropy, writable and
  executable segments, an executable stack and UPX.
- **Without a section table**, common in malware, the libraries come from the dynamic segment.
- **Limits:** up to 512 sections and 256 segments read, with extended numbering, a 64-bit offset
  above 2^53 treated as invalid and text read only up to 256 bytes.
- **PE:** the section entropy has a 64 MB budget; once the budget is used up, each section enters through
  a 64 KB sample. Before, 96 sections pointing to a 48 MB file took 13.4 s; the test
  now requires less than 3 s. The import text is also searched only within the limit, and no longer up to
  the end of the file.
- **Tested** with `/bin/ls`, `libc` and a real Go binary, besides the hostile builders.
**Limit:** symbols of an ELF without sections are not read, because counting the dynamic table ones requires the
hash table, which stays for later. The libraries appear anyway.

### 169. JAR and the type by the ZIP content
Today the type comes from the first 64 KB: JAR beats APK, and a manifest further ahead gives `zip`. Malicious APKs
mark members as encrypted to break tools, and the current ZIP reading gives up.

### 170. APK
Binary manifest (AXML): package, dangerous permissions, components, `debuggable`, native libraries
and certificates. Malware erases names in the manifest; the attributes are read through the resource map.

### 171. Analysis search index
Strings, imports, symbols, permissions, classes, YARA rules, the ClamAV signature and the email fields,
one row per term, with a trigram index. Today that data is not even stored. **Limits:** up to
1000 strings and 4096 imports per sample; the card warns when the index is partial.

### 172. Search in the analysis: route and screen

### 173. Index of the old samples and retention
Background re-analysis, only with the analysis queue empty, resuming from where it stopped, without triage nor
notices.

### 174. Capture queue
The API has no queue: the 90 s deadline runs while the request waits in the service, and the service keeps
visiting after the API gives up. With a few slow pages, the following ones fail on the card and are
visited anyway.

### 175. Automatic capture by the triage rule
Only with the domain and lookalike domain conditions, the only ones that match a link on arrival. It does not
capture a URL from the allowed ones or from the company domain, nor the same URL twice in 24 h; limit of 30
per hour. On the card, the author appears as "System (rule)".

### 176. Extraction service (7z and RAR)
The official `7zz` in its own container, without network, read-only, with memory, CPU and processes
limited. In the API it would read the API's secrets in `/proc`. The WebAssembly alternatives do not open a 7z
with a password or are behind the 7-Zip fixes.

### 177. Extract 7z and RAR into child samples
An asynchronous request, because it may go past the nginx time. The API treats the service as compromised:
it checks counts and bytes and cleans the names. The password is neither stored nor recorded.

### 178. Guest agent: client, simulator and scope
In PVE 9, running commands in the VM requires `VM.GuestAgent.Unrestricted`. Before each call, it checks the
label and the VM name, because the vmid is reused. The commands are fixed.

### 179. Collection of processes and files
A baseline when the agent responds, "Collect now" (up to 5 per session) and a last one when discarding.
Everything that comes from the VM was written by the attacker: the card marks "reported by the guest".

### 180. VM file as a child sample
Only at the analyst's request and by the artifact id, never by the path. It goes through the full analysis, and the
owner is the analyst.

### 181. Sandbox terms in the search, documentation and runbook on the real Proxmox
The simulator does not prove the collection. Until the runbook runs on a real Proxmox, it stays "tested only in
the simulator".
