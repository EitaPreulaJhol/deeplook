# 🔍 Visual sweep of the interface (November 2026)

> 🇧🇷 [Leia em português](varredura-interface.pt-BR.md)

Every screen of the web interface was captured with Playwright, against the mocked API, in four
resolutions: **1440x900** (reference), **1366x768**, **1280x720** and **1024x768**. Each finding
below was fixed in its own commit. What was left for later is in
[`varredura-interface-pendencias.md`](varredura-interface-pendencias.md).

## How it was done

- **Capture:** `scripts/ui-playwright/sweep.mjs` goes through every route and inner tab (58
  screens: the application routes, the 6 tabs of the sample record, the 8 of the account and the 9
  of the administration), takes a full-page screenshot and runs checks in the browser: horizontal
  scroll, clipped text (with or without an ellipsis), button or tab with its text on more than one
  line, overlapping controls, element off screen, regular text larger than the interface standard,
  broken or distorted image, console errors and, in English, "por/em/às" hard-coded before a name or
  date. After the sweep came text above body size, double inset and stacked label (see the
  [follow-ups](varredura-interface-pendencias.md), item 10).
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
| 14 | Sample record, Reports tab: "Evidence" row | The caption field had a stacked label ("Caption (optional)") inside a left-label form: the "Evidence" label lined up with that caption, while field, button and help sat 20 px below | all | The caption became placeholder text in the field (the label stays for screen readers); field, button and help sit in one row centered with the label |
| 15 | Case: "Add sample" and "New comment" | Both fields had a stacked Carbon label, while the rest of the screen (Case data) and the record's update field use left labels; "Add sample (ID or link)" repeated what the placeholder already shows | all | Left label ("Add sample:", "New comment:") with field and button beside it and the help below, as in the record |
| 16 | Sample record, case, IOC and KB article: summary bar | The summary bar had 1.5rem below it (24 px plus the tabs' inset: 28 px to the tabs or first section), while header, toolbar and sections sit 8 px apart | all | 0.5rem below the bar, in its own rule, on the four screens |
| 17 | Administration > Users | At 1366x768 names wrapped onto two lines ("Ana / Souza"), so did the "API access" header, and the role select stretched with the free space: each row wrapped its buttons at a different point, with a gap between select and buttons | 1366x768 | Role select 7.5rem on every row and not stretching; name and headers unwrapped from 1280 px up (below that they still wrap so the table fits) |
| 18 | Administration > Backup (create and scheduled) | The tab broke the pattern of the others: stacked Carbon labels ("ZIP password", "Repeat", "Weekdays", "Time"), big buttons in the middle of the content ("Create backup", "Save schedule") instead of the section bar, text at 0.8–0.85rem (the body is 0.75rem), the "Next runs" list indented from its title, "Loading the schedule..." loose between sections and, in the Actions column, "Download" not underlined next to an underlined "Delete" | all | Left-label fields (Content, Protection, ZIP password, Schedule, Repeat, Weekdays, Time); actions in each section's bar; text, calendar and list at body size; loading inside the section; "Download" and "Delete" with the same link style |
| 19 | KB article and editor, Markdown reports, risk score, static analysis (DIE, unpacking, imports, macros), isolated environment artifacts and Sysmon, map, audit chain, API docs | Running text in these blocks used 13 px (0.8125rem) or 12.8 px (0.8rem), against 12 px on the rest of the screen: in the KB article, the article body was larger than the "Cited in" section right below | all | Running text and lists at body size (`--dl-font-size`); headings stay larger. The isolated environment panel title rule, unused since item 9, is gone |
| 20 | Sample record, isolated environment: Sysmon process tree | Tree items had a ~1 line height: the monospace command line touched the process name above it | all | 1.5 line height on tree items |
| 21 | Automatic assignment (add rule, new group) and other sections with a table followed by a form | The form's first field touched the table right above it (2 px), without the spacing that separates grid and fields on the case screen | all | 0.75rem between the table and the form right after it |
| 22 | Announcements: announcement list | At 1366x768, "Dismissed by" wrapped onto two lines, as did "Bruno / Lima" and the "Valid until" dates, while the announcement text column had room to spare | 1366x768 | Only the announcement text wraps; name, dates and headers on one line from 1280 px up |
| 23 | Company domains: variations seen | Domains ("ernpresa.com.b / r") broke mid-name with room to spare in other columns: the monospace class breaks at any character, so the grid squeezed the column to its minimum | all | Domain columns break only when they don't fit (long hashes still break anywhere) |
| 24 | Static analysis (strings by category, PE, ELF, capa, Ghidra), document VBA macros, sample comparison, search, YARA retroscan samples | More blocks repeated the section body's side padding: headings, lists and columns started 10 to 12 px right of the fields and text of other sections (same cause as item 10) | all | No side padding of their own in these blocks (dialogs, with their own body, stay as they are) |
| 25 | YARA rules > Rule packs: search in the open pack's rules | The field had a stacked Carbon label ("Search pack rule") and the "N set(s)" count loose below it, while the "New rule" section right above uses left labels | all | Left label ("Search rule:") and the count as the field's help |
| 26 | Case (summary and Added column), KB article, allowed indicators, YARA retroscans (English interface) | "por" hard-coded before the name: in English it showed "10/24/2026, 9:00:00 AM por Ana Souza" | all, in English | Text from the dictionary ("by Ana Souza"); the English sweep now flags "por/em/às" before a name or date |
| 27 | Dashboard and Management report: daily chart, verdicts and ATT&CK techniques | The chart and bar lists repeated the section body's inset: legend, "View as table" and the lists started 10 px right of the rest (found later, by the double inset check of the [follow-ups](varredura-interface-pendencias.md), item 10) | all | No side inset of their own on the chart and bar lists |

## Discarded (not problems)

- **Screen-reader-only labels** (`cds--visually-hidden`), clipped on purpose.
- **"Show password" button inside the password field**, overlapping on purpose.
- **401 errors on login and sign-up** (no session) and the **console WebSocket**, which doesn't
  exist in the mocked API.
- **Case tab title with an ellipsis** ("CASO-0001 · Campanha do bol…"): document tabs are at most
  14rem wide and show the full title in the tooltip.
- **Administration tabs cut at 1024x768**: the strip scrolls horizontally; since the
  [follow-ups](varredura-interface-pendencias.md) (item 3), with arrows at the ends.
- **"API access" header on two lines at 1024x768**: below 1280 px the users table lets names and
  headers wrap so it fits (item 17).
- **"Save" in the Change password footer, besides the bar**: the footer (`HpsmFormActions`)
  complements the section bar, as the UI guide says; add forms (triage rules, assignment, domains,
  announcements) use only the footer.
- **Sessions bar outside the section**: the guide allows a tab or a section bar; the actions apply
  to the whole list.
- **Narrow one-column forms** (Preferences, Notifications, Password, 2FA, Create backup): the
  `dl-form-col` column is intentional; two-column forms use the full width.
- **Stacked labels in dialogs** (import indicators, decoder): the modal pattern.
- **Sweep 404 errors** (backup, assignment, announcements, domains, management, triage rules,
  captures, OpenAPI): routes the sweep's mock API lacks; those screens were checked by the dedicated
  scenarios (`backup.mjs`, `assignment.mjs`, `broadcasts.mjs` and others).
