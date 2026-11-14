# 🔍 Visual sweep of the interface (November 2026)

> 🇧🇷 [Leia em português](varredura-interface.pt-BR.md)

Every screen of the web interface was captured with Playwright, against the mocked API, in four
resolutions: **1440x900** (reference), **1366x768**, **1280x720** and **1024x768**. Each finding
below was fixed in its own commit.

## How it was done

- **Capture:** `scripts/ui-playwright/sweep.mjs` goes through every route and inner tab (57
  screens: the application routes, the 6 tabs of the sample record, the 8 of the account and the 9
  of the administration), takes a full-page screenshot and runs checks in the browser: horizontal
  scroll, clipped text (with or without an ellipsis), button or tab with its text on more than one
  line, overlapping controls, element off screen, broken or distorted image and console errors.
- **Screens with their own data** (management, assignment, broadcasts, domains, triage rules,
  backup, API docs and page capture): the dedicated scenarios, with the resolution changed through
  `SWEEP_VIEWPORT=WxH`.
- **Visual review** of every screenshot, for what the checks don't catch: spacing, alignment and
  consistency between screens.

To repeat it (in the Playwright container, like the scenarios):

```
node sweep.mjs                                    # every screen, in the 4 resolutions
SWEEP_SIZES=1366x768 SWEEP_ONLY=admin node sweep.mjs
SWEEP_LANG=en node sweep.mjs                      # in English (longer texts)
SWEEP_VIEWPORT=1366x768 OUT_DIR=/work/out/1366 node management.mjs
```

The screenshots go to `out/sweep/<resolution>/` and the report to `out/sweep/report.json`.

## Findings and fixes

| # | Screen | Problem | Resolutions | Fix |
|---|---|---|---|---|
| 1 | Sample lists (Global History, My Uploads, queues) | The Sample column was the first to shrink: the name broke mid-word ("instalador_suspei…", "relatorio_trimestral.d / ocm") and the date into two lines, while the short columns had room to spare. With that fixed, at 1280 and 1366 the full table didn't fit and Reports and Date went into a hidden horizontal scroll | 1366, 1280 | A minimum width for the title (`overflow-wrap: anywhere`, needed for huge names, let the column shrink to one character) and three re-measured tiers of secondary columns: at 1366 only Reports goes; at 1280, Type too; at 1024, also Assignee, Age and Date |
| 2 | Mandatory password change (and any authentication box with an opening text) | The opening text came out at 16px, inherited from the paragraph, larger than the rest of the interface (12-13px) | all | The opening text uses the body font (12px, 1.5 line height) |
| 3 | Mandatory password change | The "Senha atual ou temporária:" ("Current or temporary password:") label broke into two lines, with the asterisk out of line with the field | all, in both languages | Only in that box, the label column and the box get wider (the field keeps its size); login and sign-up, with short labels, don't change |
| 4 | Dashboard | In the indicator cards, the label dropped in cards without a supporting line (the grid rows stretched to the tallest card's height): "Pendentes" and "Em análise" sat lower than their neighbors | all | The card content stays at the top: labels at the same height |

## Discarded (not problems)

- **Screen-reader-only labels** (`cds--visually-hidden`), clipped on purpose.
- **"Show password" button inside the password field**, overlapping on purpose.
- **401 errors on login and sign-up** (no session) and the **console WebSocket**, which doesn't
  exist in the mocked API.
