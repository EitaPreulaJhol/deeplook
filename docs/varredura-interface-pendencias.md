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
| 1 | Dates and times in the browser's format | 🔴 | S–M | Management / Backup | ⬜ |
| 2 | Users table actions in a menu | 🟡 | S–M | Administration | ⬜ |
| 3 | Administration tabs with no scroll cue | 🟡 | S | Administration | ⬜ |
| 4 | Announcement banner with no margin | ⚪ | S | Global | ⬜ |
| 5 | Console window bar off the pattern | ⚪ | S | Isolated environment | ⬜ |
| 6 | API docs field tables | ⚪ | S | API docs | ⬜ |
| 7 | Leftover 13 px text | ⚪ | S | Global | ⬜ |
| 8 | Form button rule in the guide | ⚪ | S | UI guide | ⬜ |
| 9 | Visual suite covering the fixed screens | 🔴 | M | Tests | ⬜ |
| 10 | Manual findings become sweep checks | 🔴 | M | Tests | ⬜ |
| 11 | Accessibility (axe-core) in the sweep | 🟡 | M | Tests / Global | ⬜ |
| 12 | Portuguese text outside the dictionaries | 🟡 | S–M | i18n | ⬜ |

## Problems left

### 1. Dates and times in the browser's format

- **Where:** Management report ("From" and "To" fields) and the backup schedule ("Time").
- **Problem:** native fields (`type="date"` and `type="time"`) follow the browser's language, not the
  app's: with the Portuguese interface they show "10/16/2026" and "02:00 AM".
- **Proposal:** the app language's `lang` on those fields; if Chromium still ignores it, a masked text
  field (dd/mm/yyyy, 24 h), validated as today.
- **Done when:** in Portuguese dates show dd/mm/yyyy and the time in 24 h; in English, the US format.

### 2. Users table actions in a menu

- **Where:** Administration > Users.
- **Problem:** role + Suspend + Reset password + Grant API (+ Disable 2FA) don't fit on one line even
  at 1366x768: each user takes two lines.
- **Proposal:** keep the role select in the row and move the actions into an "Actions ▾" menu, as in
  HPSM; the dangerous ones keep their confirmation.
- **Done when:** one line per user at 1366x768 and at 1280x800.

### 3. Administration tabs with no scroll cue

- **Where:** Administration, below 1280 px.
- **Problem:** the tab strip scrolls horizontally, but with a thin (or overlay) bar you can hardly see
  there are more tabs: "Settings" shows cut off.
- **Proposal:** arrows at the ends when a tab is hidden, or a "More ▾" with the tabs that don't fit.
- **Done when:** at 1024x768 every tab can be seen and reached without scrolling blind.

### 4. Announcement banner with no margin

- **Where:** top of the work area, when an announcement is active.
- **Problem:** the banner touches the work area's edges; the message bar right below has an 8 px
  margin.
- **Proposal:** the same margin as the message bar.

### 5. Console window bar off the pattern

- **Where:** the isolated environment's dedicated console window.
- **Problem:** "Extend deadline / Capture screen / Discard environment" sit in a white box, unlike the
  gradient bar (`HpsmToolbar`) of the rest of the app.
- **Proposal:** use the standard bar, keeping the window's own layout.

### 6. API docs field tables

- **Where:** API docs, the "Field / In / Type / Description" table of each route.
- **Problem:** a lighter header and rows without the striping of the other grids.
- **Proposal:** the app's grid style.

### 7. Leftover 13 px text

- **Where:** KB card title, the login language select, the console window's messages and bar.
- **Problem:** after the sweep's item 19, these are the only texts at 0.8125rem (13 px).
- **Proposal:** decide whether 13 px is a step of the scale (card title, for instance) and record it
  in the guide, or bring them to body size.

### 8. Form button rule in the guide

- **Where:** [`docs/interface-hpsm.md`](interface-hpsm.md).
- **Problem:** in practice, add forms (triage rules, assignment, domains, announcements) use only the
  footer button, edit forms use the section bar and the password change uses both. The rule isn't
  written down.
- **Proposal:** write the rule in the guide and align whatever strays from it.

## So it doesn't regress

### 9. Visual suite covering the fixed screens

- **Where:** `scripts/ui-visual` (14 references today).
- **Problem:** most screens fixed in the sweep have no visual reference: backup, users, case, KB
  article and editor, announcements, assignment, Reports tab.
- **Proposal:** references of those screens at desktop and compact size.
- **Done when:** undoing any sweep fix breaks the suite.

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

### 11. Accessibility (axe-core) in the sweep

- **Problem:** contrast of the 11 px gray help text, visible focus and accessible names were never
  measured.
- **Proposal:** run axe-core on every sweep screen and fix what is real.

### 12. Portuguese text outside the dictionaries

- **Where:** `scripts/check-i18n.mjs` (16 texts in 12 files).
- **Proposal:** review them one by one; what shows on screen goes to the dictionary, the rest
  (comments, sample data) goes into the script's exception list.
