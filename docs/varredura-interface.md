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
  line, overlapping controls, element off screen, regular text larger than the interface standard, broken or distorted image
  and console errors.
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
| 5 | 23 screens and components (Dashboard, Case, Compare, Search, YARA, KB article, API docs, management, triage rules, broadcasts, assignment, domains, settings, backup, sample record sections: document, script, disk, e-mail, capture, reports) | The space between sections varied between 8 px and 32 px: 36 sections had an extra 24 px margin (`dl-mt-lg`), the others didn't. On the Dashboard, "ATT&CK techniques" sat 32 px below the chart; in the record, sections were 8 px apart | all | Neighboring sections always 8 px apart (the default `.hpsm-section` margin); the extra margin left the sections (it stays only on tables and non-section blocks) |
| 6 | Knowledge base articles and cards, reports on the Case screen, API docs, isolated environment hint | 16px paragraphs amid 12-13px text: Carbon gives every `<p>` the `body-02` size. In the article, paragraphs and quotes came out larger than the list items of the same text | all | In the theme base, the paragraph inherits the context size (the line height stays Carbon's). The sweep gained the off-standard font check |
| 7 | Global History and Submit Sample | The action bar ("Take next"; "Submit file / Cancel") came below the page header, while on the other 12 screens (Dashboard, Inbox, sample record, Case, YARA…) it comes above: the bar moved from one screen to another | all | Both screens follow the standard (bar at the top, above the header), and the interface guide (`interface-hpsm`), which described the opposite of what the system does, was corrected |
| 8 | Every form (Allowed indicators, record triage, sample record, account…) | Label and field were centered on the field + help text block: with help below, the label dropped ("SHA-256:" 9 px below the field text) and, in a two-column row, the neighboring field went out of line ("Type" 7 px below "Indicator"; "Assignee" below "Priority") | all | Fields aligned at the top, and the label centered on the 24 px control by a fixed offset; the same applies to the first line of a text area |
| 9 | Sample record, Analysis tab: "Isolated environment" panel | The panel was a Carbon box (`Tile`), without the title band of the record's other sections, with its own title and another border; with the file purged, the same panel already showed as an HPSM section | all | The panel became an HPSM section, like the rest of the record; inside a section, the button bar has no frame of its own |
| 10 | Case (reports, timeline, new comment), knowledge base article, e-mail attachments | The block repeated the section body padding (`0.5rem 0.75rem` inside another one): the text started 12 px further right and 8 px lower than in the other sections | all | No padding of their own in these blocks: the text lines up with the rest of the screen |
| 11 | Every text field (filters, forms, Case, KB, sample submission, allowed indicators) | Single-line field text touched the border (0 inset: Carbon takes the inset from a density token the app doesn't define), while the text area was inset 6 px and the select 16 px: in the same form, text started at three positions | all | A 0.4rem inset in text field, number field and select (the arrow side stays clear), the same as the text area |
| 12 | Knowledge base, new and edit article | The "Text" + preview block had its own side padding (inside the section body) and no space above: the "Text" label and the editor sat 10 px right of the other labels and fields, touching the Tags field | all | No side padding of its own, with the form's row spacing: label, editor and preview line up with the fields above |
| 13 | Filter bars (Global History, queues, My Uploads, cases, KB and other lists) | The buttons (Clear, Save view, Share view, Export CSV) wrapped one by one: at 1366x768 "Export CSV" sat alone on the third row; and they were 1rem apart, the spacing between filters, against 0.5rem in toolbars | 1366x768 and smaller | The buttons sit in one block that wraps as a whole, 0.5rem apart |

## Discarded (not problems)

- **Screen-reader-only labels** (`cds--visually-hidden`), clipped on purpose.
- **"Show password" button inside the password field**, overlapping on purpose.
- **401 errors on login and sign-up** (no session) and the **console WebSocket**, which doesn't
  exist in the mocked API.
