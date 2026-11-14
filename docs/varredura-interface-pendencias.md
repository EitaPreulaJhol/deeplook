# 🧹 Visual sweep follow-ups

> 🇧🇷 [Ler em português](varredura-interface-pendencias.pt-BR.md)

What remains after the [November 2026 visual sweep](varredura-interface.md): problems seen and not
fixed in that round, consistency adjustments, and what is missing so the same problems don't come
back.

**Legend** — Priority: 🔴 high · 🟡 medium · ⚪ low. Effort: **S** (hours), **M** (1–2 days).
Status: ✅ done · ⬜ pending.

**Execution order:** first 9 and 10, which protect the sweep's 26 fixes; then 1 and 2, the ones
analysts see the most day to day; the rest in table order.

## Summary

| # | Follow-up | Priority | Effort | Area | Status |
|---|---|---|---|---|---|
| 1 | Dates and times in the browser's format | 🔴 | S–M | Management / Backup | ✅ |
| 2 | Users table actions in a menu | 🟡 | S–M | Administration | ✅ |
| 3 | Administration tabs with no scroll cue | 🟡 | S | Administration | ✅ |
| 4 | Announcement banner with no margin | ⚪ | S | Global | ✅ |
| 5 | Console window bar off the pattern | ⚪ | S | Isolated environment | ✅ |
| 6 | API docs field tables | ⚪ | S | API docs | ✅ |
| 7 | Leftover 13 px text | ⚪ | S | Global | ✅ |
| 8 | Form button rule in the guide | ⚪ | S | UI guide | ✅ |
| 9 | Visual suite covering the fixed screens | 🔴 | M | Tests | ✅ |
| 10 | Manual findings become sweep checks | 🔴 | M | Tests | ✅ |
| 11 | Accessibility (axe-core) in the sweep | 🟡 | M | Tests / Global | ✅ |
| 12 | Portuguese text outside the dictionaries | 🟡 | S–M | i18n | ⬜ |

## Problems left

### 1. Dates and times in the browser's format

- **Where:** Management report ("From" and "To" fields) and the backup schedule ("Time").
- **Problem:** native fields (`type="date"` and `type="time"`) follow the browser's language, not the
  app's: with the Portuguese interface they show "10/16/2026" and "02:00 AM".
- **Proposal:** the app language's `lang` on those fields; if Chromium still ignores it, a masked text
  field (dd/mm/yyyy, 24 h), validated as today.
- **Done when:** in Portuguese dates show dd/mm/yyyy and the time in 24 h; in English, the US format.

**Implemented.** `lang` doesn't solve it (Chromium uses the browser's language in the native field),
so:

- **Dates:** an `HpsmDateInput` component (`components/HpsmDateInput.tsx`), a text field in the app
  language's format, with the day, month and year order taken from `Intl` (`components/dateField.ts`,
  with tests). It accepts `/`, `-` or `.`, refuses dates outside the calendar (31/02) and outside
  min/max; with invalid text the field is marked, queries nothing, and goes back to the current date
  on leaving. The calendar button next to it opens the browser's picker (`showPicker`) through a
  hidden native field.
- **Scheduled backup time:** an HH:MM (24 h) text field, validated as before.

**Checked** in the `management.mjs` scenario, in an English browser with the app in Portuguese: the
date shows dd/mm/yyyy, the typed one becomes the period, the invalid one is marked without a query
and goes back on leaving, and the day picked in the calendar changes the period too.

### 2. Users table actions in a menu

- **Where:** Administration > Users.
- **Problem:** role + Suspend + Reset password + Grant API (+ Disable 2FA) don't fit on one line even
  at 1366x768: each user takes two lines.
- **Proposal:** keep the role select in the row and move the actions into an "Actions ▾" menu, as in
  HPSM; the dangerous ones keep their confirmation.
- **Done when:** one line per user at 1366x768 and at 1280x800.

**Implemented.** The row keeps the role select and an "Actions ▾" button (`HpsmMenuButton`, extracted
from the bar's "More ▾"). The menu holds Suspend/Reactivate, Reset password, Turn off 2FA (when on)
and Grant/Remove API; the dangerous ones in red, all with the same confirmation as before. Why "Reset
password" is disabled (own account, AD account) became the item's tooltip. One line per user from
1280 px up; below that, the menu drops under the select instead of being cut by the grid. The
`actions`, `two-factor`, `api-tokens` and `ldap-login` scenarios now use the menu.

### 3. Administration tabs with no scroll cue

- **Where:** Administration, below 1280 px.
- **Problem:** the tab strip scrolls horizontally, but with a thin (or overlay) bar you can hardly see
  there are more tabs: "Settings" shows cut off.
- **Proposal:** arrows at the ends when a tab is hidden, or a "More ▾" with the tabs that don't fit.
- **Done when:** at 1024x768 every tab can be seen and reached without scrolling blind.

**Implemented** in `HpsmTabs`, so it applies to every tab strip (record, account, administration):
‹ › arrows over the ends, only on the side with a hidden tab, that scroll the strip. The arrows are
mouse-only (out of Tab order and screen readers); with the keyboard, the focused tab scrolls into
view. The active or focused tab stops 1.5rem from the end so it isn't under the arrow. New scenario:
`tab-arrows.mjs`.

### 4. Announcement banner with no margin

- **Where:** top of the work area, when an announcement is active.
- **Problem:** the banner touches the work area's edges; the message bar right below has an 8 px
  margin.
- **Proposal:** the same margin as the message bar.

**Implemented.** The banner block has the message bar's inset (0.4rem on top, 0.5rem on the sides),
and each banner a message's inner padding: edges and icons line up with the message right below and
with the content.

### 5. Console window bar off the pattern

- **Where:** the isolated environment's dedicated console window.
- **Problem:** "Extend deadline / Capture screen / Discard environment" sit in a white box, unlike the
  gradient bar (`HpsmToolbar`) of the rest of the app.
- **Proposal:** use the standard bar, keeping the window's own layout.

**Implemented.** The three actions moved to an `HpsmToolbar` at the top of the window, above the
title, as on the app's screens: "Extend deadline" and "Capture screen", a divider and "Discard
environment". To keep the dangerous action cue, `HpsmToolbarButton` gained `danger` (red text). The
discard confirmation is unchanged.

### 6. API docs field tables

- **Where:** API docs, the "Field / In / Type / Description" table of each route.
- **Problem:** a lighter header and rows without the striping of the other grids.
- **Proposal:** the app's grid style.

**Implemented.** `.dl-apidoc__fields` now uses the grid design: a gradient header with dividers and
bold text, striped rows, the cells' 1rem inset and the same border colors.

### 7. Leftover 13 px text

- **Where:** KB card title, the login language select, the console window's messages and bar.
- **Problem:** after the sweep's item 19, these are the only texts at 0.8125rem (13 px).
- **Proposal:** decide whether 13 px is a step of the scale (card title, for instance) and record it
  in the guide, or bring them to body size.

**Implemented.** 13 px is not a step of the scale: the guide already said "12px across the whole
app". The KB card title, the console's messages and paste field, the login language select, the
resolution title and the isolated environment artifacts' subtitles ("Sysmon da VM" was 14 px, against
12 px for "Strings by category") went to body size. The guide's typography table now says what may be
larger: page title, Markdown, API route and print headings, indicator numbers and the highlighted
resolution text. The `fonte-acima-do-corpo` check no longer exempts the console window and flags
nothing on the interface.

### 8. Form button rule in the guide

- **Where:** [`docs/interface-hpsm.md`](interface-hpsm.md).
- **Problem:** in practice, add forms (triage rules, assignment, domains, announcements) use only the
  footer button, edit forms use the section bar and the password change uses both. The rule isn't
  written down.
- **Proposal:** write the rule in the guide and align whatever strays from it.

**Implemented.** The rule is in the guide ("Where the save button goes"): on the bar (the page's or
the section's); footer only when the form lives in a list's section; bar and footer only for a
critical form or a wizard; next to the field for a single-field add. Three forms with their own
section and a footer-only button strayed from it: New triage rule, New notice and Resolution for the
submitter. All three now have the action on the section bar, and the resolution counter moved to the
field's help, as in the History tab's update.

## So it doesn't regress

### 9. Visual suite covering the fixed screens

- **Where:** `scripts/ui-visual` (14 references today).
- **Problem:** most screens fixed in the sweep have no visual reference: backup, users, case, KB
  article and editor, announcements, assignment, Reports tab.
- **Proposal:** references of those screens at desktop and compact size.
- **Done when:** undoing any sweep fix breaks the suite.

**Implemented.** 13 new screens in the suite (`scripts/ui-visual/screens.spec.mjs`, "varredura
visual" block): case, record on the Analysis (with an isolated environment) and Reports tabs, KB
article and editor, users, backup, announcements, assignment, domains, comparison, search and YARA
rules with an open pack. A new project, `notebook` (1366x768), runs the ones tagged `@notebook`:
history, case, reports, users, announcements and domains. 33 screenshots in all.

The data comes from `scripts/ui-playwright/screen-data.mjs`, which the sweep now uses too: case,
article, isolated environment and comparison lists in the mock state, and read-only routes for
backup, assignment, announcements and domains (404s in the sweep before). The isolated environment
deadline counts from the frozen clock, and the sweep now runs in the `America/Sao_Paulo` time zone,
the suite's.

**Checked:** with the pre-sweep `hpsm.scss`, 25 of the 33 screenshots break, and every new screen
breaks in at least one resolution. Left out of the suite: the Sysmon tree (item 20, only in the
`sandbox-artifacts` scenario data), the password change (item 3) and the English text (item 26,
which the English sweep flags).

### 10. Manual findings become sweep checks

- **Where:** `scripts/ui-playwright/sweep.mjs`.
- **Problem:** the sweep's most repeated findings were only caught by looking at the screenshots.
- **Proposal:** three new checks:
  - **double inset:** a content block starting right of the section body's inset (found in more than
    10 places);
  - **mixed sizes:** a screen's running text in more than one size;
  - **stacked label:** a visible Carbon label outside a dialog.
- **Done when:** the checks flag the sweep's cases (checked against the previous code) and flag
  nothing in today's interface.

**Implemented.** Three new checks in `sweep.mjs`'s `inspect()`:

- **`fonte-acima-do-corpo`:** running text larger than `--dl-font-size` (up to 15 px; above that the
  existing `fonte-grande` applies). Headings, the page and section headers, the console window, the
  resolution highlight and loose symbols ("×" to close) are left out.
- **`recuo-dobrado`:** inside a section body, adds up padding, margin and border along the path to
  each text and flags from 6 px. Legitimate inset: a box with a border or background, a list with
  markers, a table cell, a form control, a dialog, or the field column (label + 0.5rem). The finding
  is reported by the block that causes the inset.
- **`rotulo-empilhado`:** a visible Carbon label (`label` or `legend`) outside a dialog.

**Checked** against the pre-sweep web (`0605267`), at 1366x768: it flags the backup text, the risk
note, the API examples, the case lists, comparison, the KB article, the scheduled backup and the
labels of backup, evidence and case. On today's interface two remain: the KB card title (item 7,
still pending) and the Dashboard and Management charts, a double inset the manual review had missed,
fixed right after.

### 11. Accessibility (axe-core) in the sweep

- **Problem:** contrast of the 11 px gray help text, visible focus and accessible names were never
  measured.
- **Proposal:** run axe-core on every sweep screen and fix what is real.

**Implemented.** `SWEEP_AXE=1` runs axe-core 4.10.3 (WCAG 2.0/2.1, A and AA) on every sweep screen;
the new `a11y-states.mjs` scenario runs it on states the sweep doesn't see (actions menu open, "More
▾" open, confirmation dialog, shortcuts box, form with an invalid field). axe goes in through the
browser protocol, outside the app's CSP. Both need the package in the container
(`npm i --no-save --no-package-lock axe-core@4.10.3`).

The contrast of the 11 px gray help text and the accessible names passed. Fixed what it flagged:

- **Backup calendar:** past days used the placeholder tone, below 4.5:1; now the muted text gray.
- **Case link in Announcements and in the top banner:** mid-text, only color set it apart; now it is
  underlined (`.dl-link--inline`, the same rule as links inside paragraphs).
- **Dangerous menu and bar item** (created in items 2 and 5): the status red was below 4.5:1 on the
  blue focus background; now it is the dark red of error messages.

Result: no violation on the 58 screens (Portuguese at 1366x768, English at 1024x768) or in the five
states.

### 12. Portuguese text outside the dictionaries

- **Where:** `scripts/check-i18n.mjs` (16 texts in 12 files).
- **Proposal:** review them one by one; what shows on screen goes to the dictionary, the rest
  (comments, sample data) goes into the script's exception list.
