# Selecta 4.0 - test, visual, accessibility, adverse-case and performance matrix

- **Proposed:** 2026-11-07.
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (PR #25 and PR #26 already merged at review).
- **Status (2026-11-12, recounted from the [checklist](selecta-4-implementation-checklist.md) task lines):** 25 decisions **Accepted**; 250 tasks: **202 Implemented, 36 In progress, 12 Not started; 0 Verified**. (Created 2026-11-07 with 25 Proposed decisions and 250 Not started tasks.)
- **Change scope:** Documentation only; no frontend, backend, audio, database, test or CI changes.
- **History:** ADR-0001–0088, T/P/S3/S31 identities and their historical evidence remain unchanged.


**No test is claimed run by this documentation PR.** Preserve `web/src/**/*.test.ts(x)`, `web/e2e/*.e2e.ts`, `tests/*.py`, existing audio, request, draft, Studio, export and Edge coverage; review every changed test with contract parity. New suite names below are suggestions only.

## Cross-cutting matrix

| Axis | Required representative cases |
|---|---|
| Theme | Dark, Light and system choice; first paint; changed system preference; forced colours |
| Width | 320, 360, 375, 390, 430, 600, 768, 1024, 1280, 1440, 1920, 2560 CSS px, plus large workstation |
| Height | 568/640px short windows, landscape, mobile keyboard visible |
| Zoom | 100%, 200%, 400%; font fallback and system text enlargement |
| Interaction | Mouse, touch, keyboard-only, NVDA/Edge and available VoiceOver/TalkBack, hardware media keys |
| Content | Blank, long/unbroken, Unicode/RTL/CJK/emoji, duplicates, missing BPM/artist/lyrics, malformed data |
| State | Empty, partial, loading, busy, ready, warning, failed, stale, offline, recovery, cancelled, old API |
| Volume | 20,000 Library songs, 100-song mix, 64-cell Studio, long draft list, 50 requests |
| Sound | Synthetic deterministic fixture and separately licensed real audition, missing audio, FLAC decode |
| Cross-process | Delayed, dropped, duplicate, out-of-order responses; server restart; second browser tab |

## Feature acceptance matrix and proposed test expansions

| Feature | Critical cases | Suggested suite coverage |
|---|---|---|
| Onboarding | Quoted Windows path, UNC, permissions, empty files, cancel/restart, exactly 5/6/7 ready | Existing Start/Setup tests; add onboarding E2E |
| Shell | Old URLs, Back/Forward, audio lifecycle, sticky safe areas, Stage denial | Existing App/Shell/router/finishing; add nav/responsive E2E |
| Themes | Both contrast schemes, title-bar, focus, disabled, canvas, first-paint, no audio remount | tokens/component gallery and visual E2E |
| Transport | Play/Pause/Resume, Next vs Jump, seek near boundaries, volume, Media Session, multi-tab | player, Now, focus and listen E2E |
| Explore | Featured suggestion, 5-point energy, destination, failed/double build, replacement policy | Mixes/MixSetup, flows E2E |
| My Mixes | Play A/Edit B, duplicate names, deleting selected draft, copy/activate failure | Drafts/Mix and integration E2E |
| Editor | Exact insertion, lock, reorder, Undo, stale pair, 100-song, focus retention | Mix/EditorRows and scale E2E |
| Inspector | Requested vs render, fallbacks, cue changes, late result, version rating | SeamInspector and render E2E |
| Studio | 8-64 cells, arrow/Home/End/Space, missing stems, AI response late, working-copy recovery | Studio and audio/focus, grid E2E |
| Requests | Approval, bridge decline/accept, rough override, atomic join, cancelled old poll | Requests/RequestsJoining and Python contracts |
| Discovery | Word phrase, pair insertion, version-bound rating, four-stage harmony | Links/Listening and discovery E2E |
| Library | URL search, filters, deep-page freshness, 20k, duplicate titles | Library/SongDetails/Python library edges |
| Workspace | Folder disconnect, analysis progress, cache budget, diagnostics redaction | Workshop, API system, operations E2E |
| Export | Frozen snapshot after edit, modal close/reload, missing file, cancel, FLAC decode | ExportPanel/ExportJobs/Python renderer |
| Blind study | No provenance, both clips, failure retry, duplicate submit | Listening and Python study protocols |
| Accessibility | Axe plus real keyboard and NVDA tasks, menu/grid/focus, 400% zoom | controls, shortcuts, browser AT manual |
| Performance | Input delay during analysis, 20k Library, 100 editor, 64 grid, visualizer offscreen | Traces with recorded hardware and build |
| Visual | Approved exact browser snapshots in both themes and meaningful states | `visual.e2e.ts` baseline review |

## Mandatory adversarial sequences

| ID | Event order | Required outcome |
|---|---|---|
| V4-RACE-A | Change Blend then Cut; Blend response resolves last | Cut remains current intent; old audio not labelled current |
| V4-RACE-B | Cancel request; old pending poll arrives after | Request does not incorrectly reappear |
| V4-RACE-C | Edit Studio; request AI; edit again before AI result | Latest manual grid is preserved |
| V4-RACE-D | Export Draft A; open Draft B; export A resolves | Job remains tied to A's frozen revision |
| V4-RACE-E | Insert after X; another tab removes X first | No insertion after wrong track |
| V4-RACE-F | Start preview, then explicitly Pause main; close preview | No automatic surprise Resume |
| V4-RACE-G | Two tabs edit same revision concurrently | Stale update rejected or clear reconciliation |
| V4-RACE-H | Server accepted request/export but response dropped | Safe idempotent retry; no duplicate |
| V4-RACE-I | Old transition render completes after pair changed | No stale audio on new seam |
| V4-RACE-J | Bridge approved, one seam ready, second fails | None of route inserted |
| V4-RACE-K | Library page 30 visible while analysis polling | Visible page updates; not only first 200 songs |
| V4-RACE-L | Theme, density, Stage or route change while playing | No player remount, overlap or restart |
| V4-RACE-M | Export starts, mix changes, download finishes | Decoded FLAC matches original frozen snapshot |
| V4-RACE-N | Wrong-pair or invalid Studio recovery blob loaded | Safely rejected, no accidental Apply |
| V4-RACE-O | Old server missing optional capability field | Clear unsupported state, no false success |

## Visual and user-review criteria

Capture every major page in default/empty/loading/error/open-panel/selected/ready conditions as applicable; both themes at mobile/tablet/desktop; add high-risk pairwise combinations. Pin browser, OS, fonts, fixture, animation and data. An owner reviews diffs, never blanket-updates baselines.

Run **unassisted listener** (connect music → first play → request), **creator** (save draft → edit safely → export), and **expert** (cue/stem transition → BPM correction → bridge consent) scenarios. Record completion, hesitation, errors and recovery; don't invent success percentages. Screen-reader sessions must name NVDA/Edge version and task outcomes. Actual music listening separately evaluates subjective transition quality. A downloadable HTTP response does not prove decodable revision-correct FLAC.

## Release

No independent user/AT/real-audio/performance checks have been performed for this new programme. On 2026-11-12 **202/250 are Implemented and 0/250 Verified**. See [NO-GO gate](selecta-4-release-gates.md).
