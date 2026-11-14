# 🖥️ Interface in the style of HP Service Manager 9

> 🇧🇷 [Leia em português](interface-hpsm.pt-BR.md)

This guide describes how the DeepLook interface was built to look like the
**HP Service Manager 9 web client** and how to keep that look when creating or changing
screens. The general rule is **do not modernize**: high density, small font, gray gradients,
text instead of "pills", and a desktop-style structure with tabs.

> The app uses **React + Vite + @carbon/react**. Carbon provides the behavior of the
> controls (fields, selects, tables); the HPSM look comes from the `--dl-*` tokens and
> from the skin in `apps/web/src/styles/hpsm.scss`, which overrides what Carbon draws.

---

## 1. Screen structure

```
┌───────────────────────────────────────────────────────────────────────────┐
│ DeepLook                  Go to: [__________]        Ana Souza ▾ (Admin)  │  masthead
├──────────────────────┬────────────────────────────────────────────────────┤
│ Navigation           │ [Home Page ×] [Global History ×] [Sample ×]        │  document tabs
│  🏠 Home Page        ├────────────────────────────────────────────────────┤
│  ⊟ 📁 Samples        │ ⓘ Messages (errors, warnings, confirmations)       │  message bar
│     Global History   │ ┌─ Page title ─────────────────────────────────────┐│
│     My Uploads       │ │ [Back] [Refresh] | [Download sample]             ││  record toolbar
│     Submit Sample    │ │ ⊟ Section  Label: [field]   Label: [field]       ││  form
│  ⊟ 📁 Administration │ └──────────────────────────────────────────────────┘│
└──────────────────────┴────────────────────────────────────────────────────┘
```

| Part | Component | File |
|---|---|---|
| Shell (holds everything together) | `AppShell` | `components/AppShell.tsx` |
| Blue masthead | `HpsmTopBar` + `HpsmUserMenu` | `components/HpsmTopBar.tsx`, `components/HpsmUserMenu.tsx` |
| Tree navigator | `HpsmSidebar` | `components/HpsmSidebar.tsx` |
| Document tabs | `WorkspaceProvider` + `WorkspaceTabs` | `components/workspace.tsx` |
| Message bar | `HpsmMessageBar` + `HpsmMessage` | `components/messages.tsx` |

- **Masthead:** logo on the left; "Go to:" (label and field) centered on the bar,
  independent of the logo width and the name; on the right, "Name ▾ (Role)". The user's name
  opens a submenu (My account, Change password, Preferences, Sign out) — it is the only place
  for "Sign out". On mobile, the role "(Admin)" disappears and the name still opens the menu.
- **System Navigator:** always visible on desktop (it does not collapse); collapsed folders are
  saved in the user's preferences (`closedFolders`). Below
  `52rem` it becomes a drawer opened by the ☰ button. New items go into `ROOT_LEAVES`
  (loose at the top) or `TREE` (inside a folder) in `HpsmSidebar.tsx`; folders
  can be restricted (`access: 'triage' | 'admin'`) and leaves can have a counter
  (`count`) and a status dot (`tone`). The **Queues** folder (analysts/admins) shows
  Pending / In analysis / Completed with counters (`GET /api/entries/counts`). The highlight
  goes to the most specific leaf that matches the URL.
- **Document tabs:** each open screen becomes a tab with **×** (middle click
  also closes it). Limit of 10 tabs; the oldest one leaves first. A navigation with
  `state: { replaceTab: currentPathname }` replaces the record **in the same tab** (used by
  the Previous / Next of the sample).
- **Message bar:** all messages from the page appear stacked here, at the
  top of the work area, as in HPSM.

---

## 2. Tokens and typography

All visual values are in `apps/web/src/styles/_tokens.scss` (single source of truth).
Do not use loose colors or measures in components: create or reuse a token.

| Group | Main tokens | Value / use |
|---|---|---|
| Typography | `--dl-font-sans`, `--dl-font-size` | Tahoma/Arial, **12px** across the whole app |
| Controls | `--dl-control-h` | **24px** height for fields, selects and buttons |
| Grid (tables) | `--dl-grid-head-1/2`, `--dl-grid-head-border`, `--dl-grid-line` | gray gradient header, vertical dividers |
| Sections | `--dl-section-head-1/2`, `--dl-section-title`, `--dl-section-toggle-border` | light-blue header with title `#15428b` and a +/− box |
| Fields | `--dl-field-label-w`, `--dl-readonly-bg`, `--dl-readonly-border` | label column (9rem) and gray locked field |
| Buttons | `--dl-btn-*` | gray gradient; light-blue hover; `--dl-btn-primary-border` for the default action |
| Status | `--dl-status-green/red/orange/blue/gray` | dot next to the status text |
| Navigator | `--dl-sidebar-*`, `--dl-tree-*` | white background, selection `#dfe8f6`, dotted guide |
| Document tabs | `--dl-doctabs-*`, `--dl-doctab-*` | strip and tabs with gradient |
| Login | `--dl-auth-width`, `--dl-auth-label-w` | box width and label column |

Style files:

| File | Role |
|---|---|
| `styles/_tokens.scss` | `--dl-*` tokens |
| `styles/hpsm.scss` | skin of the logged-in app: Carbon tokens → HPSM palette and all the `hpsm-*`/`dl-*` components |
| `styles/auth.scss` | public pages (home, login, sign-up) and the `.dl-btn` button without Carbon |
| `styles/app.scss` | style entry point and shell layout |

---

## 3. Components

### Record toolbar — `components/HpsmToolbar.tsx`

The screen actions (Back, Save, Cancel…) go in a toolbar at the top of the screen, **above** the
page header (`PageHeader`), on every screen, with small icon + text buttons. **Do not** use large
buttons in the middle of the content. A tab's or section's toolbar goes inside it.

```tsx
<HpsmToolbar label="Sample actions">
  <HpsmToolbarButton label="Back" icon={IconArrowLeft} onClick={() => navigate(-1)} />
  <HpsmToolbarButton label="Refresh" icon={IconRefresh} onClick={reload} />
  <HpsmToolbarDivider />
  <HpsmToolbarButton label="Download sample" icon={IconDownload} href={url} disabled={!url} />
</HpsmToolbar>
```

Inside an `HpsmSection`, the toolbar sits at the top of the section body.

### Forms — `components/HpsmForm.tsx`

| Component | Use |
|---|---|
| `HpsmSection` | collapsible group (+/−) with a title |
| `HpsmForm` | field grid; `columns={2}` splits into two columns from 64rem |
| `HpsmField` | label on the left with `:` and the control beside it; `required` (asterisk), `wide` (full row), `top` (multiline), `help` (text below) |
| `HpsmFormActions` | form footer: buttons aligned to the control column (e.g. **Save** in Change password), besides the section bar |
| `HpsmReadonly` | locked value in a gray box; `multiline`, `mono`, `copyable={{ value, label }}` (copy button) |

```tsx
<HpsmSection title="Triage">
  <HpsmForm columns={2}>
    <HpsmField label="Status" htmlFor="triage-status">
      <Select id="triage-status" labelText="Status" hideLabel ...>...</Select>
    </HpsmField>
    <HpsmField label="Submitted by">
      <HpsmReadonly>{entry.owner.displayName}</HpsmReadonly>
    </HpsmField>
  </HpsmForm>
</HpsmSection>
```

**Validation:** `const check = useRequiredFields([{ id: 'report-summary', label: 'Summary',
ok: summary.length >= 3 }])`; on save, `if (!check.check()) return;`, show
`check.message` with `HpsmMessage` and pass `invalid={check.isInvalid('report-summary')}`
to the `HpsmField` — red label/border, message on the bar and focus on the first invalid field.
If the form stays on screen after saving (fields cleared), call `check.reset()`
so the highlight does not stay on the empty fields.

**API validation errors:** in the API, reply with `sendValidationError(reply,
parsed.error)` (`lib/validation.ts`): 400 with `details` per field, in Portuguese. On the
front end, declare the field with `api` (the name in `details`, if different from the `id`) and `value`, and
in the `catch` use `if (!check.fromApi(err)) setError(...)`:

```tsx
const check = useRequiredFields([
  { id: 'url-title', label: 'Title', ok: true, api: 'title', value: urlTitle },
]);
```

The cited field gets the highlight and the message "Fix the highlighted fields: Title
(minimum of 2 characters)." The highlight disappears when the value changes. In the
login/sign-up forms, `AuthField` accepts `invalid`.

> **Labels and accessibility:** the Carbon control receives `labelText` + `hideLabel`
> (the accessible name stays on the control) and the `HpsmField` receives the same `htmlFor`.
> The visible label gets `aria-hidden` so the screen reader does not read it twice.

### Lists — `components/EntriesTable.tsx` and `components/HpsmFilterBar.tsx`

- Compact grid (`size="xs"`), sortable header (sorting **on the server**,
  `sort`/`dir` parameters of `GET /api/entries`) and a footer
  "Showing records X to Y of N" with « ‹ Previous · Next ›".
- Filters in a fixed row above the list (`HpsmFilterBar` + `HpsmFilterItem`), with a
  **Clear** button. The list refreshes by itself (the search waits 300ms).
- Keyboard: only one row enters the Tab; ↑ ↓ Home End move the focus and Enter opens
  the sample (the focused row gets the selection highlight).
- Bulk update (analysts): selection column (Space checks the row) and the
  `EntriesBulkBar` bar ("N selected: Status / Verdict / Priority / Assignee / Resolution [Apply]") →
  `POST /api/entries/bulk`, with confirmation.
- Detail pane (`detailPane` preference, off by default): click/arrows
  select and show the summary below the grid (`EntryPreviewPane`); double click or
  Enter open the card.
- Opening a row stores the page sequence (`components/entryNav.ts`); the sample card
  shows **◀ Previous / Next ▶** and "Record N of M" in the toolbar.
- Empty list: the grid stays visible and the notice goes to the message bar
  (`<HpsmMessage kind="info">No samples found.</HpsmMessage>`).

### Text status — `components/tags.tsx`

Status, verdict, role and type are **text**, never the Carbon `Tag` ("pill"):

```tsx
<StatusText tone="green">Active</StatusText>   // green dot + text
<VerdictTag verdict={entry.verdict} />          // tones already mapped
<RoleTag role={user.role} />                    // plain text
```

Tones: `green`, `red`, `orange`, `blue`, `gray` and `none` (no dot).

### Messages and loading — `components/messages.tsx`

```tsx
{error && <HpsmMessage kind="error">{error}</HpsmMessage>}
{query.isLoading && <HpsmLoading text="Loading samples..." />}
```

- `HpsmMessage` (`error`, `warning`, `info`, `success`) is rendered through a portal in the
  shell's message bar. Outside the shell (login, console window) it appears in place.
  Use the plain text, without an "Error" title (the icon already says it).
- `HpsmLoading` is the "Loading…" box with the dot ring.

### Tabs — `components/HpsmTabs.tsx` and `components/workspace.tsx`

- **Internal** tabs of the page (Details / Analysis / Reports) use `HpsmTabs`. The active
  tab is kept in the URL (`?tab=`), so the browser and the menu can point straight to it,
  and the document tab reopens at the same point.
- To name the **document** tab (e.g. the sample title), call
  `useWorkspaceTitle(title)` in the page. If the title has live information (e.g.
  "12min · name" of the sandbox), pass the simple name in the 2nd argument
  (`titleOnLeave`): it is applied when the screen is unmounted. New routes need a default title in
  `routeTitle()` (`workspace.tsx`), otherwise no tab opens.

### File — `components/HpsmFileDrop.tsx`

`<HpsmFileDrop files={files} onChange={setFiles} multiple maxFiles={20} onLimit={…} />`
— an area "Drag the files here or [Select files]" and one line per file
(name, size, Remove), with the total when there is more than one. Without `multiple`, the choice
replaces the file. Used in place of Carbon's `FileUploader`. `formatFileSize()` comes from the
same file.

### Keyboard shortcuts — `components/shortcuts.tsx`

| Key | Action |
|---|---|
| `Ctrl+K` | focuses the "Go to:" of the masthead (ID, SHA-256 or text) |
| `/` | focuses the list search (outside text fields) |
| `Alt+N` | opens Submit Sample |
| `Alt+W` | closes the current document tab |
| `Ctrl+S` | saves the open form |
| `↑ ↓ Home End` + `Enter` | navigate and open samples in the grid |
| `?` (outside fields) / `F1` | opens the **Keyboard shortcuts** box (also in the user menu) |

For `Ctrl+S` to work on a new screen: `useSaveShortcut(save, !saving)` — and put
`title="Save (Ctrl+S)"` on the toolbar button.

**Single list:** every new shortcut goes into `SHORTCUT_GROUPS`
(`components/shortcutList.tsx`). The `HpsmShortcutsHelp` box (`?`/F1) and the
Tips on the Home Page (items with `tip: true`) come from it; `<ShortcutKeys keys={[['Ctrl', 'K']]} />`
draws the keys. With any `.hpsm-modal` open, the global shortcuts are disabled; F1 always gets
`preventDefault` (it does not open the browser's help).

### Copy — `components/CopyButton.tsx`

`<CopyButton value={code} label="key" />` — copy icon that confirms "Copied"
on the button itself. In locked fields, prefer `<HpsmReadonly copyable={{ value, label }}>`.

### Confirmation — `components/HpsmConfirm.tsx`

Destructive actions ask for confirmation in a box in the HPSM style (initial focus on
**No**, Esc cancels):

```tsx
const confirm = useConfirm();
if (await confirm({ title: 'Revoke key', message: '...', confirmLabel: 'Revoke', danger: true })) {
  await revokeKey(key);
}
```

The `ConfirmProvider` lives in `main.tsx`, so it also works outside the shell (console window).

To ask for a text (view name, rename), use `usePrompt` from the same file: it returns
the trimmed text or `null` (Cancel/Esc); the confirm button stays disabled with the
field empty.

```tsx
const prompt = usePrompt();
const name = await prompt({ title: 'Save view', label: 'Name', defaultValue: suggestion });
```

### Context menu — `components/HpsmContextMenu.tsx`

`<HpsmContextMenu x y label items={[{ label, icon?, action, disabled?, separated?, hint?, danger? }]}
onClose={(restoreFocus) => ...} />` — floating menu drawn like the user menu
(portal on `body`, does not leave the window). Arrows skip disabled items, Esc/Tab close it
returning the focus to whoever opened it, clicking outside closes it. Open it from `onContextMenu` (mouse
position) and with Shift+F10 / the Menu key (element position).

### "More" menu of the toolbar — `HpsmToolbarMenu` in `components/HpsmToolbar.tsx`

`<HpsmToolbarMenu label="More" items={[{ label, icon?, action, disabled?, separated? }]} />`
— "More ▾" button that opens the `HpsmContextMenu` right below it (keyboard: Enter, Space
or ↓ open it; Esc closes and returns to the button). Use it for less frequent record actions.

### Actions menu on a table row — `HpsmMenuButton` in `components/HpsmToolbar.tsx`

`<HpsmMenuButton label="Actions" menuLabel="Actions for Ana" className="cds--btn cds--btn--tertiary
cds--btn--sm dl-menu-button" caretClassName="dl-menu-button__caret" items={...} />` — the same menu
button as "More ▾", looking like the grid's small buttons. Use it when a row's actions don't fit on
one line (Administration > Users). On an item, `hint` becomes the tooltip (including why it is
disabled) and `danger` paints the text red, like the dangerous button it replaces; the
confirmation stays with whoever runs the action.

### Print card — `pages/EntryPrintPage.tsx`

Route `/entries/:id/imprimir` outside the shell, opened by "More ▾ > Print card…" with
`?auto=1`. Styles in `.dl-print*` (`hpsm.scss`, section 12i) with `@media print`. When adding data
to the card, never include anything from the isolated environment.

### Notifications — `lib/notifications.ts` (API) and `components/notifications.ts`

In the API, notify with `notify(tx, [{ userId, type, entryId, actorId, detail }])` inside
the same transaction as the event; it ignores the person themselves and repeated recipients. On the
front end, `useNotificationCount()` (shared counter), `useNotifications(limit,
unreadOnly)`, `useMarkRead()`, `notificationText(n)` and `notificationHref(n)`.
System notices (deadlines, `lib/sla-escalation.ts`) use `actorId: null`.

New notification type: classify it in `NOTIFICATION_TYPES` (`lib/notification-types.ts`: who
receives it and whether it can be muted) and give it a name in `NOTIFICATION_TYPE_LABELS`
(`components/notifications.ts`). Both are `Record`s, so the build flags what is missing.
`notify()` discards what the recipient muted before removing the repeated ones.

### Mentions — `components/MentionTextArea.tsx`

`<MentionTextArea id value onChange onMention />` in place of the `TextArea`: "@" opens the
list of people and inserts "@Name". Send the ids of the mentions that remain in the text and
use `renderMentions(text, event.toValue)` to highlight the names.

### Indicators — `components/iocs.ts` and `pages/IocPage.tsx`

`iocHref(kind, value)` builds the link to the card (in the URL, by key: `sha256Hex` from
`components/sha256.ts`, synchronous); `urlHostIoc(url)` gives the host as an indicator; `iocKindOf(value)` deduces the type of an
already normalized value; `shortIoc` shortens hashes for the grid; `looksLikeIoc(text)`
decides whether "Go to:" queries `/api/iocs/lookup`. To download something generated by the API,
use `downloadUrl(url)` (`components/entryExport.ts`), without the `download` attribute: the name
comes from the `Content-Disposition`.

### Deadline — `components/sla.tsx`

`<AgeText entry={entry} sla={sla} />` shows the age in the current status ("1 d 6 h") with the
deadline marker: nothing within the deadline, orange above `warnHours`, red above
`lateHours`, "—" for completed ones. The limits come from the API (`sla` in the response of the list and of the
card); pass `sla` to `EntriesTable` so the Age column gets the markers.

### Favorites — `components/favorites.ts`

`useFavorites()` returns `favorites` and the actions `addView(name, url)`, `pinEntry(id)`,
`rename`, `remove` and `move(id, -1 | 1)`; API errors (limit, repeated) arrive as an exception so the
screen can show them on the bar. `currentViewUrl(pathname, search)` builds the view URL
without the page; `suggestViewName(base, parts)` suggests the name. On the filter bar, just pass
`viewName` to `HpsmFilterBar` for **Save view** to appear.

### Unsaved changes — `components/useUnsavedChanges.ts`

Forms with typed content warn before you lose it (switching screen or internal tab, Back, closing the
document tab, reloading the window):

```tsx
const { allowNavigation } = useUnsavedChanges(Boolean(title || description));
// after saving successfully and before redirecting:
allowNavigation();
navigate(`/entries/${id}`);
```

It uses React Router's `useBlocker`, which only works with a *data router* — that is why
`main.tsx` uses `createBrowserRouter` with a `*` route that renders the `App`. Only one
form with the hook can be mounted at a time (a `useBlocker` limit).

**Sign out** in the user menu also respects the warning: the hook registers the forms
with pending changes (`hasUnsavedChanges()`), and the top bar asks before ending the
session. Once the discard is confirmed, `discardUnsavedChanges(fn)` frees the navigation
to the login without a second warning.

### List state in the URL — `components/useEntryListState.ts`

Search, filters, sorting and page of the lists live in the URL
(`?q=&status=&sort=&dir=&offset=`): the document tab reopens the list as it was and the
search can be shared by link. Use the hook in any new sample list.

### Page header — `components/PageHeader.tsx`

`<PageHeader title="..." subtitle="..." />` — strip with title and subtitle.

### Public pages — `components/AuthLayout.tsx` and `components/AuthField.tsx`

Login, sign-up and home use `PublicMasthead`, the `.dl-box` box with a header and
`PublicLegal`. `AuthLayout` accepts `altLink` (link to the other screen, below the box
on the right). The buttons are `.dl-btn` / `.dl-btn--primary` (no Carbon).

---

## 4. Carbon conventions and pitfalls


**Do this**

- Carbon buttons inside the app automatically become the gray HPSM button. The `kind`
  changes only details: `primary` = bold (default action), `ghost` = no frame,
  `danger*` = red text.
- Every message to the user goes through `HpsmMessage`; no `InlineNotification`.
- Font and heights come from the tokens; Carbon controls are already adjusted to 12px/24px
  inside `.dl-shell` and `.dl-console-window`.

**Avoid**

- Carbon `Tag` for status (use `StatusText`).
- Carbon `DataTable` for lists whose data changes (filter, pagination): it keeps the rows
  in internal state and syncs **one render later**, handing out ids that no longer
  exist (`entry` becomes `undefined` and the screen goes blank). `EntriesTable`
  renders the rows straight from the data. The Admin tables still use `DataTable`,
  but ignore old ids (`if (!u) return null`).
- Popovers and dashed "empty" boxes — they are not part of HPSM.

**Adjustments the skin makes to Carbon** (if something "goes back to Carbon", look here in
`hpsm.scss`):

| Carbon problem | Fix |
|---|---|
| `th[aria-sort]` zeroes the padding, forces 48px height and removes the border | dedicated rule for `th[aria-sort]` |
| button icon with `position: absolute` (sits on top of the text) | `position: static` and icon before the text |
| textarea `::placeholder` with fixed 14px | `font-size: inherit` |
| leftover `padding-block` on 24px fields (select text rises) | `padding-block: 0` |
| `Tile` and `p` with their own font (14–16px) | body font (12px) |

---

## 5. Front-end routes

| Route | Screen | Note |
|---|---|---|
| `/home`, `/login`, `/register` | public pages | only without a session |
| `/` | — | redirects to the home page set in the preferences |
| `/inicio` | Home Page | welcome; default after login |
| `/history` | Global History | |
| `/me` | My Uploads | the resolution for the submitter appears below the title |
| `/submit` | Submit Sample | Files / Link tabs |
| `/entries/:id` | Sample | `?tab=analise`, `?tab=relatorios`, `?tab=relacionadas`, `?tab=mapa`, `?tab=historico` |
| `/revisoes` | Reports to review (four eyes) | analysts only; opens the sample's Reports tab |
| `/painel` | Dashboard (indicators, daily chart, verdicts, workload) | `?dias=30\|90`; can be the home page |
| `/dominios-empresa` | Company domains (analysts see; admin registers) and variations seen | Detection folder |
| `/regras-triagem` | Triage rules (analysts): automatic tags and priority | Detection folder |
| `/avisos` | General notices (analysts): publish, list and end | Management folder; the strip appears at the top of all screens |
| `/atribuicao` | Automatic assignment (analysts): rules, groups and absences | Management folder |
| `/gerencial` | Management report (analysts) | `?de=AAAA-MM-DD&ate=AAAA-MM-DD`; `/gerencial/imprimir` for printing |
| `/inbox` | Inbox (notifications) | also at the browser root, with the counter |
| `/iocs/:tipo/:valor` | Indicator card (ipv4, domain, email, md5, sha1, sha256) | opened by "Go to:" and the IOC links |
| `/entries/:id/imprimir` | Print card (without the shell) | `?auto=1` opens printing on load |
| `/casos/:id/imprimir` | Print case (without the shell) | `?auto=1` opens printing on load |
| `/admin` | Administration | ADMIN only; `?tab=keys`, `tokens`, `templates`, `status`, `audit`, `trash` |
| `/user` | My Account | `?tab=senha`, `?tab=preferencias`, `?tab=tokens` |
| `/admin?tab=backup` | Backup (admin): generate the ZIP, follow, download and delete | also in the Administration folder |
| `/user/api` | API documentation: curl examples and the routes read from `openapi.json` | link in the API Tokens tab |
| `/sandbox/entry/:entryId/console` | console window | outside the shell |

---

## 6. My Account and preferences

### Endpoints

| Method | Route | Function |
|---|---|---|
| GET | `/api/auth/options` | public: `{ ldap }` (AD login on: the field accepts the network username) |
| GET | `/api/auth/me` | session user, including `preferences` (already filled with the defaults) |
| POST | `/api/auth/touch` | user activity: renews the session for `SESSION_IDLE_MINUTES` and returns `{ expiresAt }` (401 if already expired) |
| GET | `/api/auth/session` | `{ expiresAt }` of the current session, **without** renewing |
| PATCH | `/api/me/preferences` | partial update; unknown keys → 400 |
| GET | `/api/me/notification-types` | `{ types: [{ type, locked }] }`: notices the person can receive by role; `locked` cannot be muted (item 164) |
| POST | `/api/me/password` | `{ currentPassword, newPassword }`: checks the current one, requires the password policy (8+ characters, number and special character) and a different password, and **ends all sessions** of the user. On a mandatory change (password reset by the admin) it opens a new session and returns `{ ok, signedIn: true }` |
| POST | `/api/admin/users/:id/reset-password` | admin: generates a temporary password (returned once), ends the sessions and marks a **mandatory change**: until it is changed, the routes respond 403 `{ code: 'PASSWORD_CHANGE_REQUIRED' }` (including for API tokens), except the password change |

| GET | `/api/analysts` | active analysts/admins (Assignee select); analysts only |
| GET | `/api/entries/counts` | queue counters: `{ counts: { PENDING, IN_REVIEW, COMPLETED }, mine }` |
| GET | `/api/entries/:id/events` | sample history (History tab) |
| POST | `/api/entries/file` | file upload (multipart: `file`, `title?`, `description?`, `tags?`) → `{ entry, previous }` (`previous` = first sample with the same SHA-256) |
| POST | `/api/entries/zip` | `.zip` unpacked (multipart: `file`, `password?`, `description?`, `tags?`) → `{ created: [{ name, path, entry, previous }], skipped: [{ name, path, reason }] }`; up to 20 files; wrong password → 400 with `details.password` |
| GET | `/api/entries/:id/hex?offset=&length=` | analysts: file bytes for the hex viewer (`Range` in MinIO, blocks of up to 4 KB, up to 64 KB) |
| POST | `/api/entries/next` | analysts: "Take the next one" - assigns the oldest unassigned pending sample, sets In analysis and returns `{ entry: { id, title } }`; 404 if none |
| GET | `/api/yara/packs` | rule packs: origin, license, status and counts (analysts) |
| GET | `/api/yara/packs/:id/rules?q=` | rules of a pack, without the text, up to 200 (analysts) |
| GET | `/api/yara/rules/:id` | one rule with the text (analysts) |
| PATCH | `/api/admin/yara-packs/:id` | `{ enabled }`: turns on or off; turning on for the first time installs (admin, audited) |
| GET · PATCH | `/api/admin/yara-packs/updates` | status of the pack updates · `{ autoUpdate }` (admin, audited) |
| POST | `/api/admin/yara-packs/:id/check` | `{ apply }`: checks; responds `current`, `skipped`, `preview`, `applied` or `held` (admin) |
| POST | `/api/admin/yara-releases/:id/approve` · `dismiss` · `rollback` | approves or discards the held one; returns to the last applied one (admin) |
| GET · PATCH | `/api/admin/settings` | system settings `{ ownSamplesOnly }` (admin), audited |
| GET | `/api/me/sample-access` | `{ ownOnly }`: whether the screen should hide the Global History |
| POST | `/api/entries/bulk` | bulk update `{ ids (1–100), patch: { status?, verdict?, priority?, assigneeId?, resolution? } }` (analysts); the resolution follows the card's rules |
| GET | `/api/entries/export.csv` | filtered/sorted list in CSV (same parameters as the list, no pagination) |
| GET | `/api/me/updates` | the user's samples completed since the previous visit (Home Page) |
| GET | `/api/entries` | also accepts `age=warn\|late` (not completed for more than `SLA_WARN_HOURS`/`SLA_LATE_HOURS` in the status) and `sort=age`; `attack=T1566` (published report with the technique or sub-techniques); returns `sla: { warnHours, lateHours }` |
| GET | `/api/entries/counts` | includes `late` (Overdue queue) |
| POST | `/api/entries/:id/static-analysis` | re-analyzes the file (analysts); the analysis from the upload is in `entry.staticInfo` |
| POST | `/api/entries/:id/duplicate` | `{ of }` marks it as a duplicate of the main one (analysts); completes with its verdict |
| DELETE | `/api/entries/:id/duplicate` | undoes it and restores the previous status/verdict |
| POST | `/api/reports/:id/submit` · `/approve` · `/return` | report review: submit, approve (publishes) and return `{ note }`; the author does not review their own |
| GET | `/api/reports/review-queue` | reports in review by other analysts |
| PATCH | `/api/reports/:id` | edits (author or admin): `{ summary?, findings?, iocs?, verdict?, attackTechniques?, kbArticleIds?, status? }`; only what comes changes; if the content changed, the previous version is kept |
| POST | `/api/reports/:id/evidence` | evidence (multipart `file` + `caption`): PNG/JPEG/WebP by real type, up to 10 MB and 20 per report, metadata removed → `{ evidence, metadataRemoved }` |
| GET · PATCH · DELETE | `/api/evidence/:id` | the image (with `nosniff` and CSP `sandbox`; regular user only for published reports) · `{ caption }` · deletes in MinIO |
| GET | `/api/reports/:id/versions` | report versions (analysts), from the 1st to the current: `{ versions: [{ number, current, author, at, status, summary, findings, iocs, verdict, attackTechniques }] }` |
| POST | `/api/iocs/import/preview` | `{ target: 'watch' \| 'allow', text }` (CSV/list or STIX 2.1) → `{ format, items: [{ kind, value, where, fromUrl?, status }], invalid, repeated, counts, room }` |
| POST | `/api/iocs/import` | `{ target, items: [{ kind, value }], reason? }` → `{ added, rejected, exists, covered, limit }` (allowed: analysts, reason required) |
| POST | `/api/entries/:id/capture` | link page capture (analysts; 202, runs in the background; 409 if one is already running; 503 turned off) |
| GET | `/api/entries/:id/captures` | `{ captures: [{ id, status, url, finalUrl, title, httpStatus, redirects, certificate, blocked, htmlTruncated, error, createdAt, finishedAt, requestedBy }], enabled }` |
| GET | `/api/captures/:id/screenshot` · `/html` | screenshot (PNG) · HTML only as a text attachment |
| POST | `/api/entries/:id/extract-image` | disk image (ISO/FAT/VHD): extracts up to 50 files as child samples (analysts; 409 if already extracted; 410 purged) → `{ created, children, skipped }` |
| GET | `/api/entries/:id/children` | child samples (email attachments, extracted files): `{ children: [{ id, title, originalFilename, status, verdict }] }` |
| GET · POST · DELETE | `/api/company-domains[/:id]` | company domains: list `{ domains, seen: [{ domain, companyDomain, reason, label, detail, sources, total, entries }], max: 20 }` (analysts); add `{ domain }` (admin; normalizes URL/www; 409 repeated or above 20; goes into the allowlist and rescans samples) and delete (admin; removes only the item the registration put on the allowlist). `GET /api/entries/:id` brings `lookalikeHits` |
| GET · POST · PATCH · DELETE | `/api/triage-rules[/:id]` | triage rules (analysts): `{ name, condition, value?, tags, priority? }` (`LOOKALIKE`: optional value, the company domain) · `{ enabled }`; the list brings `label` ("link domain .top") |
| GET | `/api/broadcasts/active` | active general notices the person has not dismissed (everyone): `{ items: [{ id, text, level, expiresAt, createdBy, case }] }` |
| POST | `/api/broadcasts/:id/dismiss` | dismisses the notice for this person only |
| GET · POST | `/api/broadcasts` | analysts: last 30 days with `active` and `_count.dismissals` · publish `{ text, level, hours, caseId? }` (409 with 3 active) |
| POST | `/api/broadcasts/:id/end` | end now (analysts; 404 if already ended) |
| GET | `/api/assignment` | automatic assignment (analysts): `{ groups: [{ id, name, rules, members: [{ id, displayName, away, available, lastAssignedAt }] }], rules: [{ id, position, groupId, entryType, tag, priority, enabled, label, group }], analysts }` |
| POST · PATCH · DELETE | `/api/assignment/groups[/:id]` | `{ name }` · `{ name? , memberIds? }` · deletes (with its rules) |
| POST · PATCH · DELETE | `/api/assignment/rules[/:id]` | `{ groupId, entryType?, tag?, priority? }` · `{ enabled }` · deletes; `POST /rules/:id/move { direction: 'up' \| 'down' }` |
| PUT | `/api/assignment/away/:userId` | `{ away }`: the person themselves or an admin |
| GET | `/api/management?from=&to=&tz=&format=` | management report (analysts): `received`, `completed`, `timeToComplete` (`all`, `byPriority`: `{ n, avgHours, medianHours }`), `verdicts`, `techniques`, `cases`, `workload`; `format=csv` downloads the CSV |
| GET | `/api/dashboard?days=&tz=` | dashboard: `byStatus`, `byVerdict`, `open`, `period`, `daily` (days in the time zone), `workload` (analysts), `techniques` (most seen ATT&CK: `{ id, name, tactics, count }`) |
| GET | `/api/admin/status` | admin: `{ checkedAt, overall, checks: [{ id, name, level, summary, latencyMs?, details }] }` (ok/warn/error/off) |
| GET | `/api/admin/audit?action=&days=&q=&limit=&offset=` | admin: `{ total, items: [{ action, actor, targetUser, targetLabel, detail, ip, createdAt }] }`, most recent first |
| GET | `/api/admin/audit/export.csv` | admin: audit CSV with the same filters |
| GET | `/api/entries/:id/antivirus` | ClamAV: `{ enabled, pending, scan: { status, signature, error, engine, dbVersion, dbDate, scannedAt } }` (accepts token) |
| POST | `/api/entries/:id/antivirus` | analysts: scans again from MinIO (202); 410 if purged |
| GET/POST | `/api/cases` | analysts: cases `{ total, items: [{ id, code, title, status, assignee, entries, updatedAt }] }` (`status=active\|OPEN\|IN_PROGRESS\|CLOSED`, `assignee=me\|none\|id`, `q`); POST `{ title, description?, entryIds[] }` (at least one sample) |
| GET/PATCH | `/api/cases/:id` | case with samples (SHA-256/URL and published reports) and timeline; PATCH `{ title?, description?, status?, assigneeId? }` |
| GET | `/api/cases/:id/iocs` | IOCs of the case's samples, without repeats: `{ iocs: [{ kind, value, source, entries: [{ id, title, verdict }] }] }` |
| GET | `/api/cases/:id/iocs/export?format=` | case IOCs as an attachment: `csv`, `stix` (with the case `grouping`) or `misp` |
| POST/DELETE | `/api/cases/:id/entries` · `/api/cases/:id/entries/:entryId` | add `{ entryIds[] }` / remove (409 if it is the last one); `POST /api/cases/:id/comments { text, mentions? }` (mentions only of analysts; notifies mentioned people and the assignee); `GET /api/cases/counts`; `GET /api/entries/:id/cases` |
| POST | `/api/entries/file` (`.eml`) | email: stores `emailInfo` (headers, `auth`, `received`, `links`, `body`, `attachments[{ filename, mimeType, size, entryId?, skipped? }]`) and creates each attachment as a sample with `parentEntry`; `GET /api/entries/:id` brings `emailInfo` and `parentEntry` |
| GET | `/api/kb?q=&category=&limit=&offset=` | knowledge base (everyone): `{ total, items: [{ id, title, summary, category, tags, updatedAt, updatedBy, citations }] }` |
| GET | `/api/kb/:id` | article `{ ..., body, createdBy, canDelete, revisions: [{ createdAt, editor }], reports: [{ id, updatedAt, analyst, entry }] }` (published reports only) |
| POST/PATCH/DELETE | `/api/kb` · `/api/kb/:id` | analysts: `{ title, summary, category (MALWARE_FAMILY/SCAM/TECHNIQUE/PROCEDURE), tags[], body }`; 409 title in use; delete: author or admin. Reports accept `kbArticleIds` |
| GET | `/api/me/upload-quota` | upload quota `{ limit, used, remaining, resetAt }` (`limit` null = no limit); uploads above it return 429 `{ error, resetAt }` |
| GET | `/api/search?q=&type=&days=` | advanced search (Portuguese, accent-insensitive; quotes and `-`): `{ groups: { entries, reports, comments, kb, cases } }`, each `{ total, items }` with `snippet` (excerpt with `⟦ ⟧`); a regular user only sees published reports and does not see cases |
| GET/POST | `/api/allowlist` | analysts: allowlist `{ items: [{ id, kind, value, reason, createdBy }] }`; POST `{ kind, value, reason }` (normalizes; 400 on the field, 409 repeated) |
| DELETE | `/api/allowlist/:id` | removes from the list (audited) |
| POST | `/api/allowlist/filter` | `{ values }` → `{ allowed }`: suggestions covered by the list; `GET /api/iocs/:kind/:value` brings `allowed: { by, reason }` |
| POST | `/api/yara/rules/:id/retroscan` | analysts: retroactive YARA over the stored samples (202 `{ retroscan: { id, total, skipped } }`; 409 if one is already running) |
| GET | `/api/yara/retroscans` · `/api/yara/retroscans/:id` | last 10 `{ items: [{ ruleName, status, total, scanned, matched, failed, skipped, startedBy, ... }] }`; detail with `hits: [{ identifiers, entry }]` (up to 500) |
| POST | `/api/yara/retroscans/:id/cancel` | cancels the running scan (409 if not running) |
| GET/POST | `/api/team-views` | analysts: team views `{ views: [{ id, label, url, createdBy, count, canEdit }] }`; POST `{ label, url }` (only `/history?…`; 409 repeated or above 30) |
| PATCH/DELETE | `/api/team-views/:id` | rename `{ label }` / remove: whoever shared it or admin |
| GET | `/api/entries/compare?a=&b=` | analysts: `{ a, b, sameContent, lists: { iocs, yara, attack, urls, ips, emails, paths, registry, suspicious, imports, suspiciousImports, sections } }`, each list `{ common, onlyA, onlyB }` (up to 200); 400 same sample, 404 nonexistent |
| GET | `/api/attack` | embedded MITRE ATT&CK `{ version, tactics: [{ id, name }], techniques: [{ id, name, tactics }] }` (1-day cache) |
| GET/POST | `/api/yara/rules` | analysts: YARA rules `{ rules: [{ id, name, description, source, enabled, createdBy, updatedBy, updatedAt }] }`; POST `{ name, description?, source, enabled }` compiles with YARA-X first (400 with `details.source` = compiler output; 409 name in use) |
| PATCH/DELETE | `/api/yara/rules/:id` | analysts: edits (same body as POST) or only `{ enabled }` (turn on/off); deletes |
| POST | `/api/yara/validate` | analysts: `{ source }` → `{ ok, errors, warnings }` without saving |
| GET | `/api/entries/:id/yara` | `{ activeRules, pending, scan: { status (PENDING/CLEAN/MATCHED/ERROR), matches: [{ rule, identifier, tags, description, matches }], rulesCount, error, scannedAt } }` |
| POST | `/api/entries/:id/yara` | analysts: applies the active rules again (202); 409 no active rule, 410 if purged |
| GET | `/api/entries/:id/reputation` | external reputation `{ services, indicator, pending, results: [{ service, name, status, verdict, summary, link, checkedAt }] }` (accepts token) |
| POST | `/api/entries/:id/reputation` | analysts: checks again, ignoring the cache (202) |
| POST | `/api/auth/login/2fa` | second login step with 2FA `{ challenge, code }` (app or recovery code) → `{ user, recoveryRemaining }`; `POST /api/auth/login` for someone with 2FA returns `{ twoFactorRequired: true, challenge }` |
| GET | `/api/me/2fa` | `{ enabled, enabledAt, recoveryRemaining }` |
| POST | `/api/me/2fa/setup` · `/enable { code }` | enable: pending secret `{ secret, otpauthUri, qrSvg }` and confirmation → `{ recoveryCodes }` (once) |
| POST | `/api/me/2fa/recovery-codes` · `/disable` | `{ password, code }`: new codes (invalidates the previous ones) or disable |
| POST | `/api/admin/users/:id/disable-2fa` | admin: disables someone's 2FA (lost phone) |
| POST/DELETE | `/api/iocs/:kind/:value/watch` | follow / stop following an indicator (IOC alerts); `GET /api/iocs/:kind/:value` brings `watching` |
| GET | `/api/me/watches` | indicators the person follows |
| GET | `/api/me/sessions` | open sessions of the account `{ sessions: [{ handle, device, userAgent, ip, createdAt, lastSeenAt, current }] }` (`handle` = hash, never the id) |
| DELETE | `/api/me/sessions/:handle` · POST `/api/me/sessions/revoke-others` | ends one session (not the current one) or all the others |
| GET/POST | `/api/me/api-tokens` | the user's API tokens (`{ apiAccess, maxDays, tokens }`); POST `{ name, expiresInDays }` → `{ token, secret }` (secret only here); 403 without enablement, 409 with 10 active |
| DELETE | `/api/me/api-tokens/:id` | revokes one of your own tokens |
| GET · POST | `/api/admin/backups` | backups (admin): list (expired ones expire immediately) `{ items: [{ id, status, includeSamples, step, progress, size, manifest, error, expiresAt }], retentionDays }`; generate `{ includeSamples, password }` or `{ includeSamples, noPassword: true }` → 202 (400 without choosing, 409 with one in progress) |
| GET · DELETE | `/api/admin/backups/:id/download` · `/api/admin/backups/:id` | download the ZIP (admin with session; 404 if not ready; audited) · delete (409 in progress) |
| GET | `/api/openapi.json` | OpenAPI 3.1 specification of the routes that accept a token (session or token); generated from the zod schemas (`lib/openapi.ts`), and a test checks it matches `ALLOWED_ROUTES` |
| GET | `/api/admin/api-tokens?status=active\|all` | admin: everyone's tokens with the user |
| DELETE | `/api/admin/api-tokens/:id` | admin: revokes a token |
| PATCH | `/api/admin/users/:id` `{ apiAccess }` | admin: enables or withdraws API access (withdrawing revokes the active tokens) |
| POST | `/api/entries/:id/trash` | admin: moves to the trash (disappears from all screens); 409 with an active sandbox |
| GET | `/api/admin/trash?q=&limit=&offset=` | admin: samples in the trash `{ total, items: [{ …, owner, deletedBy, deletedAt, filePurgedAt, _count }] }` |
| POST | `/api/admin/trash/:id/restore` | admin: restores (back on all screens) |
| DELETE | `/api/admin/trash/:id` | admin: deletes for good (file in MinIO + card and everything linked to it) |
| GET | `/api/report-templates` | report templates (analysts and admin) |
| POST/PATCH/DELETE | `/api/report-templates[/:id]` | admin: `{ name, summary, findings?, iocs?, verdict }`; repeated name → 409 |
| GET | `/api/me/notifications?limit=&unread=1` | inbox `{ items, unread }` (ASSIGNED, COMPLETED, MENTION, COMMENT, REPORT_APPROVED, REPORT_RETURNED, IOC_SEEN, SLA_WARN, SLA_LATE, RESOLUTION, CASE_MENTION, CASE_COMMENT, CASE_ENTRY_ADDED, CASE_ENTRY_REMOVED, CASE_ASSIGNED; in deadline notices `actor` is null and `detail` is the deadline hours; `entry.resolution` is the current resolution; in case notices `entry` is null and `case` brings `{ id, code, title }`) |
| GET | `/api/me/notifications/count` | `{ unread }` (bell, every minute) |
| POST | `/api/me/notifications/read` | `{ ids? }` marks as read (without `ids`: all) |
| GET | `/api/users/mentionable?q=&analysts=1` | active people for "@" (name, no email; up to 8); `analysts=1` in case comments |
| GET | `/api/iocs/lookup?q=` | text → recognized indicator `{ ioc: { kind, value } }` or 404 (the host before the URL) |
| POST | `/api/iocs/resolve` | `{ text }` → `{ ioc }`, like the lookup, but in the body; a link on its own becomes a URL, stored by key. Used by "Go to:" (item 166) |
| GET | `/api/iocs/:kind/:value` | card: `{ ioc, items: [{ entry, sightings }], total, firstSeen, lastSeen }`. URL: `/api/iocs/url/<SHA-256 of the link>`; unknown key → 404 |
| GET | `/api/entries/:id/iocs` | sample indicators (published reports + file/URL/domain) |
| GET | `/api/entries/:id/iocs/export?format=` | `csv`, `stix` (STIX 2.1) or `misp` (JSON event), as an attachment |
| POST | `/api/entries/:id/comments` | new update `{ text, mentions? }` (1–4000, plain text) → `COMMENT` event in the history; 10/min per session |
| GET | `/api/entries/:id/related` | Related tab: `{ items: [{ entry, reasons, score }], total, limit: 50 }`; reasons `SAME_SHA256`, `SAME_HOST`, `SAME_BASE_DOMAIN`, `SHARED_TAGS`, `SHARED_IOCS` (IOCs of published reports, `lib/iocs.ts`), `SIMILAR` (similar file by TLSH, `detail` = similarity in %); `?similarity=` 50–99 (default 70) |
| GET | `/api/entries/:id/graph` · `/api/cases/:id/graph` | relationship map: `{ center, nodes: [{ id, kind: ENTRY\|IOC\|CASE, label, … }], edges: [{ from, to, label }], hidden: { entries, iocs, cases } }`; sample up to 12 samples, 12 indicators and 8 cases (cases only for analysts); case up to 20 samples and 15 indicators (shared ones first; analysts only); without the allowed indicators |
| GET | `/api/me/favorites` | the user's Favorites folder, in order (`entry` summarized for pinned samples) |
| POST | `/api/me/favorites` | `{ kind: 'VIEW', label, url }` or `{ kind: 'ENTRY', entryId, label? }`; up to 30; repeated → 409 |
| PATCH | `/api/me/favorites/:id` | `{ label }` (1–60 characters) |
| PUT | `/api/me/favorites/order` | `{ ids }`: all the user's ids in the new order |
| DELETE | `/api/me/favorites/:id` | removes the favorite |

`GET /api/entries` also accepts `assignee=me|none|<id>`, `submittedFrom`, `completedFrom` (ISO; Dashboard links) and `sort=assignee`;
`PATCH /api/entries/:id` accepts `assigneeId` (analyst id or `null`) and `resolution`
(resolution for the submitter, analysts; up to 500 characters, empty or `null` removes it).

`POST /api/auth/login` and `POST /api/me/password` accept **5 attempts every 5
minutes** (per email and per session, respectively); after that they respond 429.

After changing the password, the front end clears the session and takes the user to the login with the notice
"Password changed. Sign in again with the new password.".

**Inactivity session:** expires after `SESSION_IDLE_MINUTES` (default 30) without
activity, with an absolute ceiling of `SESSION_TTL_HOURS`. The `SessionWatcher` renews with
activity (at most 1x/min), warns 2 min before with the "Session expiring" box
(countdown, **[Stay signed in] [Sign out]**) and, on expiry, returns to the login with
"Your session expired due to inactivity. Sign in again.".

### Preferences

Stored in the JSON column `User.preferences` (migration
`20261021000000_add_user_preferences`).

| Key | Values (default in bold) | Where it is applied |
|---|---|---|
| `startPage` | **`welcome`** · `dashboard` · `history` · `mine` | destination after login and at the root `/` |
| `pageSize` | 25 · **50** · 100 | Global History and My Uploads |
| `restoreTabs` | **`true`** · `false` | reopens the document tabs of the previous session on sign-in (per-user copy in `localStorage`) |
| `detailPane` | `true` · **`false`** | detail pane below the lists (click selects, double click opens) |
| `closedFolders` | **`[]`** | folders collapsed in the Navigator; saved by the Navigator itself, outside the Preferences tab |
| `mutedNotifications` | **`[]`** | muted notices (Notifications tab); unknown or locked type is dropped when read and written, and `notify()` checks again |

### How to add a preference

1. **API** — `apps/api/src/lib/preferences.ts`: add the key to
   `PreferencesSchema` and to `DEFAULT_PREFERENCES`. Invalid or missing saved values
   fall back to the default (validation per key), so there is no migration.
2. **Web** — `apps/web/src/api/types.ts` (`Preferences`) and
   `apps/web/src/auth/preferences.ts` (`DEFAULT_PREFERENCES`, with the same value).
3. **Form** — a new `HpsmField` in the Preferences tab of
   `apps/web/src/pages/UserPage.tsx`.
4. **Application** — read with `const { preferences } = useAuth()`. To write from outside the
   account page, use `updatePreferences({ key: value })` (updates immediately and
   reverts if the API refuses).

---

## 7. Visual verification (Playwright)

The scripts in `scripts/ui-playwright/` bring up the front-end **build** in a Chromium
(Playwright in Docker) and answer `/api/*` with sample data — they need no database
or running API.

| Script | What it does |
|---|---|
| `screens.mjs` | screenshot of all screens in `out/` and measurement of the list header |
| `filters.mjs` | changes filters, search and Clear; checks the filters survive a page reload; fails if the screen goes blank or the count is wrong |
| `force-password.mjs` | mandatory change: login with the temporary password opens only "Set new password" (no shell, no other calls), another route stays on it, validations, same as the refused temporary one, change goes straight in, reload asks for the temporary one, Sign out and the pending item in the Users tab |
| `logout-unsaved.mjs` | Sign out with unsaved changes: asks, Keep editing keeps the screen and the text, Sign out without a second warning, no change (or undone) signs out directly |
| `account.mjs` | login → Home Page → user menu → preferences applied → password change (errors and success, footer Save button aligned to the fields) → new login |
| `actions.mjs` | confirmation dialog (Esc/No cancel), reset password, "Record updated." on triage and duplicate sample warning |
| `unsaved.mjs` | unsaved-changes warning: browser, closing the document tab (cancel keeps the tab), the report's internal tab and preferences |
| `copy-keyboard.mjs` | copy buttons (checks the clipboard) and a grid navigable by keyboard |
| `queues-nav.mjs` | queues with counters (and update after triage) and Previous / Next in the same document tab |
| `assign-history.mjs` | Take analysis, assignee change, "Assigned to me" queue, Assignee column/filter and History tab (includes sandbox failure) |
| `session-idle.mjs` | inactivity session (fake clock): renewal 1x/min, warning at 28 min with countdown, Stay/Sign out, renewal from another window and expiry with return to login |
| `more-print.mjs` | "More ▾" menu (mouse, keyboard, Esc returns focus), copy link, new window, export Markdown (and disabled without a report) and the printed card (outside the shell, automatic printing, "Printed by / on", sections, no sandbox data, toolbar hidden on paper, A4 PDF) |
| `sla.mjs` | deadline: Age column (format, orange/red, "—", tip, screen reader), sort by age, Deadline filter, Overdue queue (N), "In status since" on the card and age reset when the status changes |
| `comments.mjs` | updates in the History tab: validation, Ctrl+S, plain text with line breaks, note background, "Only updates", API error, unsaved warning; report highlight cleared after saving |
| `report-review.mjs` | report review: queue with counter, statuses and actions, return with a comment, return warning, submit, approve, "On save" with and without mandatory review, regular user only sees published ones, notification |
| `static-analysis.mjs` | static analysis: disguised-executable warning, real type, entropy, PE (packer, suspicious functions, sections, imports), strings by category, suggested IOCs (card and "Insert" without duplicating), "Analyze now", printed card |
| `dashboard.mjs` | dashboard: indicators and links, time zone sent, chart (legend, columns, tip not covering columns, table), verdicts, workload and link per analyst, period label in the list, period in the URL, user scope, home-page preference |
| `two-factor.mjs` | 2FA: My Account tab (disabled, enable with QR and key, incomplete/wrong code, recovery codes with Download), two-step login (wrong code, Back, correct one, recovery takes you to the tab with the warning), generate new codes and disable (password + code, confirmation) and admin Disable 2FA |
| `antivirus.mjs` | antivirus: scanning → infected (top and section, engine and database), single query, Scan again, clean without an alert, failure with reason, no scan ("Scan now", without querying in a loop), user without a button, link and ClamAV off without a section |
| `reputation.mjs` | external reputation: checking and automatic update, summary at the top (malicious in N of M; no alerts on failure), indicator note, services in order with colors and summary, safe external link, Check again only for analysts, section hidden without a service |
| `api-tokens.mjs` | API tokens: My Account tab only with enablement, Enable/Withdraw API in the Users tab (column, confirmation), generate (validation, secret once, Copy, clean notice), revoke, Administration tab (active/all, last use with IP, revoke) and the navigator |
| `retention-trash.mjs` | retention and trash: purged card (summary, Storage, Download disabled, static analysis and sandbox unavailable, history), "Move to trash" only for admin with confirmation, tab replaced by the Trash, search, Restore, Delete permanently and the navigator |
| `admin-audit.mjs` | audit: tab via the navigator, columns, anonymous and colors, pagination, action/period/search filters, Export CSV with the same filters, empty list and Clear |
| `admin-status.mjs` | system status: tab via the navigator, labels and colors by situation, summary/time/details, failed line highlighted, general notice and Refresh |
| `duplicates.mjs` | duplicates: box with suggestions and focus, invalid ID (error and focus), Esc, mark (summary, history, grid mark, section in the main one), undo with confirmation, hidden for regular users |
| `report-templates.mjs` | templates: tab via the navigator, validation, create (Ctrl+S), edit, repeated name from the API on the field, delete with confirmation; Template field in New report (fills in, verdict, asks before overwriting) |
| `notifications.mjs` | inbox: counter on the bell and in the browser, panel (phrases, focus, keyboard, opening marks as read, mark all), page with filter and keyboard; mentions (list, Esc, Enter/Tab, new line, ids sent, highlight in the history) |
| `ioc-url.mjs` | URL card: link pasted into "Go to:" goes in the body and opens the card by key, without the link in any request; title and host; follow and stop following by key; My Account opens the same card; unknown key |
| `iocs.mjs` | indicators: section in the Reports tab, card (title, summary, where it appears, document tab, keyboard), empty/invalid card, "Go to:" with disarmed IOC/IP/private IP/text, links in Related and CSV/STIX/MISP export |
| `related.mjs` | Related tab: total in the label, Reason column (several reasons, singular/plural, shared IOCs with shortened hash, "+N" and the list in the tip), footer with the limit, arrows + Enter, Previous/Next through the related ones, empty list |
| `favorites.mjs` | Favorites: Save view (suggested name, without the page, repeated, limit of 30), Pin/Unpin, open and highlight via the navigator, context menu (move, rename), Shift+F10, F2, Delete and "×" |
| `shortcuts-help.mjs` | shortcut help: `?` (text inside fields), F1 (anywhere, without the browser help), Esc/Close, focus returned, user menu and Tips from the same list |
| `validation-api.mjs` | Admin key form (validation, Ctrl+S, numbers sent) and API per-field errors in key, URL submission, report, update, password change and sign-up (highlight, message, focus, disappears when corrected) |
| `validation.mjs` | validation: red highlight (color checked, also with focus), message, focus on the first invalid field and highlight that disappears when corrected |
| `api-down.mjs` | API down or starting: nginx returns 502 in HTML and the login shows "The API did not respond (error 502)…" instead of the JSON error; with the API back, it signs in |
| `cases.mjs` | cases: folder with counters, new case from the card (short title, warning, top), marked into an existing case, list and active leaf, screen (Ctrl+S, add by link, remove with confirmation, comment, timeline), last sample cannot leave, regular user without access |
| `email.mjs` | email: headers, Reply-To from another domain, SPF/DKIM/DMARC with colors, path in order, links as text only, body without HTML, attachments (link and ignored), suggested IOCs with links and domains, "Attachment of" in the child |
| `kb.mjs` | knowledge base: navigator, new article (required fields, preview: title, emphasis, list, bare URL without link, only http(s)/internal, HTML as text), Ctrl+S, reading and tab, edit (PATCH, changes), search and category, citations, "Go to:" by title and `kb:`, report field and links, delete, regular user only reads |
| `quota.mjs` | upload quota: analyst without a warning, "N uploads left" (and singular), 429 from the API, exhausted with local time and disabled button |
| `team-views.mjs` | team views: folder with counter and author, no menu for those who cannot, open and highlight, Share view (suggested name, sending, notice), repeated, rename from the menu, remove with Delete and confirmation, no button outside Global History, regular user without folder and without query |
| `compare.mjs` | compare: "Compare the 2" only with two checked, side by side (differences highlighted, empty lines hidden, link), lists with only items (counts, IOC type), swap sides, same content, "Compare with…" from the card (same sample refused, ID), nonexistent, no parameters, regular user without access |
| `attack.mjs` | ATT&CK: top of the card and report with links, report field (search by name and code, arrows + Enter, click, ATT&CK order, ×, Backspace, submission), link → History filtered, filter (change, incomplete code, erase, Clear), tag in My Uploads, Dashboard panel (proportional bars, link, empty) |
| `document.mjs` | document analysis: top warning with high risk, section with risk, colored alerts, links as text only, embedded object, macro (runs on open, suspicious, "View code" as text), clean document, non-document without section |
| `similar.mjs` | similar files (TLSH): reason with the %, similarity filter (goes to the API, empty list keeps the filter, Clear returns to 70%), tab counter in the default, TLSH "T1…" on the card with Copy, "Not computable" and "Computing…" |
| `sla-escalation.mjs` | deadline escalation: alert/overdue notices on the bell panel (without excerpt, opens the card) and on the Inbox page; history with author System, deadline and priority, priority raised "due to overdue" |
| `case-export.mjs` | case export: Indicators section from the samples (links, URL as text), Export menu (Markdown with data, samples, reports, indicators, techniques and timeline; IOCs CSV/STIX via the API), Print (outside the shell, automatic, sections, PDF), case without indicators |
| `report-versions.mjs` | report versions: Edit (filled, Cancel, mandatory summary, Ctrl+S saves the edit and does not create another), Versions (N) with the difference (+/−, added line, verdict, ATT&CK), identical versions, hide, no Edit with mandatory review, regular user without actions |
| `evidence.mjs` | evidence: thumbnails and captions, enlarged (arrows, Esc, focus back), upload with caption, SVG refused with reason, caption and deletion, images on the printed card, mandatory review and regular users only see |
| `management.mjs` | management report: Management folder, 30-day default with the time zone, indicators, time by priority (days above 48 h), workload per analyst, previous month and free date in the URL, CSV, automatic printing with the period, regular user without access |
| `ioc-import.mjs` | import indicators: via My Account (follow) and allowed ones, focus, preview with summary, status and invalid, imports only the new ones, file, read error, Esc, reason required for allowed |
| `assignment.mjs` | automatic assignment: Management folder, rules (order, disabled one deleted, move down, turn on, include without group/with fields, delete), groups (missing marked, empty group, members, create, delete with warning), availability (admin and analyst), history "automatic: group…", regular user without access |
| `capture.mjs` | page capture: section only on links, capture (in progress → completed by query), screenshot, final address as text, redirects, certificate, blocked, HTML only to download, failure with reason, previous ones, history, turned off, regular user only sees |
| `script.mjs` | script analysis: top warning, section with language and risk, findings with the reason and the layer, URL as text only, decoded layer as plain text (HTML not executed), hide, benign without a warning, file without script without a section |
| `decoder.mjs` | decoder: Ctrl+Shift+D (empty and with selection), More menu, focus, PowerShell -EncodedCommand, suggestions, hex + XOR, error marked on the step, Base64 + gzip, Hex tab, Copy, result as text, Esc, script layer, shortcut in the list |
| `disk.mjs` | shortcut and disk image: warning, .lnk section (plain text, Copy the command, minimized window, machine/MAC, alerts), image (format, label, hidden, alerts), extract with confirmation, rows linked to the children, VHDX not listed, "Extracted from", regular user without extracting |
| `triage-rules.mjs` | triage rules: Detection folder, list (condition, tags, priority, disabled one deleted), value only when the condition asks for it, validation, add, turn on, delete with warning, rule history, regular user without access |
| `smoke.mjs` | quick test against the real API (`npm run test:smoke`, outside `run.ps1`): first access, upload with analysis, card tabs, bulk triage checked in the API, admin screens, sign-up with key, regular-user screens and those he cannot open, another person's sample, sign out; fails on unexpected API error, console error or CSP |
| `long-names.mjs` | long name and narrow screen: 390 px without sideways scrolling (admin and regular user), active tab in view without moving the page, many tabs, 200-character name without spaces in the list (columns visible, two lines, full name in the `title`) and on the card |
| `upload-feedback.mjs` | upload: real limit in the help, file larger than the limit refused without calling the API (name in the notice), network drop in Portuguese with the file kept, 413 and 503 with the API message |
| `navigation-a11y.mjs` | browser tab title (screen, sample, on leaving), first Tab is "Skip to content" and leads to the content, mobile menu (state on the button, focus enters, Esc closes and returns focus, no focus when closed) |
| `sidebar-folders.mjs` | Navigator folders: collapse and open save once per click sequence, return after reload and in a new session, Save and Restore defaults in Preferences do not touch them, failure to save does not interfere |
| `plain-language.mjs` | regular user: plain-language status on the card (by status and verdict, with a notice only for the submitter, resolution in place when there is one), "File" collapsed, "Clicked or opened, what now?" without shortcuts; analyst without changes; empty list different from a filter with no results; Enter submits and does not break the description |
| `own-samples.mjs` | sample restriction: Settings tab, confirmation when turning on and off, cancel changes nothing, regular user without Global History in the menu and on the Home Page, address leads to My Uploads, analyst without change, regular user without access to the setting |
| `yara-packs.mjs` | rule packs: Settings with license, author and source, confirmation on enable, YARA Rules screen with the list, search, reading as text, disable, delete, apply to samples, no editing, analyst cannot enable; card with the author and the pack |
| `yara-updates.mjs` | pack updates: turn on and off, check (up to date, preview with apply, apply after confirmation), last check failure, held with reasons, approve, discard, roll back, notice that opens Settings |
| `sample-access.mjs` | sample access: analyst downloads and sees the email; regular user without "Download sample" on someone else's and only with the name (card and print), downloads their own; "Sample downloaded" filter in the audit |
| `ldap-login.mjs` | AD login: without AD same as before; with AD, "Email or network username" (text field) and explanation, sends the network username; AD account without password change; Administration with the "AD" marking and no password reset |
| `notification-prefs.mjs` | Notifications tab: types by role (admin all, regular user only theirs), locked ones checked and disabled with "(always arrives)", uncheck and save writes the list, saving Preferences does not touch it |
| `backup.mjs` | backup: Administration folder, list (ready, failure with reason, expired deleted, malware marked), generate with samples with confirmation, progress until ready, one at a time, Download, delete with confirmation |
| `api-docs.mjs` | API documentation: link in the Tokens tab, curl examples with the address and Copy, routes from the specification (method, path, fields with type and required, responses), download `openapi.json`, nothing that calls the API, notice without enabled access |
| `lookalike.mjs` | lookalike domains: notice on the card (domain, reason, where, plain text), no findings without a notice, Detection folder, variations seen (reason, where, samples with verdict and "+N"), add (required, API error on the field, Enter), delete with confirmation, analyst only sees, regular user without the screen |
| `relation-map.mjs` | relationship map: Map tab, nodes by type, color by verdict, link label, "+N", description for screen readers, equivalent list (groups, reasons, links), Expand by keyboard without changing what was there, click opens indicator/card, empty map, case map, regular user |
| `case-notifications.mjs` | mentions and notices in cases: "@" only with analysts, insert, send only those who remain in the text, mention highlighted in the timeline, Inbox (mention, comment, added, removed, assignment, "Sample or case" column), opening leads to the case, bell |
| `resolution.mjs` | resolution for the submitter: templates that add up, counter, unsaved change, trimmed save, highlight at the top (color by verdict, plain text), history, remove, My Uploads, inbox and bell (resolution and completed notice), submitter sees without the field |
| `broadcasts.mjs` | general notices: strip (alert first, case, author, validity), dismiss only that one, Home Page, Management folder, list with dismissals, required text, publish, limit of 3, end with confirmation, regular user sees the strip without management |
| `search.mjs` | search: navigator, minimum characters, term in the URL, groups with count, highlighted excerpt without HTML, links, "See all", period, nothing found, "Go to:" with free text, regular user without Cases |
| `allowlist.mjs` | allowed indicators: navigator, required fields, invalid range with hint, Ctrl+S, repeated, card marked with the reason, suggested IOCs without the allowed ones (count of hidden), remove with confirmation, regular user without access |
| `yara-retro.mjs` | retroactive YARA: confirmation, warning with the total, progress that updates by itself (bar, unreadable, above the limit), hits with link and identifiers, buttons disabled during the scan, cancel, completed without hits |
| `yara.mjs` | YARA rules: item only for analysts in the navigator, required fields, Validate with error (compiler box with the line), save refused with the field highlighted, validate ok, Ctrl+S, name in use, edit (PATCH), disable (only `enabled`), delete with confirmation; card scanning → hits (table and top), Scan again, no rules without a section; regular user redirected |
| `ioc-watch.mjs` | IOC alerts: Follow/Stop following on the indicator card, Indicators tab in My Account (link, stop following) and notification with text and link to the Reports tab |
| `sessions.mjs` | sessions: tab in My Account, current one marked without action, User-Agent in the tip, end one (confirmation with device and IP), end the others and button disabled without others |
| `priority.mjs` | priority: column and deadline by priority (P1 5 h overdue, P3 5 h within the deadline, tip), filter, sorting (most urgent first), bulk update, card (summary, triage with the deadline) and history |
| `hex-viewer.mjs` | hex viewer: loads on demand, line offset/hex/text, MZ header highlighted, Show more to the end, purged, link and regular user without the section |
| `take-next.mjs` | "Take the next one": button in the Pending queue and link on the Home Page open the picked card; empty queue warns and stays on the list; regular user without the button |
| `password-policy.mjs` | password policy: rule on sign-up and Change password (bar before sending), validity on the Password tab (and "no expiry" for admin), "Your password expires in N days" notice at the top (and "today") with link, "password expired" in the Users tab and the expired-password screen with the reason and the rule |
| `topbar-center.mjs` | "Go to:" centered in the masthead at 1440/1024/900 px (horizontal center, middle of the height, not touching the logo or the user) and outside the masthead on a narrow screen |
| `quick-search.mjs` | "Go to:" of the masthead: Ctrl+K, SHA-256 opens the sample, unknown hash and text open the filtered list |
| `bulk-update.mjs` | bulk update: selection, bar, confirmation, result, cleared when filtering, Space/Enter and regular user without the column |
| `detail-pane.mjs` | detail pane: when off, click opens; when on, selection, arrows, double click, Enter and "Open sample" |
| `news-shortcuts-export.mjs` | news on the Home Page, shortcuts (`/`, Alt+N, Alt+W, Ctrl+S) and CSV download with the filters |
| `batch-upload.mjs` | batch upload: sum without repeating, total, Remove, limit of 20, title disappears, one upload per file with description and tags, result (failure, "already submitted before", link), `.zip` with Unpack, wrong password on the field and result with ignored items |
| `filedrop-sandbox.mjs` | drag and drop the file (via `DataTransfer`) and sandbox deadline: tab with "Nmin", warning in the last 5 min and "Extend deadline" |
| `mock-api.mjs` | simulated API and `dist` server used by the three |

```powershell
cd apps/web; npm run build; cd ../..
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
# only some scripts:
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1 -Scripts filters,account
```

Requires Docker running (image `mcr.microsoft.com/playwright:v1.64.1-noble`).
The script exits with an error if any check fails; screenshots are kept in
`scripts/ui-playwright/out/` (ignored by git).

---

## 8. Next improvements

Prioritized UX/usability ideas are in [`docs/ux-backlog.md`](ux-backlog.md):
the first batch (1–18) is implemented; the second (19–30, HPSM 9 patterns such as the
detail pane, bulk update and Favorites) is pending.
