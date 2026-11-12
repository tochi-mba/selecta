# Selecta 2.0: ADR acceptance audit

- **Task:** T0269 ([checklist](implementation-checklist.md)); generated today by `src/selecta/audit/adr_acceptance.py --write` from the checklist and [implementation-evidence.md](implementation-evidence.md).
- **Gate:** `tests/test_adr_acceptance_audit.py` refuses any ADR-0001 to ADR-0032 marked Verified while a task of its own lacks a ticked Done row citing concrete proof.
- **Rule:** each ADR's acceptance criterion is proven through the tasks that implement it. The proof for a task is its row in the evidence ledger; a docs-only row never counts.
- **Necessary, not sufficient:** every task proven lets an ADR be reviewed for Verified; its own browser, accessibility, audio and human checks still decide it.

| ADR | Status | Proven | Still open | Every task proven |
|---|---|---|---|---|
| [ADR-0001](adr-0001-product-contract-and-parity.md) | In progress | 5 of 7 | T0001, T0005 | no |
| [ADR-0002](adr-0002-routing-and-shell.md) | Implemented | 7 of 8 | T0049 | no |
| [ADR-0003](adr-0003-design-tokens-and-brand.md) | In progress | 5 of 7 | T0027, T0029 | no |
| [ADR-0004](adr-0004-interaction-primitives-and-notifications.md) | In progress | 8 of 8 | none | yes |
| [ADR-0005](adr-0005-domain-state-mutations.md) | In progress | 8 of 8 | none | yes |
| [ADR-0006](adr-0006-audio-transport-and-media.md) | In progress | 8 of 8 | none | yes |
| [ADR-0007](adr-0007-audio-focus-ownership.md) | In progress | 7 of 7 | none | yes |
| [ADR-0008](adr-0008-listen-screen.md) | In progress | 9 of 9 | none | yes |
| [ADR-0009](adr-0009-lyrics-and-stage.md) | In progress | 7 of 7 | none | yes |
| [ADR-0010](adr-0010-mix-discovery.md) | In progress | 8 of 8 | none | yes |
| [ADR-0011](adr-0011-steering-and-energy.md) | In progress | 8 of 8 | none | yes |
| [ADR-0012](adr-0012-drafts-and-queue.md) | Implemented | 8 of 8 | none | yes |
| [ADR-0013](adr-0013-edit-timeline.md) | In progress | 8 of 8 | none | yes |
| [ADR-0014](adr-0014-seam-inspector.md) | In progress | 7 of 8 | T0173 | no |
| [ADR-0015](adr-0015-requests-and-bridges.md) | In progress | 11 of 11 | none | yes |
| [ADR-0016](adr-0016-stem-studio.md) | In progress | 8 of 9 | T0201 | no |
| [ADR-0017](adr-0017-library-scale-and-readiness.md) | Implemented | 8 of 8 | none | yes |
| [ADR-0018](adr-0018-library-corrections-and-folders.md) | In progress | 7 of 8 | T0216 | no |
| [ADR-0019](adr-0019-discover-words-and-harmony.md) | In progress | 8 of 8 | none | yes |
| [ADR-0020](adr-0020-workshop-and-storage.md) | In progress | 8 of 8 | none | yes |
| [ADR-0021](adr-0021-blind-listening.md) | Implemented | 7 of 8 | T0240 | no |
| [ADR-0022](adr-0022-flac-export.md) | In progress | 6 of 6 | none | yes |
| [ADR-0023](adr-0023-accessibility.md) | In progress | 5 of 8 | T0038, T0040, T0044 | no |
| [ADR-0024](adr-0024-responsive-workspaces.md) | In progress | 5 of 7 | T0059, T0060 | no |
| [ADR-0025](adr-0025-local-privacy.md) | Implemented | 8 of 8 | none | yes |
| [ADR-0026](adr-0026-api-compatibility.md) | In progress | 9 of 9 | none | yes |
| [ADR-0027](adr-0027-explanations-and-feedback.md) | In progress | 5 of 7 | T0134, T0135 | no |
| [ADR-0028](adr-0028-recovery-and-multitab.md) | In progress | 6 of 7 | T0097 | no |
| [ADR-0029](adr-0029-testing-and-quality.md) | In progress | 11 of 22 | T0014, T0017, T0259, T0260, T0261, T0262, T0263, T0264, T0265, T0266, T0267 | no |
| [ADR-0030](adr-0030-migration-and-release.md) | Implemented | 12 of 23 | T0018, T0019, T0251, T0253, T0258, T0274, T0275, T0276, T0277, T0278, T0279 | no |
| [ADR-0031](adr-0031-pwa-and-browsers.md) | In progress | 2 of 6 | T0061, T0062, T0064, T0065 | no |
| [ADR-0032](adr-0032-diagnostics-and-operations.md) | Implemented | 7 of 7 | none | yes |

## [ADR-0001](adr-0001-product-contract-and-parity.md)

Acceptance criteria:

- Run current pytest and frontend tests before migration; establish deterministic audio fixtures.
- Validate novice listening, advanced editing, local privacy, large library and failure recovery.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0001 | no | Partly | open |
| T0002 | yes | Done | `docs/adr/feature-parity.md` lists every feature with where it now lives. `web/e2e/pages.e2e.ts` opens every page. |
| T0003 | yes | Done | Written record in `docs/user-journeys.md`: casual listening, live requesting, mix creation and expert seam editing, 22 steps, each naming the browser test in `web/e2e/` (listen, flows, integration, mp-0283, mp-0288, mp-0290) that walks it. `tests/test_user_journeys.py` (2 tests) fails if a named test is renamed or removed. Passed 2026-11-11 (pytest, 2 passed). |
| T0004 | yes | Done | `docs/acceptance.md` now says how it is checked: every code-decided number or rule is re-read from the code by `tests/test_acceptance_ledger.py` (11 claim tests, incl. `test_flagged_rows_say_what_changed`), and every real-library or listening measurement is flagged as a dated historical snapshot, not re-measured (`test_real_library_measurements_are_flagged_as_historical_snapshots`). Passed 2026-11-12 (12 passed). Re-measuring the owner library is not part of this task. |
| T0005 | no | Needs a person | open |
| T0006 | yes | Done | Invariants are written down in `docs/adr/feature-parity.md`. |
| T0007 | yes | Done | The owner accepted ADR-0001 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0002](adr-0002-routing-and-shell.md)

Acceptance criteria:

- Back/forward, reload on deep link, invalid draft, open modal, same playback across routes, narrow phone, keyboard and standalone PWA.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0046 | yes | Done | `web/src/router.ts`, `router.test.tsx`. |
| T0047 | yes | Done | `web/src/shell/Shell.tsx`. |
| T0048 | yes | Done | `web/e2e/pages.e2e.ts`: reload, Back, Forward, filters in the address. |
| T0049 | yes | Done | none linked |
| T0050 | yes | Done | `web/e2e/flows.e2e.ts`: a deleted draft is explained, never swapped. |
| T0051 | yes | Done | `tests/test_api_contracts.py`, `web/e2e/pages.e2e.ts`. |
| T0052 | yes | Done | `web/e2e/listen.e2e.ts`: moving around starts no new sound and makes no second audio context. |
| T0053 | yes | Done | The owner accepted ADR-0002 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0003](adr-0003-design-tokens-and-brand.md)

Acceptance criteria:

- Dark/light screenshots, long Unicode metadata, 320px width, 400% zoom, contrast, reduced motion, and regression for conflicting handoff styles.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0023 | yes | Done | Audit written in `docs/engineering/css-ownership.md` ("Scope collisions"): `.handoff` classes are rendered only by `views/Now.tsx` and styled only in `style.css`, `styles/listening.css` (scoped by `.now`/`.stage`) and `styles/music-objects.css`; `.link-handoff` is a separate class. `web/src/styles/scope-collisions.test.ts` (4 tests) and `css-ownership.test.ts` keep it true. Passed 2026-11-11 (vitest, 20 tests with flow-fonts). |
| T0024 | yes | Done | `web/src/styles/tokens.css`, dark and light. |
| T0025 | yes | Done | `web/src/styles/tokens.css`. |
| T0026 | yes | Done | Feature styles are split into owned sheets loaded in a fixed order (`styles/listening.css`, `creation.css`, `operations.css`, `lucy.css`, documented in `docs/engineering/css-ownership.md`), scoped by page class. `web/src/styles/scope-collisions.test.ts` fails when a bare class is styled by two page sheets (only `.page` compounds and the `.draft-list.long` modifier are shared on purpose) or a page sheet restyles a bare element. Passed 2026-11-11 (vitest). Plain scoped stylesheets were chosen over CSS modules. |
| T0027 | yes | Done | none linked |
| T0028 | yes | Done | Both themes, long text, reduced motion and contrast: `web/e2e/pages.e2e.ts` ("every page passes the automatic accessibility checks in dark", "... in light", "dialogs and drawers pass the automatic accessibility checks too") runs axe WCAG checks, including colour contrast, on every page with reduced motion, and was run with `SELECTA_E2E_STRESS=1` so the library has long, bidi, CJK and Arabic names (3 passed, 2026-11-11). Fallback fonts: `web/src/styles/flow-fonts.test.ts` checks no web font is loaded and every font token ends in a generic family (passed 2026-11-11, vitest). |
| T0029 | no | Needs a person | open |

## [ADR-0004](adr-0004-interaction-primitives-and-notifications.md)

Acceptance criteria:

- Focus trap/restoration, Escape, overlapping dialogs, text validation, toast priority, retry, disabled/selected states and mobile hit targets.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0030 | yes | Done | `web/src/ui/formControls.tsx` (TextField, Select, Combobox on `Field`) with `Action`, `IconButton` and `Slider` from `controls.tsx`/`primitives.tsx`; `web/src/ui/formControls.test.tsx` (5 tests: names, busy state, joined label/help/error, disabled select, slider value text, combobox arrow/Enter/Escape). Passed 2026-11-10 (vitest). Existing pages still use labelled native controls; adopting the shared ones page by page is follow-up polish. |
| T0031 | yes | Done | `web/src/ui/controls.tsx`, tested in `controls.test.tsx`. |
| T0032 | yes | Done | `AudioPreview`, `Status`, `Problem`, `Skeleton`, `Section`. |
| T0033 | yes | Done | `Action` tracks each mutation. The global heuristic is gone. |
| T0034 | yes | Done | `web/src/ui/toasts.tsx`: Undo toasts can't be evicted. |
| T0035 | yes | Done | `Problem` offers retry, and `Action` reports failures rather than success. |
| T0036 | yes | Done | `web/src/ui/controls.test.tsx`, `web/e2e/flows.e2e.ts`. Target size is in the automatic WCAG 2.2 checks, which also run with dialogs open. |
| T0037 | yes | Done | The owner accepted ADR-0004 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0005](adr-0005-domain-state-mutations.md)

Acceptance criteria:

- Stale polls, rapid double clicks, concurrent requests, render out of order, multi-tab edits, connection recovery, canceled mutation and storage slider racing.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0067 | yes | Done | `web/src/api.ts`. |
| T0068 | yes | Done | Server calls go through `web/src/api.ts` (`send`/`get`/`post`/`del`, and `fetchBytes` for raw bytes; `lucy/listening.ts`, `views/LocalBackup.tsx` and `views/SeamCompare.tsx` moved onto it 2026-11-12). `web/src/state/pollingPolicy.ts` lists every timer and poll with its hidden-tab rule and names one owner per shared resource; `web/src/state/pollingPolicy.test.ts` (6 tests: every timer listed, no stale entries, one owner each, only api.ts and the separate cloud/admin/rooms clients call fetch) and `web/src/importBoundaries.test.ts` passed 2026-11-12 (vitest). |
| T0069 | yes | Done | `mixChanges` in `App.tsx`, sequence checks on sliders and searches. |
| T0070 | yes | Done | `Action`, scope in the address, `x-mix-order`. |
| T0071 | yes | Done | `web/src/views/Requests.tsx` with `x-operation-id`. |
| T0072 | yes | Done | `x-mix-order`, tested in `tests/test_api_contracts.py`. |
| T0073 | yes | Done | `web/e2e/flows.e2e.ts`, `listen.e2e.ts`, `tests/test_api_contracts.py`. |
| T0074 | yes | Done | The owner accepted ADR-0005 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0006](adr-0006-audio-transport-and-media.md)

Acceptance criteria:

- Autoplay denial, decode fail, seek before/after/during seam, last song, hidden tab, sleep, double Next, media-key race and already playing crossfade.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0099 | yes | Done | `web/src/player.test.ts`, `web/e2e/listen.e2e.ts`. |
| T0100 | yes | Done | Next and Jump to the transition are separate, in `web/e2e/listen.e2e.ts`. |
| T0101 | yes | Done | `web/e2e/listen.e2e.ts`: seeking, and seeking past the way out. |
| T0102 | yes | Done | `web/e2e/listen.e2e.ts`. |
| T0103 | yes | Done | `web/e2e/listen.e2e.ts`: media keys. |
| T0104 | yes | Done | `transitionIsLive` in `web/src/player.ts`. |
| T0105 | yes | Done | `web/src/audio/transportEdges.test.ts` (10 tests): pause, seek and Next mid-seam, held-down Next and repeated play/pause, end of mix, undecodable current and next songs, system suspend and resume in place, gapless ready seam and fallback overlap; real-browser pause/seek/Next/end in `web/e2e/listen.e2e.ts`. Unit tests passed 2026-11-10 (vitest). |
| T0106 | yes | Done | The owner accepted ADR-0006 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0007](adr-0007-audio-focus-ownership.md)

Acceptance criteria:

- Preview switch, modal close, route away, Pause during preview, failed decode, AudioContext suspension, two tabs and overlapping A/B attempts.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0107 | yes | Done | `web/src/audio/focus.ts`. |
| T0108 | yes | Done | `web/src/audio/focus.ts`, `focus.test.tsx`. |
| T0109 | yes | Done | `web/src/audio/focus.test.tsx`. |
| T0110 | yes | Done | `AudioPreview`, `usePreview`. |
| T0111 | yes | Done | `usePreview` state and the player's phase. |
| T0112 | yes | Done | `web/src/audio/focusEdges.test.tsx` (7 tests): A/B non-overlap with one owner, twenty rapid preview switches and a late AbortError, a clip failing to load giving the sound back, slow and refused context resume, multi-tab ownership. Passed 2026-11-10 (vitest). |
| T0113 | yes | Done | The owner accepted ADR-0007 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0008](adr-0008-listen-screen.md)

Acceptance criteria:

- Long titles, no next song, missing waveform, failed render, lyric line/word timing, pending requests, Stage and reduced motion.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0114 | yes | Done | `web/src/views/Now.tsx`. |
| T0115 | yes | Done | `Strip` in `web/src/views/Now.tsx`. |
| T0116 | yes | Done | View toggles in `Now.tsx`. |
| T0117 | yes | Done | `seamFacts` in `web/src/ui/seam.ts`. |
| T0118 | yes | Done | `web/src/views/Now.test.tsx`. |
| T0119 | yes | Done | `web/src/views/Requests.tsx`. |
| T0120 | yes | Done | `onChange` throttled in `App.tsx`. |
| T0121 | yes | Done | `web/e2e/t0121-t0128-listen-edges.e2e.ts`, three tests at 375x812 with `reducedMotion: 'reduce'`: no next song (says it is the last song, Next disabled), very long and right-to-left names (no horizontal overflow, title inside the screen), and a transition reported failed with its clip missing (the next song still comes in, `--motion-fast` is zero, nothing overflows). Passed 2026-11-11 (Playwright, Edge, `dist-s2-b`, port 9102). Existing cover: `web/src/views/UpNext.test.tsx` SF-0215-02/05. |
| T0122 | yes | Done | The owner accepted ADR-0008 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0009](adr-0009-lyrics-and-stage.md)

Acceptance criteria:

- Only line timing, word timing, no lyrics, instrumental song, long lines, RTL scripts, fullscreen Escape and browser unsupported APIs.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0123 | yes | Done | `web/src/views/Now.tsx`, all from the player's clock. |
| T0124 | yes | Done | `Lyrics` in `Now.tsx`, existing timing tests. |
| T0125 | yes | Done | `Lyrics` states in `Now.tsx`. |
| T0126 | yes | Done | `toggleStage` in `App.tsx`, `web/e2e/listen.e2e.ts`. |
| T0127 | yes | Done | `.lyrics p` uses `unicode-bidi: plaintext`, with zoom widths tested. |
| T0128 | yes | Done | Route change while fullscreen: `web/e2e/t0121-t0128-listen-edges.e2e.ts` (T0128 test) enters the Stage with F, goes Back to Library and forward again. It caught a real fault (the browser stayed fullscreen on Library after the Stage unmounted), fixed in `web/src/App.tsx` with an effect that closes the Stage and calls `exitFullscreen` when the page leaves Listen; the test now passes with the mini-player still playing and a single AudioContext. Word/line timing regressions: `web/src/views/lyricHonesty.test.tsx` plus the word-focus and lyric tests in `web/src/views/Now.test.tsx` (14 passed). All run 2026-11-11. |
| T0129 | yes | Done | The owner accepted ADR-0009 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0010](adr-0010-mix-discovery.md)

Acceptance criteria:

- All vibe keys, library below minimum, repeated build, ineligible destination, build error, current playing versus draft and refresh.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0137 | yes | Done | `web/src/views/Mixes.tsx`. |
| T0138 | yes | Done | `web/src/views/Mixes.test.tsx`. |
| T0139 | yes | Done | `MixSetup` in `Mixes.tsx`. |
| T0140 | yes | Done | `Mixes.tsx`. |
| T0141 | yes | Done | `Mixes.tsx`, with `needs` from the server. |
| T0142 | yes | Done | `Mixes.tsx`. |
| T0143 | yes | Done | New `tests/test_s2_mix_presets.py`: all sixteen presets resolve, every preset builds only from its own songs with no repeats or is honestly not offered (parametrized over `VIBES`), every family journey card builds inside its family, a sparse library refuses the build and keeps the current mix, a failed build changes nothing and makes no empty draft (also for Save as draft, and 404 for an unknown preset), and a second click on a changed mix gets 409 `mix_changed` without replacing it. Playback preservation also in `web/src/views/Mixes.test.tsx` (`keeps the active mix until confirmation...`). Run 2026-11-11 under the slot lock with T0151/T0175 tests: 58 passed. |
| T0144 | yes | Done | The owner accepted ADR-0010 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0011](adr-0011-steering-and-energy.md)

Acceptance criteria:

- Curve extremes, rapid changes, reset, keyboard editing, invalid destination, library constraints and old preference migration.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0145 | yes | Done | `Mixes.tsx`. |
| T0146 | yes | Done | `achievedArc` in `Mixes.tsx`. |
| T0147 | yes | Done | `Mixes.tsx` labels defaults as applying to future mixes. |
| T0148 | yes | Done | `Mixes.tsx`. |
| T0149 | yes | Done | `chooseDestination` in `Mixes.tsx`. |
| T0150 | yes | Done | `arcSaves` in `Mixes.tsx`, `saves` in `Workshop.tsx`. |
| T0151 | yes | Done | New `tests/test_s2_steering.py`: flat, full and zigzag curves kept exactly and surviving an app restart, invalid curves (out of range, wrong length, fractions, booleans, text) refused with the saved one kept, reset to each mix's own arc persists, rapid writes end on the last, invalid destinations refused with the saved one kept, a destination that left the library stops the build with a reason, and the planner builds whole mixes on extreme curves. New `web/src/views/s2Steering.test.tsx`: extreme and invalid stop values clamp to 0-100 whole numbers, flattest and steepest curves save exactly, and rapid slider input sends one save with only the last shape. Run 2026-11-11: pytest 58 passed (with T0143/T0175), vitest 9 passed (with s2StemDeck). |
| T0152 | yes | Done | The owner accepted ADR-0011 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0012](adr-0012-drafts-and-queue.md)

Acceptance criteria:

- Many drafts, duplicate names, queue reorder, undo wrong context, storage full, delete/restore, switching while rendering and stale data.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0153 | yes | Done | `web/src/views/Drafts.tsx`. |
| T0154 | yes | Done | `tests/test_drafts.py`, `web/e2e/flows.e2e.ts`. |
| T0155 | yes | Done | `tests/test_drafts.py`. |
| T0156 | yes | Done | `line-controls` in `Drafts.tsx`. |
| T0157 | yes | Done | `Workshop.tsx`, `Drafts.tsx`. |
| T0158 | yes | Done | `web/e2e/flows.e2e.ts`: draft survives reload. |
| T0159 | yes | Done | `tests/test_drafts.py`, `web/src/views/Drafts.test.tsx`. |
| T0160 | yes | Done | The owner accepted ADR-0012 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0013](adr-0013-edit-timeline.md)

Acceptance criteria:

- First/middle/last insert, remove playing song, rapid reorder, locked constraint, draft swap, pending insertion and stale poll.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0161 | yes | Done | `web/src/views/Mix.tsx`. |
| T0162 | yes | Done | `web/src/views/Mix.tsx`. |
| T0163 | yes | Done | `web/src/views/Mix.test.tsx`, `web/e2e/flows.e2e.ts`. |
| T0164 | yes | Done | `scrollWhileDragging` and move buttons in `Mix.tsx`. |
| T0165 | yes | Done | `guard` in `Mix.tsx`, `x-mix-order`. |
| T0166 | yes | Done | `web/e2e/flows.e2e.ts`: a stale change stops and touches nothing. |
| T0167 | yes | Done | Song removed while playing: new `web/src/s2PlayerRemoval.test.ts` (keeps sounding with no restart; Next goes to the song that followed it; the end fade brings that song in) plus a fix in `web/src/player.ts` (`tick`, `next`, `fadeInto`: a removed playing song no longer makes Next jump to the top of the mix or skip the following song, and the seam listed there is not used). Wrong scope, request ghost rows and reorder/poll race: `web/src/views/Mix.test.tsx` (`keeps each mix scope's exact selection separate...`, `show up faded in the timeline...`, `stop and catch up if the mix has moved on`). Locked moves: `tests/test_mix.py::test_a_new_plan_keeps_locked_songs_where_they_are`, `tests/test_request_routes.py::test_playing_it_anyway_never_moves_a_locked_song`. Run 2026-11-11: vitest player 38 passed, Mix 59 passed; pytest 2 + 167 passed. Known limit: while a removed song finishes, the Now card shows the next song's title (display only). |
| T0168 | yes | Done | The owner accepted ADR-0013 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0014](adr-0014-seam-inspector.md)

Acceptance criteria:

- Wrong pair after reorder, failed render, user exact cue, invalid phrase, late result, warn versus fail and repeated style clicks.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0169 | yes | Done | `web/src/views/SeamInspector.tsx`, `web/e2e/flows.e2e.ts`. |
| T0170 | yes | Done | `SeamEditor`, existing tests. |
| T0171 | yes | Done | `option.reason` on each move, `tests/test_room_to_play.py`. |
| T0172 | yes | Done | `seamFacts` in `web/src/ui/seam.ts`. |
| T0173 | yes | Done | none linked |
| T0174 | yes | Done | Details tab in `SeamInspector.tsx`. |
| T0175 | yes | Done | Fast style switching and malformed cues: `tests/test_s2_seam_inspector.py` (`test_fast_style_switching_ends_on_the_last_choice_and_its_own_render`, `test_an_unknown_style_is_refused_and_the_saved_one_stays`, `test_a_malformed_cue_never_breaks_the_mix_or_its_render_request`), 58 passed 2026-11-11. Late render and failed fallback: `web/src/player.test.ts` (`does not start a seam after its cue`, `loads a completed render without waiting for the whole mix to refresh`, `ignores a failed fallback download after the listener seeks elsewhere`), 38 passed 2026-11-11. Rating the correct seam: `web/src/views/Mix.test.tsx` (`posts to that seam alone, and shows the saved rating again after a remount`, `keeps the latest choice visible when an older server response refreshes the inspector`), 59 passed 2026-11-11; `web/src/views/LinksRating.test.tsx` 25 passed with Links. |
| T0176 | yes | Done | The owner accepted ADR-0014 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0015](adr-0015-requests-and-bridges.md)

Acceptance criteria:

- Two rapid submissions, cancel during render, approve/cancel race, missing bridge, multiple bridging options, late playhead and partial failure.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0183 | yes | Done | `web/src/views/Requests.tsx`, `Shell.test.tsx`. |
| T0184 | yes | Done | `GROUP_ORDER` in `Requests.tsx`. |
| T0185 | yes | Done | `tests/test_requests_together.py`, `web/e2e/integration.e2e.ts`. |
| T0186 | yes | Done | `BridgeFinder` in `Requests.tsx`. |
| T0187 | yes | Done | `web/src/views/Requests.test.tsx`. |
| T0188 | yes | Done | `ComingSongs`, `RequestsJoining.test.tsx`. |
| T0189 | yes | Done | `tests/test_requests_together.py`, `tests/test_request_routes.py`. |
| T0190 | yes | Done | `checkNow` in `Requests.tsx`, `tests/test_request_planner.py`. |
| T0191 | yes | Done | `web/e2e/integration.e2e.ts`, `tests/test_request_routes.py`. |
| T0192 | yes | Done | Duplicate submit and approval-vs-cancel: `tests/test_requests.py::test_requests_survive_restart_deduplicate_and_cancel_without_changing_mix`, `tests/test_request_routes.py::test_answering_a_cancelled_request_says_so`, `test_playing_it_anyway_twice_is_refused_kindly`. Bridge partial render: `test_a_bridge_does_not_join_until_every_transition_is_ready`. Preemption: `tests/test_drafts.py::test_what_is_about_to_be_heard_still_beats_a_request`, `test_a_request_seam_stops_for_what_is_about_to_be_heard`, `test_lesser_work_stops_for_a_request`. Imminent seam: `tests/test_requests.py::test_request_waits_past_protected_audio_and_checks_return_to_mix`, `tests/test_request_routes.py::test_with_no_time_left_it_is_left_to_fade`, `test_going_past_the_way_out_makes_another_further_on`. Run 2026-11-11: 167 passed. |
| T0193 | yes | Done | ADR-0015 Decision status reads Accepted (owner, 2026-11-08, #37). Original request tests re-run 2026-11-11: `tests/test_requests.py`, `tests/test_request_routes.py`, `tests/test_requests_together.py`, `tests/test_request_planner.py` all pass (in a 167-passed run with the export tests). |

## [ADR-0016](adr-0016-stem-studio.md)

Acceptance criteria:

- All cells on/off, rapid click, solo, all presets, AI unchanged/error, restore, close dirty, reopen, touch and assistive tech.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0194 | yes | Done | `web/src/views/Studio.tsx`, `tests/test_studio.py`. |
| T0195 | yes | Done | `web/src/views/Studio.tsx`. |
| T0196 | yes | Done | New `web/src/s2StemDeck.test.ts`: a toggled cell sets that stem's gain at the current AudioContext time (8 ms edge) with no network call, and solo plays one stem alone then un-solo restores the grid (`web/src/studio.ts` StemDeck). UI path: `web/src/views/Studio.test.tsx` (`tapping a square is heard straight away and renders nothing`, `pressing a name plays only that part`). Vitest 2026-11-11: 9 passed with s2Steering. |
| T0197 | yes | Done | `web/src/views/Studio.test.tsx`. |
| T0198 | yes | Done | `tests/test_studio.py`, `Studio.test.tsx`. |
| T0199 | yes | Done | `savedShape` and `keepShape` in `Studio.tsx`. |
| T0200 | yes | Done | `tests/test_studio.py`. |
| T0201 | no | Needs a person | open |
| T0202 | yes | Done | The owner accepted ADR-0016 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0017](adr-0017-library-scale-and-readiness.md)

Acceptance criteria:

- 20k songs, 200+ search results, duplicate titles, Unicode, search races, background arrival, corrupted metadata and file deletion.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0203 | yes | Done | `readiness_of`, `tests/test_api_contracts.py`. |
| T0204 | yes | Done | `web/src/views/Library.tsx`. |
| T0205 | yes | Done | `tests/test_library_edges.py`: 20,000 songs all reachable. |
| T0206 | yes | Done | `SongDetails` in `Library.tsx`. |
| T0207 | yes | Done | `web/src/views/Library.test.tsx`. |
| T0208 | yes | Done | Rows keyed by id. `tests/test_api_contracts.py`: a song arriving mid-way. |
| T0209 | yes | Done | `tests/test_library_edges.py`, `web/e2e/integration.e2e.ts`. |
| T0210 | yes | Done | The owner accepted ADR-0017 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0018](adr-0018-library-corrections-and-folders.md)

Acceptance criteria:

- Half/double tempo, invalid BPM, reanalysis conflict, lost folder, Unicode path, duplicate source and undo correction.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0211 | yes | Done | `/api/songs/{id}/correct`, `tests/test_api_contracts.py`. |
| T0212 | yes | Done | `song_overrides`, `tests/test_api_contracts.py`. |
| T0213 | yes | Done | `forget_song`, `tests/test_api_contracts.py`. |
| T0214 | yes | Done | `tests/test_api_contracts.py`. |
| T0215 | yes | Done | `FoldersPanel` in `Workshop.tsx`. |
| T0216 | no | Superseded | open |
| T0217 | yes | Done | Worker race and moved source: new `tests/test_s2_correction_races.py` (`test_corrections_and_a_racing_reanalysis_both_land_in_their_own_place` runs 40 corrections against a thread re-saving analysis; `test_a_correction_follows_its_recording_when_the_folder_moves` relinks a moved folder and keeps the correction). Half/double BPM, invalid key and hostile input: `tests/test_api_contracts.py` (`test_double_time_means_twice_the_beats_and_bars_that_still_line_up`, `test_half_time_means_half_the_beats_and_every_bar_still_exists`, `test_nonsense_is_refused_and_nothing_changes` incl. 13A, 8C and a script tag). Unicode and odd paths: `tests/test_library_edges.py`, `tests/test_s4_folder_input.py`, `tests/test_folder_relink.py`. Run 2026-11-11: 59 passed 1 skipped, plus 8 passed. |
| T0218 | yes | Done | The owner accepted ADR-0018 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0019](adr-0019-discover-words-and-harmony.md)

Acceptance criteria:

- Missing lyrics, many phrase matches, failed preview, partial pair insertion, draft selection, stage skipping and answer revision.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0219 | yes | Done | `web/src/views/Links.tsx`. |
| T0220 | yes | Done | `web/src/views/Links.test.tsx`. |
| T0221 | yes | Done | `Links.tsx`, `tests/test_discovery_sequence.py`. |
| T0222 | yes | Done | `Links.tsx`, `tests/test_discovery_sequence.py`. |
| T0223 | yes | Done | `/api/mix/pair`, the destination menu in `Links.tsx`. |
| T0224 | yes | Done | `/api/mix/pair` is all or nothing. Previews go through `audio/focus.ts`. |
| T0225 | yes | Done | Missing lyric timing, same word many times, duplicate songs: new `tests/test_s2_word_edges.py` (3 passed 2026-11-11). Failed render and stage skip: `web/src/views/Links.test.tsx` (`says so when a pair cannot be played, and you can still answer`, `lets you jump to any step`, `never plays an obsolete prepared audition after the user skips that pair`, `never calls a requested harmonic stage playing until the media element starts`); Links + LinksRating vitest 25 passed 2026-11-11. |
| T0226 | yes | Done | The owner accepted ADR-0019 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0020](adr-0020-workshop-and-storage.md)

Acceptance criteria:

- Cache full, low disk, preempted analysis, missing source, stale storage update, absent ETA and worker crash.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0227 | yes | Done | `web/src/views/Workshop.tsx`. |
| T0228 | yes | Done | `Workshop.tsx`, `tests/test_eta.py`, `tests/test_api_contracts.py`. |
| T0229 | yes | Done | `StoragePanel` in `Workshop.tsx`. |
| T0230 | yes | Done | `JobsPanel`, `/api/jobs`. |
| T0231 | yes | Done | `Workshop.tsx`. |
| T0232 | yes | Done | `saves` in `StoragePanel`, showing what was really saved. |
| T0233 | yes | Done | New `tests/test_s2_workshop_edges.py`: low disk clamps the limit to what the drive holds, old or broken stem `window.json` and old `storage.json` are counted and pruned without failing, a priority song whose file is missing doesn't pin other stems, and a stale budget write never outlives the last one across a restart. New `web/src/views/s2WorkshopStorage.test.tsx`: a slow older write is serialised and can't overwrite the newer limit. Paused worker: `tests/test_api_contracts.py::test_a_pause_is_remembered_across_a_restart`, `tests/test_request_routes.py::test_a_new_song_respects_analysis_being_paused`. Render contention: `tests/test_mix_mixes.py::test_the_mix_goes_ahead_of_everything_but_what_is_about_to_be_heard`, `test_a_mix_seam_only_gives_way_to_what_is_about_to_be_heard`, `test_spare_time_work_gives_way_to_the_mix`. Missing source: `tests/test_stem_windows.py::test_a_song_that_has_moved_counts_as_not_split_and_breaks_nothing`. Run 2026-11-11: pytest 18 passed; vitest s2WorkshopStorage + Workshop 13 passed. |
| T0234 | yes | Done | The owner accepted ADR-0020 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0021](adr-0021-blind-listening.md)

Acceptance criteria:

- Audio unavailable, save fails, refresh mid-trial, duplicate submit, screen reader, last trial and invalid study.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0235 | yes | Done | `web/src/views/Listening.tsx`, `tests/test_listening.py`. |
| T0236 | yes | Done | `web/src/views/Listening.tsx`. |
| T0237 | yes | Done | Checkboxes in `Listening.tsx`. |
| T0238 | yes | Done | `usePreview`, and the page shows only A and B. |
| T0239 | yes | Done | `x-operation-id` in `Listening.tsx`, `tests/test_listening.py`. |
| T0240 | yes | Done | none linked |
| T0241 | yes | Done | `web/src/views/ListeningStudyFlow.test.tsx` (5 tests, blind listening study, start to finish): missing clip with cannot-judge, refresh part way restoring the same comparison, double submit stored once, keyboard alone to the end, finishing saves each once and says complete. Passed 2026-11-10 (vitest). |
| T0242 | yes | Done | The owner accepted ADR-0021 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0022](adr-0022-flac-export.md)

Acceptance criteria:

- All seams ready, partly ready, corrupt seam, disk full, switch draft, stale URL and decode-verify downloaded FLAC.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0177 | yes | Done | `web/src/views/ExportPanel.tsx`. |
| T0178 | yes | Done | `web/src/views/ExportPanel.tsx`. |
| T0179 | yes | Done | `web/e2e/flows.e2e.ts`: the link gives a real FLAC. |
| T0180 | yes | Done | `ExportPanel.tsx` stops if the order changes, and the server refuses it. `web/e2e/integration.e2e.ts`. |
| T0181 | yes | Done | Partial seam and stale URL: `tests/test_s2_export_edges.py` (`test_a_partly_rendered_mix_waits_and_writes_no_file`, `test_a_ready_file_that_has_gone_is_shown_expired_and_its_link_is_refused`, `test_a_download_link_cannot_reach_outside_the_exports_folder`). Disk full before and mid-write, failed render and retry: `tests/test_flow_export_jobs.py` (`test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot`, `test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically`, `test_a_failed_transition_names_the_pair_and_the_job_says_failed`), `tests/test_export_retry.py`. Playable FLAC decode: `tests/test_export_validation.py::test_complete_export_is_decoded_frame_by_frame`. Run 2026-11-11 with the request tests: 167 passed. |
| T0182 | yes | Done | The owner accepted ADR-0022 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0023](adr-0023-accessibility.md)

Acceptance criteria:

- NVDA, VoiceOver, keyboard-only, high contrast, 200/400% zoom, reduced motion, touch sizes and ARIA grid.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0038 | no | Needs a person | open |
| T0039 | yes | Done | `web/src/shell/Shell.test.tsx`, `web/e2e/listen.e2e.ts`. |
| T0040 | yes | Done | none linked |
| T0041 | yes | Done | `LiveRegion` and `announce` in `web/src/ui/controls.tsx`. |
| T0042 | yes | Done | `web/e2e/flows.e2e.ts`: focus never hidden behind the bottom bar. |
| T0043 | yes | Done | Written page-by-page audit in `docs/engineering/form-validation-audit.md`: every form's validation, error copy, field wiring, non-colour state and reduced motion. Four gaps found and fixed: My Mixes rename (`views/Drafts.tsx`), Listening study code (`views/Listening.tsx`), Lucy limits and spending cap (`views/LucySettings.tsx`) and the storage limit slider (`views/WorkshopPanels.tsx`) were marked or shown invalid without the reason tied to the field. `web/src/views/formValidationAudit.test.tsx` (5 tests) covers each fix and fails on any `aria-invalid` without `aria-describedby`. Passed 2026-11-11 (vitest: 46 passed with the Drafts, study, Workshop and Lucy view tests; 27 more in Listening and Workshop tests). |
| T0044 | no | Needs a person | open |
| T0045 | yes | Done | The owner accepted ADR-0023 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0024](adr-0024-responsive-workspaces.md)

Acceptance criteria:

- 320,375,390,430,768,1024,1440,1920 and 4K; landscape, virtual keyboard, zoom 400%, long RTL names.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0054 | yes | Done | `web/e2e/pages.e2e.ts` from 320px to 4K. Safe areas use `env()` in tokens. |
| T0055 | yes | Done | `--bottom-chrome` in tokens, `web/e2e/flows.e2e.ts`. |
| T0056 | yes | Done | `web/src/views/Mix.tsx`: inspector beside the timeline, or a sheet. |
| T0057 | yes | Done | `web/src/views/Studio.tsx`, with its roving grid. |
| T0058 | yes | Done | `web/src/views/Library.tsx`. Song names use `unicode-bidi: plaintext`. |
| T0059 | no | Needs a person | open |
| T0060 | no | Needs a person | open |

## [ADR-0025](adr-0025-local-privacy.md)

Acceptance criteria:

- Cross-origin POST rejection, Host validation, path traversal, script-bearing metadata, optional diagnostics and offline limitations.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0084 | yes | Done | `tests/test_api_contracts.py`: other hosts and sites refused. |
| T0085 | yes | Done | `tests/test_api_contracts.py` on real addresses. Audio is served by id only. |
| T0086 | yes | Done | `web/e2e/pages.e2e.ts`: the page only talks to this computer. |
| T0087 | yes | Done | React escaping, and `tests/test_library_edges.py` with a script tag as a title. |
| T0088 | yes | Done | `tests/test_api_contracts.py`: setting aside and stop-watching touch no files. |
| T0089 | yes | Done | `tests/test_api_contracts.py`, `flows.e2e.ts`. |
| T0090 | yes | Done | `web/e2e/pages.e2e.ts`, `tests/test_api_contracts.py`. |
| T0091 | yes | Done | The owner accepted ADR-0025 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0026](adr-0026-api-compatibility.md)

Acceptance criteria:

- Old/new payloads, unknown fields, stale revision, duplicate operation, atomic failure and missing backend.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0075 | yes | Done | `tests/fixtures/api_contracts_baseline.json` records all 73 routes of the pre-redesign server (main `911c981`, read from its `src/selecta/api.py`) and the response shape of 13 read routes (`/api/status`, `/api/storage`, `/api/songs`, `/api/songs/1`, `/api/mix`, `/api/drafts`, `/api/requests`, `/api/discoveries`, `/api/memory`, `/api/memory/ratings`, `/api/links`, `/api/vibes`, `/api/listening`). `tests/test_api_contract_fixtures.py` (15 tests: every old route still offered, each read still matching its recorded shape, and the shape check itself) fails on a removed route, removed field or changed type while allowing additions. Passed 2026-11-11 (pytest, 15 passed). |
| T0076 | yes | Done | `problemKind` in `api.ts`, `status.api` from the server. |
| T0077 | yes | Done | `readiness` on `/api/library`, tested in `tests/test_api_contracts.py`. |
| T0078 | yes | Done | `/api/library`, tested in `tests/test_api_contracts.py`. |
| T0079 | yes | Done | `x-operation-id` and `x-mix-order`, including repeats sent at the same moment. |
| T0080 | yes | Done | `/api/mix/pair`, tested in `tests/test_api_contracts.py`. |
| T0081 | yes | Done | `/api/jobs`, and each seam's `why` and `tried`. |
| T0082 | yes | Done | `tests/test_api_contracts.py`, `tests/test_library_edges.py`. |
| T0083 | yes | Done | The owner accepted ADR-0026 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0027](adr-0027-explanations-and-feedback.md)

Acceptance criteria:

- Missing factor data, failed fallback, low-confidence match, late ETA, stale rating and accessibility announcements.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0130 | yes | Done | `seamFacts`, status labels in `Requests.tsx`. |
| T0131 | yes | Done | `WhyThisTransition` in `Now.tsx`, from the render's own record. |
| T0132 | yes | Done | Rating goes by seam key, `web/e2e/listen.e2e.ts`. |
| T0133 | yes | Done | Requested versus achieved energy in `Mixes.tsx`, reasons on requests and moves. |
| T0134 | yes | Done | none linked |
| T0135 | no | Needs a person | open |
| T0136 | yes | Done | The owner accepted ADR-0027 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0028](adr-0028-recovery-and-multitab.md)

Acceptance criteria:

- Server stop/restart during export, stale request poll, two windows, memory tab suspension, retry after timeout and malformed JSON.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0092 | yes | Done | `problemKind` in `api.ts`. |
| T0093 | yes | Done | `web/e2e/flows.e2e.ts`: what's on screen stays when the server goes. |
| T0094 | yes | Done | Policy, built 2026-11-11 in `web/src/api.ts`: every `post()` change carries an operation id (a page's own id is kept; otherwise `newOperationId()` makes one), and a change that got no answer at all (server stopped, restarting or connection dropped) is resent with the same id after 0.5 s and 1.5 s before saying `OFFLINE_WORDS`; an answer of any kind (a refusal, an error) is never resent, and reads keep their 20 s deadline. The server keeps the first answer to each operation on disk (`src/selecta/operation_log.py`, from T0256), so a resend after a lost reply or a restart gets that answer instead of the change happening twice. Deletes are not resent automatically: they are idempotent (a request or draft already gone answers without harm) or, for mix rows, guarded by `x-mix-order`. Storage limit and steering settings also treat a retry that finds its own value as a success (`src/selecta/routes/system.py`). Tests run 2026-11-11: `web/src/mutationRecovery.test.ts` (5 passed: ids on every change, resend with the same id until the server is back, giving up in plain words, no resend of a refusal, reads and deletes not resent); `tests/test_restart_during_mutation.py`, `tests/test_restart_mid_work.py` and `tests/test_setting_conflicts.py` (16 passed); `src/apiFaults.test.ts`, `src/diagnosticsOperations.test.ts`, `src/gp-0263-offline.test.tsx` and the Library, Links, Requests, Drafts, Mix, LucyLx and Shell suites still pass (264 tests). Tests turn the resend pauses off in `web/src/test/setup.ts`. |
| T0095 | yes | Done | `state/tabs.ts`, `web/e2e/listen.e2e.ts`. |
| T0096 | yes | Done | Mix, seam and cue edits are refused with a message when the mix changed (`x-mix-order`, `src/selecta/api.py`, tested in `tests/test_api_contracts.py`), and requests answer 409 with a reason when they have already joined, been cancelled or lost their place (`src/selecta/routes/song_requests.py`). Settings, built 2026-11-11: `POST /api/storage` takes `expected_budget_bytes` and `POST /api/steer` takes `expected` for every setting it replaces outright (wordplay, flash, mix language, stems, energy arc, destination, length); a mismatch answers 409 `setting_changed` with the newer value (`src/selecta/routes/system.py`, `src/selecta/api_common.py`). Workspace storage (`web/src/views/WorkshopPanels.tsx`) and Mix setup (`web/src/views/MixSetup.tsx`) send what they last saw and, on a conflict, say so and show the newer value; nudges (more/less) and older pages that send nothing are unchanged. Tests run 2026-11-11: `tests/test_setting_conflicts.py` (8 passed), `web/src/views/settingConflicts.test.tsx` (3 passed), and the existing storage and steering suites (`Workshop`, `sfFlowWorkspace`, `polishWorkshopShowcase`, `s2WorkshopStorage`, `MixSetup`, `s2Steering`, `s4Destination`: all passing; `Mixes.test.tsx` 'five-stop energy arc' fails from the separate SF-0243 draw-until-release change, not this). |
| T0097 | no | Partly | open |
| T0098 | yes | Done | The owner accepted ADR-0028 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0029](adr-0029-testing-and-quality.md)

Acceptance criteria:

- Long libraries, 100-song timeline, missing metadata, concurrent requests, late seam, full disk, keyboard, 400% zoom and export decode.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0008 | yes | Done | Pre-redesign baseline main `911c981` failed 5 stale tests, fixed here. Green `test` run 42899772224 on main `14b9709` (2026-11-10): Windows pytest shards with coverage, the `verify` gate `coverage report --fail-under=70`, ruff, `pnpm test`, and `pnpm build` (Web job and Windows Edge E2E jobs) all passed. Checked 2026-11-11 with `gh run view 42899772224`. |
| T0009 | yes | Done | `docs/adr/test-parity-inventory.json` lists all 263 component and player tests from the pre-redesign baseline `911c981` (App, api, lib, player and every view test), each mapped to the `feature-parity.md` row its assertions protect, and kept verbatim, moved to another file, or replaced by a named current test (15 replaced, such as the global busy heuristic now covered by `ui/controls.test.tsx`). `tests/test_parity_inventory.py` (3 tests) fails if a row or test disappears. Passed 2026-11-11 (pytest, with `test_file_length.py`: 6 passed). |
| T0010 | yes | Done | `tests/audio_fixtures.py` builds original, seeded synth audio (no real or licensed music): a steady grid, a drifting grid, named invalid grids (too few, empty, spurious off-beats, missing beats), cue positions on known downbeats plus an off-grid time, and a 120/85 BPM pair that forces a fallback seam. `tests/test_audio_fixtures.py` (6 tests) proves determinism, exact grid fit, rejection or repair of each invalid grid, cues landing on bars, and the fallback rendering playable audio. Writing it found a bug in `regularize` (`src/selecta/analysis/beats.py`): a gap of 3+ beats was filled with doubled spacing; fixed. Passed 2026-11-11 (pytest with `tests/test_analysis.py`: 16 passed, 1 skipped). |
| T0011 | yes | Done | `tests/e2e_server.py` and `tests/test_library_edges.py`: empty, duplicates, Unicode and RTL, wrong tempo, missing files. |
| T0012 | yes | Done | `web/src/test/operations.ts` holds render, request, stem and export fixtures for all six states (pending, ready, failed, canceled, stale, storage-blocked); `web/src/test/operations.test.ts` (7 tests, operation fixtures (T0012)) checks each one means what its name says. Passed 2026-11-10 (vitest). |
| T0013 | yes | Done | Playwright harness in `web/e2e` (Edge, `tests/e2e_server.py` synthesised library). `web/e2e/harness.ts` adds the shared deterministic clock (`fixClock`, Playwright `page.clock` frozen at a known moment) and network failure injection (`failNetwork`: offline, server 500, full disk 507 `storage_full`, never-answered). `web/e2e/harness.e2e.ts` (3 tests) proves the clock only moves when a spec moves it, a lost connection is noticed and recovered from on the fake clock, and server and storage failures reach the page as what they are. Passed 2026-11-11 (Playwright, 3 passed). |
| T0014 | no | Needs a person | open |
| T0015 | yes | Done | `docs/listening-procedure.md`. |
| T0016 | yes | Done | `docs/adr/test-coverage-matrix.md`. |
| T0017 | no | Needs a person | open |
| T0259 | yes | Done | none linked |
| T0260 | yes | Done | none linked |
| T0261 | no | Partly | open |
| T0262 | no | Needs a person | open |
| T0263 | no | Partly | open |
| T0264 | no | Needs a person | open |
| T0265 | no | Partly | open |
| T0266 | no | Needs a person | open |
| T0267 | no | Needs a person | open |
| T0268 | yes | Done | `tests/test_api_contracts.py`, `web/e2e/pages.e2e.ts`. |
| T0269 | yes | Done | `src/selecta/audit/adr_acceptance.py` links each ADR's own criteria to its tasks' proof in `docs/adr/selecta-2-acceptance-audit.md` and refuses Verified without it; `tests/test_adr_acceptance_audit.py` passed 2026-11-12. |
| T0270 | yes | Done | `docs/adr/` updated in this PR. |

## [ADR-0030](adr-0030-migration-and-release.md)

Acceptance criteria:

- Cross-feature playback/edit/request/studio sequence, old data migration, PWA routing, CI, a11y, security and manual listening.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0018 | no | Needs a person | open |
| T0019 | yes | Done | none linked |
| T0020 | yes | Done | Backend additions only add routes, fields and one table. `status.api.features` advertises them. |
| T0021 | yes | Done | The protocol (decision status separate from not-started/in-progress/implemented/verified) is ADR-0030's governance rule and `docs/adr/README.md`; the owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`). Re-checked 2026-11-10. |
| T0022 | yes | Done | The owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. The data invariant (source music, drafts, ratings and preferences survive) is ADR-0030's own compatibility rule. |
| T0250 | yes | Done | `web/e2e/integration.e2e.ts`. |
| T0251 | no | Partly | open |
| T0252 | yes | Done | Server: `tests/test_cue_change_during_render.py` (2 passed 2026-11-11). `test_a_cue_moved_while_the_old_render_finishes_never_plays_the_old_one`: a seam renders, the person moves its exit cue mid-render, the mix reports the new choice not ready (so the fallback plays), the old render finishing stays the old choice's and is never offered as the new one, and when the new one renders with a substitute move the settings (asked: echo out) and state (made: blend) stay side by side. `test_moving_the_cue_back_picks_the_old_render_up_again` covers going back. Page: `web/src/ui/seamCueChange.test.ts` (3 passed) checks `seamFacts` says planned/queued/rendering until then and "Blend will play, because Echo out wouldn't work here" after. Fallback playing in a real browser: `a transition that isn't ready doesn't stop the music` in `web/e2e/listen.e2e.ts`, passed in Edge 2026-11-11. |
| T0253 | no | Needs a person | open |
| T0254 | yes | Done | `web/e2e/integration.e2e.ts`. |
| T0255 | yes | Done | `tests/test_correction_during_watch.py` (2 passed 2026-11-11): `test_a_correction_survives_analysis_finishing_and_new_files_arriving` corrects a song still being analysed, saves its finished analysis afterwards and runs the folder watch's check (`/api/library/check`) that finds two new files; the correction wins, the measured tempo and key stay beside it, the new songs arrive with no override and other songs are untouched. `test_a_correction_made_after_the_new_files_arrive_lands_on_the_right_song` covers the other order. A correction with the page open is in `web/e2e/integration.e2e.ts`. |
| T0256 | yes | Done | A real restart mid-change exposed a gap: operation answers were only kept in memory, so a retry after a restart made a second draft. New `src/selecta/operation_log.py` (`FinishedOperations`, used by `same_operation_once` in `src/selecta/api.py`) keeps each first answer as a small file in `<home>/operations`, newest few hundred only. `tests/test_restart_during_mutation.py` (4 passed 2026-11-11): a draft created, the server rebuilt on the same data folder, the retry gets the first answer and only one draft exists; a different change still can't borrow the id after the restart; a guarded mix add retried after a restart is not applied twice; old answers are pruned. With `test_flag_server.py`, `test_operation_identity.py`, `test_export_retry.py`: 70 passed; `test_local_backup.py`, `test_upgrade.py`: 24 passed. Two-tab takeover: `only one tab plays at a time` in `web/e2e/listen.e2e.ts` passed in a slot-locked Edge run on 2026-11-11 (14 of 17 in that file passed). |
| T0257 | yes | Done | `docs/adr/feature-parity.md`, `web/e2e/pages.e2e.ts`. |
| T0258 | no | Needs a person | open |
| T0271 | yes | Done | `tests/test_upgrade.py`: a copy of the folder brings back mixes, drafts, settings and corrections. |
| T0272 | yes | Done | `tests/test_upgrade.py` opens an older library. Going back to `911c981` and forward again is recorded in `docs/acceptance.md`. |
| T0273 | yes | Done | Rehearsed 2026-11-11 with `tests/rollback_check.py` against pre-overhaul `911c981` (its `src` extracted with `git archive` into a scratch folder, made-up library only). The check now rates two seams Good and Bad through `/api/seams/{key}/rate` and reads them back via `/api/memory` and `seam-history`: this checkout, the older one and this one again all saw liked 1, disliked 1, the same mix, draft, settings, request and seam setting; this checkout again saw exactly what it saw first, including the export job file and the tempo correction. Known older limits it prints: no export jobs, and it ignores the tempo correction while it runs (as `docs/acceptance.md` records). Result "nothing lost", exit 0. Frontend routing: the server serves whichever `index.html` is deployed for every app address (`test_reloading_any_page_gets_the_app`, `test_anything_else_is_really_not_found`, passed 2026-11-11), so putting the older build back in `web/dist` keeps every bookmarked address opening. |
| T0274 | no | Needs a person | open |
| T0275 | no | Needs a person | open |
| T0276 | no | Needs a person | open |
| T0277 | no | Needs a person | open |
| T0278 | no | Partly | open |
| T0279 | no | Needs a person | open |

## [ADR-0031](adr-0031-pwa-and-browsers.md)

Acceptance criteria:

- Standalone refresh, missing backend, browser autoplay, media keys, fullscreen denial, cache and safe-area layouts.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0061 | no | Needs a person | open |
| T0062 | no | Needs a person | open |
| T0063 | yes | Done | `App.tsx` checks Media Session and fullscreen. `state/tabs.ts` checks BroadcastChannel. |
| T0064 | yes | Done | none linked |
| T0065 | no | Needs a person | open |
| T0066 | yes | Done | The owner accepted ADR-0031 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## [ADR-0032](adr-0032-diagnostics-and-operations.md)

Acceptance criteria:

- Offline, worker crash, stale ETA, storage block, privacy redaction and low-end machine render contention.

| Task | Ticked | Ledger status | Proof |
|---|---|---|---|
| T0243 | yes | Done | `JobsPanel`, `/api/jobs`. |
| T0244 | yes | Done | `src/selecta/api.py` echoes a page-made operation id (only the safe `kind-random` shape) on the response and lists it beside its status and repeat flag in `/api/diagnostics` `recent_operations`; `web/src/api.ts` puts it on `ApiError.operation`; `safeDiagnostics` in `web/src/views/WorkshopPanels.tsx` keeps it when copied. `tests/test_diagnostics_operations.py` (5) with `tests/test_operation_identity.py` and the `test_api_contracts.py` operation/diagnostics tests: 23 passed; `web/src/diagnosticsOperations.test.ts` with `Workshop.test.tsx` and `ListeningStudyFlow.test.tsx`: 22 passed, 2026-11-11. |
| T0245 | yes | Done | `JobsPanel`, and estimates are labelled. |
| T0246 | yes | Done | `tests/test_api_contracts.py`, `web/e2e/flows.e2e.ts`. |
| T0247 | yes | Done | Only runs when asked. `web/e2e/pages.e2e.ts` shows nothing leaves this computer. |
| T0248 | yes | Done | Redaction: `test_an_operation_id_that_could_carry_a_path_is_neither_echoed_nor_listed`, `test_diagnostics_have_no_paths_or_song_names`, and the `safeDiagnostics` drop test. Worker restart: `test_diagnostics_and_jobs_follow_a_worker_that_stops_and_restarts`. Slow status: `a status read that never answers gives up after 20 seconds` in `web/src/diagnosticsOperations.test.ts`. Storage block: `test_jobs_say_when_the_storage_limit_blocks_work`. Correlation: `test_an_operation_id_links_the_request_to_its_outcome_and_its_replay`, `test_a_refused_operation_is_correlated_too`. 23 pytest and 22 vitest passed 2026-11-11. |
| T0249 | yes | Done | The owner accepted ADR-0032 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |
