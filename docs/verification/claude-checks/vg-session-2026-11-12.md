# Owner-delegated machine checks, 2026-11-12 (agent vg)

Claude ran the person steps a machine can genuinely check for the Polish (P), Final polish (FP),
Measured micro-polish (MP), Creative interface (CI), Gap polish (GP), Microinteraction (MI) and
Cloud (SC) checklists. Everything here is recorded as **Verified: Claude (owner-delegated
2026-11-12)** or as a partial check; none of it is an independent human review.

## Environment

- Source: `feat/finish-checklists-2` at `9af0eb13` plus the working tree of that hour (first sweep),
  then the same tree with the three fixes below (recheck build `dist-vg2`, now in HEAD `77421af2`).
- Browser: Microsoft Edge 157.0.4341.46 through Playwright (headless for captures, headed under
  NVDA 2026.3.1 portable for speech). Windows 11 Pro 10.0.26300 on the shared 4-core laptop, which
  was heavily loaded by other agents, so every timing below is an upper bound, not a budget result.
- Data: `tests/e2e_server.py` with `SELECTA_E2E_STRESS=1` (long, missing, duplicate and right-to-left
  names; no real music) and `tests/scale_server.py 9681 20000 100` (20,000 songs, 100-song mix).
- Reduced motion on for captures. Screenshots: `docs/verification/claude-checks/polish/vg-*`,
  `creative-interface/vg-*`, `measured-micro-polish/vg-*` (all under 300 KB).

## 1. Visual sweep (72 captures, every one looked at)

12 routes (`/listen`, `/mixes`, `/mixes/mine`, `/mixes/lucy`, `/mix/current/edit`, `/library`,
`/discover`, `/discover/harmonic`, `/discover/words`, `/workshop`, `/workshop/diagnostics`,
`/listening`) x 320x640, 768x1024, 1440x900 x light and dark. `data-theme` matched the requested
theme on all 72, no page scrolled sideways, no page error. Findings:

| ID | Sev | Where | What was seen | Status |
|---|---|---|---|---|
| VG-1 | P1 | forced colours, `/listen`, `/mixes`, `/mix/current/edit`, both themes | The primary button label (Play, Play from the top) was painted over by the browser's text backplate: a solid block where the word should be | Fixed in `web/src/styles/polish.css` (`forced-color-adjust: none` on the forced-colour primary rule); rechecked, labels read (`creative-interface/vg-recheck-forced-*.png`) |
| VG-2 | P2 | `/library`, all widths, both themes | The set-aside count read "1set aside" (a flex box dropped the space) | Fixed in `web/src/styles/operations.css`; rechecked (`polish/vg-recheck-1440-*_library.png`) |
| VG-3 | P2 | `/mix/current/edit` at 768px | Song title squeezed to about 110px and broken mid-word ("Extraordinaril/y") | Fixed meanwhile by another agent's `style.css` rule (actions on their own line up to 1024px); rechecked (`polish/vg-recheck-768-*.png`) |
| VG-4 | P2 | page bar at 320px, both themes | The page name breaks inside a word: "Workspac/e", "Word connectio/ns", "Diagnosti/cs" | Open. `hyphens: auto` does nothing in this Edge on Windows; needs a design choice (smaller actions or a shorter name) |
| VG-5 | P2 | `/library` light | Selected List view looks almost like Card view (dark theme marks it with a lime edge) | Open |
| VG-6 | P2 | `/mixes` vs `/discover/*` | The tab strip sits under the heading on Mix ideas but above it on Word connections and Harmonic matches, so it jumps when switching tabs | Open |
| VG-7 | P2 | Stage at 1440x900 | The current lyric line starts at the bottom edge and runs under the floating Pause and Exit fullscreen buttons; at 2560x1440 it is fully visible | Open |
| VG-8 | P2 | `/mixes/lucy` at 320px | The sticky composer covers the "New conversation" heading until scrolled | Open, likely acceptable |

## 2. Keyboard, accessibility tree and axe (22 route runs)

11 routes at 1440 dark (desktop) and 375 light (touch phone emulation): axe (WCAG 2.0 to 2.2 A/AA
tags) found **0 violations** on all 22. Every page has one `main`, one `h1`, a named Main and
Breadcrumb navigation, and no unnamed button or link. 30 Tab presses per page: every stop had a
visible focus ring and was scrolled into view. Desktop order: brand, rail (Listen, Make a Mix, My
Mixes, Library, Workspace, Edit), Request a song, side-bar toggle, then the page bar (Search, Theme,
Activity, Workspace attention, Keyboard shortcuts), then the page. Phone order: page bar (Requests,
Theme, Activity, Shortcuts), the page's own tabs, then the page's primary action first (Play from
the top on Edit; the current mix Play and Edit on Make a Mix), then the bottom bar. Live regions:
one polite workspace status, the Library count (`role=status`), Lucy's log and status. Smallest
phone targets: term hints 36x36 and inline links 21 to 24px high (meet the 24px WCAG 2.2 minimum or
the inline exception; below the 44px house target).

## 3. Real NVDA 2026.3.1 speech (headed Edge)

Session 1 (editor, menus, Library controls, study form): "Move Untitled down, button" then, once,
"Moved Untitled to number 3 of 8."; the row menu reads "More for <full long title>, menu button,
collapsed, subMenu", items "Lock, A locked song stays right here when the mix is rebuilt, 1 of 2"
and "Remove <title>, 2 of 2", and Escape returns to the menu button. Library: "Search your library,
edit, Search titles, artists, ...", "Sort by, combo box, Title, collapsed" then "Artist" on Down,
"Row size, grouping, Comfortable, toggle button, pressed", "Library layout, grouping, List view,
toggle button, pressed". Study form: "Study code, edit, required, The code you were given for this
study." and the same for nickname and setup. Findings: typing a Library search spoke no result count
(NVS-1, see session 2), and the workspace attention status is spoken again after every full page load.

The /listen load, the Tab walk through the rail and the Ctrl+K palette ran before NVDA's capture
began (speech is kept only once it announces the Edge window), and the Requests drawer step spoke
nothing after "Loading complete", so those three are not evidenced by speech. A second session for
them waited about an hour behind other agents' NVDA sessions and was cancelled; they remain for a
person or a later session. NVS-1 (the missing search count) should be rechecked with a longer pause
before it is filed as a defect.

## 4. Device emulation, zoom, forced colours, Stage, scale

- Touch (390x844, touch and mobile emulation): tapping a Library row's More opens a menu (Already in
  current mix, disabled; Prioritize; Never play) and Escape closes it; tapping a term's "?" shows the
  explanation inline in the page, not in a hover-only tooltip (`polish/vg-touch-*.png`).
- Studio at 375x812 touch (64 cells, stems served from the made-up song as MP-0289 does): 512 cells,
  smallest 45x44px, the grid scrolls inside itself with sticky lane names, the page never scrolls
  sideways, and a tap toggles a cell (aria-pressed false to true) (`polish/vg-studio-375-dark.png`).
  Solo buttons measured 36x36px.
- Emulated zoom (a 1280x800 window at 200% and 400%): `/library`, `/listening`, `/mix/current/edit`;
  18 Tab stops each, no focused control off screen or under sticky chrome, no sideways scroll. At
  400% the page bar and bottom bar leave only a short band for content (`polish/vg-zoom*.png`).
- Forced colours (Edge emulation, light and dark): states stay distinct (selected rail item, pressed
  toggles, Arrange radio, Ready and Couldn't be analysed pills, planned versus rendered bars), after
  the VG-1 fix.
- Stage: title 40px and current lyric about 80 to 90px at both sizes; see VG-7.
- Scale (loaded laptop, upper bounds): 100-song editor loads in 3.4 s; with a transition inspector
  open, a keyboard move of song 40 is announced ("Moved Golden Horizon 40 down." with Undo) in 0.78 s
  and focus stays on its Move button; 90 scroll frames p50 17 ms, p95 34 ms, one 217 ms frame. 20k
  Library: first page 2.2 s, a search had not settled 1.2 s after typing (skeleton rows still
  showing), 90 scroll frames p50 17 ms, p95 33 ms, max 34 ms.
- Notices: Copy on Diagnostics changes the button to "Copied" (calm, no toast); a Library load
  failure shows an outlined banner "Couldn't load your library. Your songs are fine..." with Try
  again (obvious) (`measured-micro-polish/vg-notice-*.png`).

## 5. Sign-off evidence reviewed (delegated)

- FP-0264-08 packet source `fp-0264-boundary-contrast.json` (206 edges): every essential edge is at
  least 3.42:1; the 154 under 3:1 are 91 browser-drawn checkboxes (CSS border reads 1.0 to 1.1, but
  the native box draws its own visible border, seen in every Library capture) and 63 decorative row
  dividers. Delegated verdict: accept all 154 with that reason.
- CI-0184-03 coverage matrix: still lists 86 ticked tasks without state, browser or negative-case
  coverage, so its acceptance is not met.
- CI-0182-05 glossary: writing review done; it had no entry for the Good and Bad verdict, so the
  difference between plan/render/play and human quality feedback was not explained. Added the
  "Good and Bad" term to `web/src/ui/glossaryTerms.ts` (Glossary, ufTerminology and copy tests: 14
  passed).

## What a machine could not do here

Real phones and their soft keyboards, safe areas and Safari; real browser zoom and OS text size;
installed-app windows and browser toolbars; media keys; audio devices and drives; anything heard;
user studies; physical distance reading; named independent reviewers and owner GO/NO-GO decisions.
