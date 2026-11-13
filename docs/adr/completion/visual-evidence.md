# Paired Light/Dark visual evidence

Captured by `web/e2e/paired-theme.e2e.ts` against `tests/e2e_server.py` (a synthetic library with
long, right-to-left, CJK, accented and duplicate names; no private music). Captures are
**candidates**: CI produces them, a named person approves them (see
[needs-a-person.md](needs-a-person.md)).

## Fixtures

| Fixture ID | Route / state | Source of the state |
|---|---|---|
| `start-explore` | `/` first view with a ready library | `views/Mixes.tsx` |
| `explore` | `/mixes` cards and featured idea | `views/Mixes.tsx` |
| `my-mixes` | `/mixes/mine` current mix, drafts, render line | `views/MyMixes.tsx` |
| `listen` | `/listen` before playback | `views/Now.tsx` |
| `editor` | `/mix/current/edit` timeline | `views/Mix.tsx` |
| `library` | `/library` list | `views/Library.tsx` |
| `discovery-words` | `/discover` | `views/Links.tsx` |
| `discovery-harmonic` | `/discover/harmonic` | `views/Links.tsx` |
| `workspace` | `/workshop` overview | `views/Workshop.tsx` |
| `analysis` / `sources` / `storage-backups` / `learning` / `diagnostics` | Workspace tabs | `views/WorkshopPanels.tsx`, `LocalBackup.tsx` |
| `listening-study` | `/listening` enrolment | `views/Listening.tsx` |
| `export-dialog` | Edit → Download audio (dialog open) | `views/ExportPanel.tsx` |
| `shape-dialog` | Make a Mix → Customize (dialog open) | `views/MixSetup.tsx` |
| `library-selection` | Library with one recording selected (rail open) | `views/Library.tsx` |
| `library-empty-search` | Library search with no match | `views/Library.tsx` |

Driven states, paired at 375×667 and 1280×800 by `web/e2e/fp-0271-paired-states.e2e.ts` (each
carries the matching MP-0272 fixture from `docs/adr/mp-0272-surface-inventory.json`):

| Fixture ID | State | Source of the state |
|---|---|---|
| `setup-first-run` | `/` with an empty library: the folder step | `views/Start.tsx` |
| `library-failed` | Library whose list request fails | `views/Library.tsx` |
| `offline` | the server stops answering: the connection banner | `App.tsx` |
| `listen-playing` | Listen with the first song playing (muted) | `views/Now.tsx` |
| `stage` | Fullscreen lyrics over the playing song | `views/Now.tsx` |
| `inspector` | Editor with the first transition open | `views/SeamInspector.tsx` |
| `studio` | the transition's Studio tab | `views/Studio.tsx` |
| `requests-bridge` | Requests with a bridge awaiting consent and a waiting request | `views/Requests.tsx` |
| `song-details` | Library song details | `views/SongDetails.tsx` |

## Canonical route-state fixtures (FP-0271-01)

Every surface ADR-0271 names, with the fixture IDs that stand for it. Held to the specs and the source by
`web/src/shell/fp0271Fixtures.test.ts`.

| Surface | Fixture IDs | Source |
|---|---|---|
| Start | `start-explore`, `setup-first-run` | `views/Mixes.tsx` |
| Setup | `setup-first-run` | `views/Start.tsx` |
| Explore | `explore`, `shape-dialog` | `views/Mixes.tsx` |
| Listen | `listen`, `listen-playing` | `views/Now.tsx` |
| Stage | `stage` | `views/Now.tsx` |
| My Mixes | `my-mixes` | `views/MyMixes.tsx` |
| Edit | `editor` | `views/Mix.tsx` |
| Inspector | `inspector` | `views/SeamInspector.tsx` |
| Studio | `studio` | `views/Studio.tsx` |
| Requests | `requests-bridge` | `views/Requests.tsx` |
| Discovery | `discovery-words`, `discovery-harmonic` | `views/Links.tsx` |
| Library | `library`, `library-selection`, `library-empty-search`, `library-failed`, `offline` | `views/Library.tsx` |
| Details | `song-details` | `views/SongDetails.tsx` |
| Workspace | `workspace`, `analysis`, `sources`, `learning`, `diagnostics` | `views/Workshop.tsx` |
| Backups | `storage-backups` | `views/LocalBackup.tsx` |
| Export | `export-dialog` | `views/ExportPanel.tsx` |

Empty states: `library-empty-search`, `setup-first-run`. Error states: `library-failed`, `offline`.
Loading is not a still: `finishing.e2e.ts` "pages hold their shape while they load" measures it.
Export job progress needs a running render and stays on the person list.

## Coverage denominator

Required widths: 320×568, 375×667, 768×1024, 1280×800, 1440×900, 1920×1080, plus a short landscape
1280×600, and 320×200 for 400 % zoom (the CSS layout a 1280×800 window gets at 400 %). Each size
captures 19 states × 2 themes = 38 images, 304 in total per run, with reduced motion and the Still
motion setting. The spec's `COVERAGE` object is written into every manifest with its exclusions: 2560px
is not paired (no breakpoint above 761px), and Stage, Studio, Inspector and Requests have driven states
in `mp-baseline.mp.ts`, light only.

## Provenance

Each width writes `paired-manifest-<w>x<h>.json` with: `status`
(`candidate-not-independently-verified`), `sourceSha` (`GITHUB_SHA`), `capturedAt`, `platform`,
`browser` (`msedge`), `motion`, `fixture` (`tests/e2e_server.py`), `required` and `captured` counts,
and per image the fixture ID, path, theme, size and a SHA-256 of the accessible control semantics.
It holds no file paths, user names or song metadata from a real library.

## Deterministic baseline candidates (polish P0132)

`web/e2e/polish-p0132-baselines.e2e.ts` captures every `helpers.ts` PAGES route plus Library
loading, empty, failed and recovered, in light and dark, at 375px and 1440px. Controls: the synthetic
library and a reset current mix, the page clock fixed at `harness.ts` `FIXED_NOW`, reduced motion with
`animations: 'disabled'` and a hidden caret, and no playback. Masks (each hides only live or
audio-derived pixels): `canvas` (spectrum, waveform, visualizer), `time` and `.tabular-time`
(elapsed/remaining times) and `.toast-stack` (job-timed notices). Each test writes
`candidate-p0132-*.png` and a `p0132-manifest-*.json` with `status`
`candidate-not-independently-verified`, the fixture, fixed time, motion and masks; CI uploads the
images as `selecta-3-1-visual-review-*`. Nothing is a golden baseline until a named person approves the
set here with name, date, device and exact SHA and commits it (P0133 reviews the differences).

## Coverage map of every state (S3-0075-01)

`docs/adr/s3-0075-coverage-map.json` lists all 215 states of the 49 surfaces in
`docs/adr/mp-0272-surface-inventory.json`. Each state names the candidates that capture it (spec and
file pattern) or the written reason none does yet: `in-flight` (refreshing and saving, which need a
held-request driver), `needs-driver`, or `outside-route-tree`. `web/src/shell/s3CoverageMap.test.ts`
holds it to the inventory and the specs. The candidates come from the P0132 approach: P0132 itself,
`fp-0271-paired-states.e2e.ts`, `s3-0075-visual-regression.e2e.ts` (overlays), the new
`s3-0075-01-state-candidates.e2e.ts` (connection lost over every route that has that state, plus the
draft, Lucy and missing-address pages), and `mp-baseline.mp.ts` with `MP_CANDIDATES=1`, which saves
a screenshot of every measured surface, fixture and viewport into `web/mp-data/mp-0272-candidates/`
and lists them in each fixture's JSON. None of them uses `toHaveScreenshot`, and a person still
approves the baselines.

## Semantic parity

For every fixture the dark capture's control semantics (role, label, pressed, selected, checked,
disabled) must hash equal to the light capture's; a mismatch fails the test. Visual quality is not
judged by the test.

## Defect crosswalk

| Defect class | Owning task(s) | Where it is caught |
|---|---|---|
| A control loses its boundary in one theme | FP-0264, SF-0201-05 | `fp-theme-boundaries.e2e.ts` edge-contrast report; reviewer |
| Theme changes control state or labels | FP-0266-02, FP-0271-04 | semantic hash in `paired-theme.e2e.ts` and `fp-0271-paired-states.e2e.ts` (a mismatch names the differing controls) |
| Browser chrome disagrees with the page | FP-0265 | `fp-first-paint.e2e.ts`, `fp-live-theme.e2e.ts`, `state/prefs.test.ts` |
| Overlay covers a required action | FP-0270 | `overlay-arbitration.e2e.ts` |
| Long or RTL names clip | GP-0248, SF-0202-04 | `finishing.e2e.ts` long names test |
| Canvas keeps an old theme | FP-0266-04 | `fp-live-theme.e2e.ts` canvas pixel check; reviewer |

A failure is filed against the owning task ID above; earlier programmes' histories are left as
they are.
