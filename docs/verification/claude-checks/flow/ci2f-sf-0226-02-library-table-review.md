# SF-0226-02: heuristic task review of the dense Library table (Claude, owner-delegated)

Claude's own heuristic expert review, not an expert user's review. Done 2026-11-12 on a build of
`eb9e6eab` (working tree) in Microsoft Edge 157.0.4341.46 (Playwright, headless) against
`SELECTA_E2E_STRESS=1 SELECTA_E2E_STEMS=1 python tests/e2e_server.py 9450` (made-up library, 19
songs with awkward names). Viewports 1440 x 900 light and dark, 768 x 860 and 320 x 860 light.
Each screenshot below was opened and looked at; the row data came from the page (row heights,
visible text, the accessibility tree and a 22-step Tab walk).

Screenshots (this folder): `ci2f-library-1440-compact-light.png`, `ci2f-library-1440-compact-dark.png`,
`ci2f-library-1440-compact-recent-light.png`, `ci2f-library-1440-filtered-light.png`,
`ci2f-library-768-tempo-compact-light.png`, `ci2f-library-320-tempo-compact-light.png`.

## Tasks walked

1. Sort by artist, tempo and newest, then Back and reload.
2. Switch Comfortable to Compact and scan for one song.
3. Filter Needs attention, search inside it, clear everything.
4. Read one row by keyboard and in the accessibility tree.

## What holds up

- **Sorting is clear and kept.** "Sort by" offers Title, Artist, Tempo and Newest first; the choice
  goes into the address (`?sort=tempo`) and survived Back and a reload.
- **Columns line up and are labelled.** A header row reads "Song and artist", "Tempo · Key · Length",
  "Mix readiness", "Actions"; tempo, key and length are set in a monospaced face in one column
  (for example `118 BPM 7A 1:31`), so numbers scan down the page in both themes.
- **Readiness is not colour alone.** Each row says it in words with an icon: "Ready for mixes" (tick)
  or "Couldn't be analysed" (cross) with "SelectaDJ couldn't analyse this file." and a "Try analysing
  again" action in place of "Start a mix".
- **Filters and empty results are honest.** Needs attention showed exactly the one failed song; a
  search inside it said "Nothing matches "the"." with "Looking in: Needs attention, searching for
  "the"", plus Clear search and Show all songs. The live count ("19 songs.", "0 songs.") is a status.
- **Awkward names survive.** Right-to-left, Japanese and unbroken titles wrap inside the row; the one
  over-long artist is cut with an ellipsis and its full name is in the title text and in the row
  checkbox's accessible name. No page sideways scroll at 1440, 768 or 320.
- **Same-name songs are told apart.** Two songs called "Same Name" by Hal Greene carry a visible
  "Recording 10" and "Recording 17" tag.
- **Narrow widths reflow.** At 768 the header row goes and each row stacks title, then tempo, key and
  length, then readiness, with the actions on the right; nothing is cut off.
- **Dark theme** keeps the same hierarchy; the pressed buttons and the readiness words stay legible.

## Findings for an expert to judge

1. **Compact is not very dense.** Rows measured 126 px (Comfortable) and 88 px (Compact) at 1440;
   with the header, summary, toolbar, filters and the selection hint above the list, about four rows
   are visible in the first 900 px screen. At 320 px no song row is visible in the first screen
   (rows are 175 px there).
2. **Header labels are not sort controls.** Sorting is only through the select; the header row is
   plain text (no column headers in the accessibility tree, no direction), and Tempo sorts one way
   only (slowest first).
3. **Unknowns sort first.** Sorted by tempo, the unanalysed "Broken File" comes before the slowest
   real tempo (118 BPM); sorted by artist, "Unknown artist" comes before "Ada Reyes".
4. **Four Tab stops per row.** Each row is a checkbox, the title (details), Start a mix and More, so
   reaching the tenth song by keyboard takes about 40 Tab presses; there is no arrow-key movement
   between rows.

These are review notes, not defects proven by users; the expert user's task review stays open.
