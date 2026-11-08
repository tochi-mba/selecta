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

Not yet fixtures (states that need playback, real stems or a failing server):
Listen while playing and during a handoff, Stage, Studio, Requests with a bridge, export job
progress, loading and error states. These are covered behaviourally by `listen.e2e.ts`,
`finishing.e2e.ts`, `flows.e2e.ts` and `integration.e2e.ts`; pixel review of them is on the
person list.

## Coverage denominator

Required widths: 320×568, 375×667, 768×1024, 1280×800, 1440×900, 1920×1080, plus a short landscape
1280×600. Each width captures 19 states × 2 themes = 38 images, 266 in total per run, with reduced
motion and the Still motion setting. 400 % zoom is covered by the reflow test in `pages.e2e.ts`
("zoomed in as far as browsers go"), not by screenshots.

## Provenance

Each width writes `paired-manifest-<w>x<h>.json` with: `status`
(`candidate-not-independently-verified`), `sourceSha` (`GITHUB_SHA`), `capturedAt`, `platform`,
`browser` (`msedge`), `motion`, `fixture` (`tests/e2e_server.py`), `required` and `captured` counts,
and per image the fixture ID, path, theme, size and a SHA-256 of the accessible control semantics.
It holds no file paths, user names or song metadata from a real library.

## Semantic parity

For every fixture the dark capture's control semantics (role, label, pressed, selected, checked,
disabled) must hash equal to the light capture's; a mismatch fails the test. Visual quality is not
judged by the test.

## Defect crosswalk

| Defect class | Owning task(s) | Where it is caught |
|---|---|---|
| A control loses its boundary in one theme | FP-0264, SF-0201-05 | edge-contrast check; reviewer |
| Theme changes control state or labels | FP-0266-02, FP-0271-04 | semantic hash in `paired-theme.e2e.ts` |
| Browser chrome disagrees with the page | FP-0265 | `finishing.e2e.ts` theme tests |
| Overlay covers a required action | FP-0270 | `overlay-arbitration.e2e.ts` |
| Long or RTL names clip | GP-0248, SF-0202-04 | `finishing.e2e.ts` long names test |
| Canvas keeps an old theme | FP-0266-04 | repaint dependency in `views/Now.tsx`; reviewer |

A failure is filed against the owning task ID above; earlier programmes' histories are left as
they are.
