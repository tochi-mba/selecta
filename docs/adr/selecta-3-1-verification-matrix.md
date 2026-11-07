# Selecta 3.1 — verification, research tasks and release matrix

- **Status:** Proposed verification design. PR #25 now includes additional component tests, with full integrated CI and human acceptance still unverified.
- **Scope:** S31-0078 through S31-0088 (116 tasks). Existing 3.0 and historical T/P tests/feature parity retain ownership.
- **Baseline:** `main` merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`.
- **Separation of evidence:** source inspected ≠ browser rendered ≠ automated assertion ≠ human assistive-technology test ≠ actual listening experience.

## Minimum evidence layers

| Layer | Candidate source / work | Evidence required to mark a task Verified |
|---|---|---|
| Frontend/unit | `web/src/App.test.tsx`, `web/src/views/*.test.tsx`, `web/src/ui/controls.test.tsx` | Named assertions and result/commit, including failed action and recovery |
| API/backend | `tests/test_api_contracts.py`, `tests/test_drafts.py`, `tests/test_request_routes.py` | Correct scope, revision guard, idempotent recovery, local file boundary |
| Browser workflows | `web/e2e/{pages,flows,integration}.e2e.ts` | Real supported browser, intended and adverse path, focus and URL state |
| Audio browser | `web/e2e/listen.e2e.ts`, synthetic licensed test library | Actual timing/ownership/continuity, not mocked `play()` alone |
| Visual snapshots | New *future* deterministic Playwright comparisons | Owner-reviewed light/dark fixture screenshots including overlays/failure states |
| Accessibility | Axe plus keyboard and human AT walkthrough | WCAG 2.2 AA essential-task audit; no focus trap/obscured focus |
| Product research | Unassisted new/daily/expert tasks | Logged participant/task/observations with reproducible errors; provisional metrics revised from baseline |
| Real media | Audition and completed FLAC decode | Audible quality judged by a person, continuity technically checked, exact snapshot file validated |
| Scale | 20k songs, 100-song editor, 64 Studio cells and background render | Device/build/fixture, input delay/scroll/memory/audio timing measurements |
| Privacy/PWA | loopback network inspection; installed supported Chrome/Edge | No unexpected external transfer or false offline claim |
| Delivery | `.github/workflows/test.yml`, release disposition | Full existing strict gate remains; rollback and P0/P1 handling documented |

## Route and surface coverage

| Surface | Key modes/states | Required adverse case | Owning new ADRs |
|---|---|---|---|
| First run/Sources | new, invalid, scanning, analysis, enough ready | denied/empty/unplugged folder; correct LRCLIB metadata notice | 0081, 0086, 0087 |
| Explore | featured, mood, unavailable, custom, draft, replace | not-ready preset, replacement cancellation, 0–5 ready | 0081, 0087 |
| Listen | empty, playing, paused, seeking, seam, next | unavailable seek, false ready, lost backend, clip overlap | 0082, 0087 |
| Lyrics/Stage | timed line/word, untimed, none, fullscreen/fallback | long text, denied fullscreen, Escape/focus restore | 0082, 0087 |
| My Mixes | empty/current, drafts, queue, swap | duplicate names, deleted draft, conflicting current edit | 0083, 0088 |
| Edit/Inspector | 2–100 songs, manual cue, render/fallback, stale | late result, stale revision, wrong Undo, requested vs actual | 0083, 0087 |
| Studio | two songs, 4 lanes, 64-cell grid, solo, Apply | missing stems, dirty close, pair moved, preview race | 0084, 0087 |
| Requests/bridges | pending, ready, approved, rejected, cancelled | competing request, partial render, late poll, unsafe join | 0085, 0088 |
| Word/Harmonic | search, pair, four audition steps, verdict, add | no result, stale verdict, unavailable clip, preview audio | 0085, 0087 |
| Library/Details | filter/sort/search/paging, correction, exclusion | 20k, stale query, missing file, override reanalysis | 0086, 0087 |
| Workspace | analysis/jobs/storage/sources/diagnostics | disconnected server, out of space, interrupted job | 0086, 0088 |
| Listening studies | enroll, A/B, answer, retry, finish | failed submit, duplicate trial, compromised blinding | 0086, 0088 |
| Export/Activity | queue, encode, ready, download, failure | edit while export, reload, interrupted/invalid FLAC | 0080, 0083, 0088 |
| Global | themes, shortcuts, navigation, PWA, offline | back/forward alias, two-tab takeover, keyboard inset | 0079, 0080, 0082, 0087 |

For each route/overlay mark initial, empty, partial, refreshing, saving, queued/running, failed, stale, offline and recovered **or write a reason N/A**. Capture allowed actions, backend effect, audio effect, focus and ARIA announcements.

## Device, input and modality matrix

- **Widths:** 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920 and 3840 CSS pixels, with selected heights and landscape/orientation cases. Zoom 100/200/400%, text enlargement, scroll and virtual keyboard.
- **Themes:** system/light/dark; system change while running; first paint and title-bar treatment; long/missing/duplicate/RTL/Unicode names.
- **Inputs:** pointer, touch, keyboard-only, reduced motion, hover/focus tooltips, media keys, screen readers with platform and version actually recorded.
- **Assistive technology:** NVDA+Edge on Windows as core target; VoiceOver/TalkBack where device and support permit. A missing human run stays **Pending** rather than being labelled passed.
- **Controls:** menus, dialogs/drawers/sheets, combobox, tabs, native range and waveform, Studio grid, reorder, toast/Undo, command palette and live regions.
- **Target sizes:** WCAG 2.2 AA 24×24 CSS px with exceptions; 44px-class is a product touch target where practical, not a fictitious WCAG requirement.

## Adversarial integrated scenarios

| ID | Trigger | Mandatory outcome | IDs |
|---|---|---|---|
| F-01 | Start invalid folder, scan existing folder, remove drive mid-analysis | No data mutation or fake readiness, recovery clear | 0081, 0086 |
| F-02 | Play current A, edit draft B, submit request for A, Undo A | Correct scope, no B changes or unintended pause | 0082, 0083 |
| F-03 | Set cue/style A, start render, choose B, late A returns | User intent B survives; actual available audio labelled honestly | 0083 |
| F-04 | Open Studio P, preview, reorder pair elsewhere, Apply | No stale edit to wrong pair, no surprise main audio restart | 0084 |
| F-05 | Two competing requests, bridge pending, cancel, late poll | No duplicate/partial/unapproved/cancelled insertion | 0085 |
| F-06 | Search query B arrives after query A starts, query A returns last | B owns displayed results, keyboard focus stable | 0080, 0086 |
| F-07 | Export draft B, modify B repeatedly, close panel, reload | Job matches original revision; real FLAC decode/download works | 0083 |
| F-08 | Switch light/dark/system and navigate while playing | No theme flash, contrast failure, lost state or audio restart | 0079, 0082 |
| F-09 | Narrow mobile, open keyboard, focus last row, open drawer | No obscured focused element, nav/player collision or trapped overlay | 0080, 0082, 0087 |
| F-10 | Two browser tabs use preview and player; stop backend | One sound owner, no overlap or unrequested resume; truthful reconnect | 0082, 0087 |
| F-11 | Correct BPM/key; background analysis completes | Effective manual override preserved; readiness consistent everywhere | 0086 |
| F-12 | Blind A/B response fails; retry with same trial identity | No lost/repeated response, preserved study blinding | 0086 |
| F-13 | 20k Library, 100 Edit rows, Studio grid while rendering | Recorded responsiveness/performance, no audio timing regression | 0087 |
| F-14 | Screenshot fixture in both themes with long/RTL titles | Reviewable stable diffs; text/focus/status not clipped or invented | 0079, 0088 |

## User research scripts and release objectives

- **New listener:** locate and add a folder, explain external metadata lookup, start the first genuinely ready mix, pause/skip/seek, request a song, visit Library without audio disruption.
- **Daily listener:** find an intended mood, change length, understand Next vs Skip, inspect an upcoming transition, choose whether to approve a bridge and recover a failed request.
- **Creator:** create/edit draft, reorder with keyboard and touch, inspect cue/style, Undo, apply Studio change, run revision-pinned export and decode result.
- **Expert/operator:** correct analysis, explain fallback intent vs audio, investigate storage pause, use full Studio grid, recover after drive/backend failure.
- **AT user:** perform essential journey with screen reader and keyboard at supported zoom without hidden focus.
- **Outcomes:** count task success, hesitation, destructive mistake, recovery time, comprehension, confidence. The illustrative >=90% core-task goal requires approval after baseline, not a claim of current success.

## Release decision rules

**P0 blocks unconditionally:** source/user data loss, wrong mix/draft revision, unintended playback/silence/overlap/resume, partial/unapproved bridge, wrong or invalid FLAC, unsafe file access/privacy, invented readiness, inaccessible essential task. **P1 blocks unless the owner explicitly accepts documented risk.** P2 visual problems receive a written review and disposition.

An implementing PR must link S31 and inherited S3/parity IDs, preserve existing behaviour assertions and full CI gate, include at least one relevant adverse case, light/dark and width snapshots, keyboard/AT checks, actual audible test when affecting sound, real benchmark when affecting scale, and a rollback path. **PR #25 now contains limited UI and unit-test changes; integrated release gates and real human/audio evidence remain outstanding.** Update the evidence ledger and checklist honestly.
