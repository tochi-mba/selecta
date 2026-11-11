# MP-0272 pixel defect register and justified exceptions

**Status:** candidate, automated measurement only. Not a human visual approval (that is MP-0272-08) and
not independently verified. Every row below comes from a run of `web/e2e/mp-baseline.mp.ts`, never from
reading source.

- **How to reproduce:** `cd web && pnpm exec vite build && MP_WRITE_DOCS=1 pnpm e2e:mp`. Headless Edge,
  muted, light theme, still/reduced motion, the stress-metadata library (`tests/e2e_server.py` with
  `SELECTA_E2E_STRESS=1`). Raw geometry lands in `web/mp-data/mp-0272/<fixture>.json`; the gathered
  defects in `docs/adr/mp-0272-measured-summary.json`.
- **Measured source:** working tree equal to `edccc3a` (2026-11-10), which includes the D-01 to D-03
  fixes below. The pre-fix measurement was the same tree without those three CSS lines.
- **Coverage:** 17 routes x 11 viewports, 16 dynamic fixtures x 11 viewports, More drawer x 3 narrow
  viewports: 366 measured states (`coverage` in the summary). Inventory and denominators:
  `docs/adr/mp-0272-surface-inventory.json`.
- **Viewports:** 320x568, 375x667, 620x740, 760x800, 768x1024, 1024x768, 1280x800, 1440x900,
  1920x1080, 3840x2160 and short landscape 1280x600. Headless Edge on Windows draws a 15px classic
  scrollbar, so content width is the viewport minus 15px (320 measures as 305).
- **Drift guard:** the spec's last test fails when a measured P0 or P1 key is missing from this file.
  Keys are `rule surface selector`, exactly as the summary prints them.

## Severity and rules

| Severity | Rule | Measured as | Target |
|---|---|---|---|
| P0 | `page-overflow` | an element's box past the window edge while the page scrolls sideways | inside 0..width |
| P0 | `overlay-off-screen` | an open `.overlay-panel` box outside the window | inside the window |
| P0 | `unreachable-control` | at full scroll, a control's centre still hit-tests to fixed chrome | reachable |
| P1 | `cut-off` | past the window edge, clipped, no scroll | inside 0..width |
| P1 | `target-size` | control (or its label) under 24 CSS px in either dimension, inline `a` excepted | >= 24x24 (WCAG 2.2 SC 2.5.8) |
| P1 | `clipped-text` | text `scrollWidth > clientWidth` with overflow hidden and no ellipsis, boxes > 1px | wrap or ellipsis |
| P1 | `fixed-overlap` | two fixed/sticky chrome boxes intersect by more than 2x2px | no overlap |
| P2 | `truncated-no-full-text` | ellipsis with no `title`/`aria-label` holding the full text | full text available |
| P2 | `touch-target` | control 24..43px on layouts at most 768px wide | >= 44x44 |

Rules live in `web/e2e/mp-measure.ts`. A 1px clipped box is screen-reader-only text by design
(`.visually-hidden`, `h2.editor-mode-heading`, `.requests-head h2`); the first full run flagged 30 such
boxes as `clipped-text`, so the rule now skips boxes of 1px or less. That was a detector false positive,
not a page defect, and is not listed below.

## P0 and P1 defects

| ID | Sev | Key | Selector | State (fixture) | Viewports | Measured baseline | Proposed target | Status |
|---|---|---|---|---|---|---|---|---|
| D-01 | P0 | `page-overflow persistent.connection li.song-row` | `.library-rows .song-row` (`web/src/styles/operations.css`) | Library loaded at 1280, window then narrowed, no reload (`fx.fail.offline`; reproduced online too) | 320, 375, 620, 760, 768, 1024 | row 976.2px wide inside a 273px list at 320 (328 at 375); document 992px in a 320px window; persisted after reconnect | rows follow the list: 273 at 320, 328 at 375 | **Fixed** in `operations.css`: `.library-rows { grid-template-columns: minmax(0, 1fr) }`. Cause: rows use `content-visibility: auto` with `contain-intrinsic-size: auto 72px`, so skipped rows report their last rendered width and the list's auto track kept the wide layout. Re-measured: row = list at all 11 viewports. Regression test `D-01: Library rows reflow when the window narrows without a reload` |
| D-02 | P1 | `target-size overlay.inspector .why-not summary` | `.why-not summary` (`web/src/style.css`) | Transition inspector, Change tab (`fx.edit.inspector`) | all 11 | 256 x 21.1px | height >= 24px | **Fixed**: `min-height: 24px`. Re-measured 256 x 24 (now only the P2 touch row below) |
| D-03 | P1 | `target-size overlay.glossary button.link` | `.glossary-related .link` (`web/src/styles/glossary.css`) | Music terms, related term with a short name (`fx.overlay.glossary`) | all 11 | 22.9 x 44px | width >= 24px | **Fixed**: `min-width: 24px`. Re-measured 35.4 x 44 |
| D-04 | P1 | `target-size route.lucy button.lucy-link` | `button.lucy-link` (`web/src/views/LucyGate.tsx`, `Lucy.tsx`; `web/src/styles/lucy.css`) | Lucy page, setup sentence (`fx.route.idle`) | all 11 | 131.2 x 22.3px | 24px tall, or keep as inline text | **Exception E-01** |

No `overlay-off-screen`, `unreachable-control`, `cut-off`, `fixed-overlap` or (after the detector fix)
`clipped-text` was measured in any of the 366 states, including the long, unbroken, duplicate, missing,
RTL, mixed-direction and CJK names.

## P2 touch-target findings (open, logged, not fixed here)

All measured only on layouts at most 768px wide. Each meets the 24px minimum; the target is the
44px touch size the app already uses for most controls (`--control-height`).

| ID | Selector | Where (fixtures) | Measured | Proposed target | Note |
|---|---|---|---|---|---|
| D-05 | `button.overlay-close` | every overlay (help, palette, glossary, activity, shaping, song details, export, clear mix, inspector sheet, studio, requests, more) | 42 x 44 | 44 x 44 | 2px short in width: `.overlay-close` padding in `web/src/styles/shell.css` (ADR-273 spacing owner). See E-03 |
| D-06 | `a.context-button.health-attention` | every route, 320..768 | 52 x 32 | height 44 | context bar health link (`web/src/shell/Shell.tsx`) |
| D-07 | `a.brand` | every route at 768x1024 (rail layout) | 187 x 36 | height 44 | only when the tablet rail shows |
| D-08 | `button.nav-collapse.quiet` | every route at 768x1024 | 38 x 44 | 44 x 44 | rail collapse button |
| D-09 | `button.song-select` | editor and draft timeline | 160 x 30 | height 44 | the row's other controls are 44; the title button is the main row target |
| D-10 | `.add-gap button` | editor and draft timeline | 196.4 x 36 | height 44 | deliberately quieter "Add a song" gap; see E-04 |
| D-11 | `button.term-hint-button` | Listen, Word connections, Requests | 28 x 28 | 36 on touch (already in `glossary.css` coarse-pointer rule) | the `(pointer: coarse)` rule gives 36; headless Edge reports a fine pointer. See E-02 |
| D-12 | `.chips button` | inspector Change tab | 123.9 x 36 | height 44 | |
| D-13 | `.music-context-help summary`, `.why-not summary` | inspector | 556 x 24, 256 x 24 | height 44 on touch | disclosure summaries in dense inspector text |
| D-14 | `.needs-you-list a` | Workspace overview | 141.4 x 24 | height 44 on touch | list of links |
| D-15 | `button.icon` | Listen and mini-player | 40 x 44 | 44 x 44 | |
| D-16 | `a.skip-link` | every route | 139.9 x 40 | height 44 | off screen until focused (`shell.css`), measured at its focused size |

## Justified exceptions (MP-0272-07)

| ID | Applies to | Measured | Rationale | Kept until |
|---|---|---|---|---|
| E-01 | D-04 `button.lucy-link` | 131.2 x 22.3 | A text button inside a sentence ("... Choose an AI service"), styled and spaced as the sentence's own line. WCAG 2.5.8's inline exception covers a target whose size is constrained by the line height of surrounding text; padding it to 24px would break the line. The detector exempts inline `a` but cannot see that a `button` sits in running text, so the exception is recorded here. | Lucy setup copy changes to a standalone control |
| E-02 | D-11 `.term-hint-button` | 28 x 28 (fine pointer), 36 x 36 (coarse) | The small `?` beside a music word is a secondary hint next to text, sized not to push the word out of its line; a coarse pointer already gets 36px, and the full glossary is one press away from the shortcuts dialog. Above the 24px minimum. | ADR-277 icon/badge microgeometry review |
| E-03 | D-05 `.overlay-close` | 42 x 44 | A 2px shortfall from the `--space-snug` (10px) inline padding around a 22px icon in `shell.css`; it is 44px tall, well above the 24px minimum, and the padding is an ADR-273 spacing token. Kept and logged so the spacing owner changes it with its token rather than a one-off pixel nudge here. | ADR-273 / ADR-295 overlay geometry |
| E-04 | D-10 `.add-gap button` | 196.4 x 36 | The add gap between songs is deliberately quieter than song rows so the timeline reads as songs and transitions first; it spans the row width, so it is easy to hit despite 36px height. | ADR-287 editor row grid |
| E-05 | Layouts that measured clean | 0 P0/P1 in: Make a Mix, My Mixes, Listen idle and playing, Stage, mini-player handoff, Library (after D-01), Word connections, Harmonic matches, all six Workspace tabs, Listening study, Not found, export dialog, Requests bridge drawer, palette, shortcuts, Activity, Shape the next mix, Song details, More, Clear mix | These layouts pass every P0/P1 rule at all 11 viewports with the stress names; MP work keeps them as they are and changes them only on a measured defect. | a measured defect |
| E-06 | Overlay rest position | `overlay-appear` slides 8px | Geometry is measured after `document.getAnimations()` finish, so the 8px entrance offset is motion, not a resting misalignment. | ADR-296 motion tokens |
| E-07 | `fx.studio` measured `unavailable` only | Studio tab with "why it can't open" | The e2e library sets stems to `never` (no stem model in tests), so the open eight-lane grid is not measured here. The unavailable state is the Studio's real state on such a machine. | a stems fixture for the e2e server |

## What is not yet measured

Fixtures with `driver: null` in the inventory (toasts, delete mix/draft, replace mix, Library batch
confirm, folder dialogs, backup restore, Lucy drawers, ControlGallery specimens, the device harness
alertdialog), dark theme and forced colours in this matrix (dark is covered by
`web/e2e/paired-theme.e2e.ts`), 200/400% zoom, real touch pointers and real audio. These are gaps,
not passes.
