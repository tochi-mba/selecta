# Selecta 3.1 - finishing implementation and independent verification ledger

- **Date:** 2026-11-07, statuses updated 2026-11-11.
- **Programme decisions:** 11 Accepted by the owner (ADR-0078-0088, `73bd72a`).
- **Implementation:** PR #25 merged as `6d78cf4` on 2026-11-07. 70 Implemented, 34 partly implemented, 10 need a person, 2 not started; **0/116 Verified**.
- **Scope:** PR #25 began as docs only and ended with frontend changes, one server fix (export job files on Windows), browser and unit tests, a FLAC content check, a scale harness and a rollback check. No schema or audio-engine changes. Baseline `main` is `3b01dc1336aab0f1cb0a4d85be5eba359de81831`.
- **Important historical distinction:** PR #24 is **merged**. The earlier 3.0 ledger still records it as in progress/open and 0 merged; that is a stale planning snapshot requiring item-by-item reconciliation, **not** a basis for retroactively marking any S3 item complete.
- **Evidence available:** the tests named below, run in CI on Windows with Edge; [measurements](selecta-3-1-measurements.md) from one PC; review images from the synthetic library. Green CI on PR #25's own heads: `c1f9400` passed in full; the merged head `ea47848` failed lint (long lines) and one Library browser test, both fixed later on main, where `c3fb6d3` passed. Nothing here is a person's judgement of sound, comprehension or assistive technology.

## Individual ADR status

| ADR | Decision | Implementation | Verified | Workstream |
|---|---|---|---:|---|
| [ADR-0078](adr-0078-baseline-evidence-and-governance.md) | Accepted | 5 implemented, 2 partly implemented, 2 need a person, 1 not started | 0/10 | Reconcile the shipped 3.0 baseline and govern finishing work |
| [ADR-0079](adr-0079-visual-system-and-css-ownership.md) | Accepted | 1 implemented, 7 partly implemented, 1 needs a person, 1 not started | 0/10 | Unify typography, themes, visual rhythm and CSS ownership |
| [ADR-0080](adr-0080-interaction-state-recovery-and-undo.md) | Accepted | 8 implemented, 2 partly implemented | 0/10 | Make controls, asynchronous states, recovery and Undo dependable |
| [ADR-0081](adr-0081-first-run-explore-and-mix-choice.md) | Accepted | 8 implemented, 2 need a person | 0/10 | Reduce friction from first music folder to a confident first mix |
| [ADR-0082](adr-0082-listen-shell-stage-and-audio-trust.md) | Accepted | 6 implemented, 5 partly implemented | 0/11 | Polish Listen, navigation, mini-player and Stage without audio regressions |
| [ADR-0083](adr-0083-mixes-editor-inspector-and-export.md) | Accepted | 10 implemented, 2 partly implemented | 0/12 | Make drafts, timeline editing, transition intent and export unambiguous |
| [ADR-0084](adr-0084-stem-studio-workstation-polish.md) | Accepted | 5 implemented, 4 partly implemented | 0/9 | Refine Stem Studio's expert controls without reducing capability |
| [ADR-0085](adr-0085-requests-and-music-discovery.md) | Accepted | 8 implemented, 2 partly implemented | 0/10 | Clarify Requests, consented bridges and discovery auditions |
| [ADR-0086](adr-0086-library-workspace-study-and-operational-trust.md) | Accepted | 8 implemented, 3 partly implemented | 0/11 | Polish Library, Workspace, studies and operational status |
| [ADR-0087](adr-0087-accessibility-responsive-and-performance-gates.md) | Accepted | 5 implemented, 5 partly implemented, 1 needs a person | 0/11 | Verify WCAG, device reflow, audio latency and scale |
| [ADR-0088](adr-0088-research-visual-regression-and-release.md) | Accepted | 6 implemented, 2 partly implemented, 4 need a person | 0/12 | Require observable user, visual and product acceptance before release |
| **Total** | 11 accepted | 70 implemented, 34 partly, 10 need a person, 2 not started | **0/116** | |

## Task status

Implemented means merged code with automated evidence on main. Partly implemented names what is missing. Needs a person means the acceptance is a human, owner, device or listening check that no test can stand in for. No row is Verified, and every checkbox in the checklist stays empty.

| Task | Status | Evidence on main | Still needed |
|---|---|---|---|
| S31-0078-01 Pin baseline to actual 3.0 merge and current release head | Implemented | This ledger and [measurements](selecta-3-1-measurements.md) name base `3b01dc1`, PR #25 merge `6d78cf4`, Windows 11 10.0.26300, Edge 156.0.4314.58, i7-10510U, and the PWA boundary | Owner review |
| S31-0078-02 Reconcile the 258 inherited S3 IDs with merged code and CI | Not started | Not done. The 258 S3 IDs are still unreconciled | Per-ID mapping to code, tests or unresolved |
| S31-0078-03 Inventory every destination, subview, overlay and always-on surface | Implemented | [Inventory](selecta-3-1-surface-inventory.md); every route in `PAGES` is visited by the reflow, axe, Tab and layout-shift tests; dialogs by axe and focus tests | Owner sign-off |
| S31-0078-04 Build the state coverage matrix for each surface | Partly implemented | Exercised by tests: slow loading on every page, empty, no results, server gone, server back, first-run stages; captured as review images | A written state-by-surface table |
| S31-0078-05 Capture deterministic light/dark screenshots of the real built app | Implemented | `visual.e2e.ts` captures 19 states at 320/375/1280/1440 px, light and dark, from the synthetic library only; CI uploads them | Owner review of the images |
| S31-0078-06 Run baseline core-task scripts without coaching participants | Needs a person | Not run | Unassisted participant sessions |
| S31-0078-07 Create a risk-ranked finding record | Implemented | [Findings register](#findings-register) below: 15 found, ranked, each with its test | Owner disposition of open P2s |
| S31-0078-08 Define non-regression comparisons against current behaviour | Partly implemented | Every fix has a test that fails on the code before it (checked by running the old code) | A written expectation per change |
| S31-0078-09 Record decision, implementation and verification status independently | Implemented | This ledger keeps decision, implementation and verification apart | Owner review |
| S31-0078-10 Approve and freeze the scope and baseline before implementation | Needs a person | Owner accepted the ADRs (`73bd72a`); scope freeze and priority sign-off not recorded | Owner sign-off |
| S31-0079-01 Approve visual hierarchy for page, song, metadata and technical values | Partly implemented | Type tokens in `tokens.css`; long, RTL and duplicate names checked at 320 px | Owner approval of the scale |
| S31-0079-02 Specify semantic colour role mapping for both themes | Partly implemented | axe colour contrast passes on 14 pages and 4 dialogs, both themes, 1440 and 375 px | A written role map |
| S31-0079-03 Audit existing CSS cascade and overlapping selectors | Partly implemented | Duplicated globals moved to `tokens.css` (`6e0c618`) | Full selector ownership map |
| S31-0079-04 Standardize spacing, gutters, radii, separators and depth | Not started | Not reviewed beyond the screenshots | Spacing review |
| S31-0079-05 Standardize SVG icon dimensions, stroke and accessible names | Partly implemented | One icon set; axe finds no unnamed controls; Request no longer uses the download glyph (`0f2a1f4`) | Alignment review |
| S31-0079-06 Review button, input, checkbox, tab, menu and status variants | Partly implemented | `ControlGallery` exists in development builds only | Review of every state in both themes |
| S31-0079-07 Review light/dark/system theme and first-paint transitions | Implemented | Tests: the chosen theme is set before any app JavaScript runs; title bar colour follows; switching while playing starts no sound again | Owner review |
| S31-0079-08 Audit visible numerical values and truncation | Partly implemented | Library rows no longer shift when Add becomes In the mix (`0f2a1f4`) | Audit of every number on screen |
| S31-0079-09 Review screen composition at every density and content width | Partly implemented | 68 screenshots reviewed at 1280 and 375 px; fixed the phone editor's wall of actions, the four-line energy arc button, the short Requests list | Owner review; open P2s below |
| S31-0079-10 Approve visual regression fixtures and change-review rules | Needs a person | Candidates only | Owner-approved baselines |
| S31-0080-01 Define shared initial/empty/partial/refresh/error/offline/recovery presentation rules | Partly implemented | Shared `Problem`, `Skeleton`, `Status`; one set of words for a stopped or failing server (`0f2a1f4`, `d7b3e4a`) | Written rules per state |
| S31-0080-02 Review skeleton geometry for every high-traffic content surface | Implemented | Test: with every answer 350 ms late, no page shifts more than 0.071 (worst: Workspace) | Owner review |
| S31-0080-03 Unify busy and duplicate-submit behaviour | Implemented | `Action` guards repeats; `waiting` blocks a neighbour without dropping focus; tests for steering, pair answers and Start | Studio and Library still use real `disabled` while busy (open P2) |
| S31-0080-04 Audit global toast, Activity and scoped Undo lifetimes | Implemented | Scope-blocking Undo tests; Activity only marks something undone when the server undid it (`0f2a1f4`, untested) | A test for the nothing-to-undo case |
| S31-0080-05 Review all dialog, drawer, sheet, menu and tooltip focus paths | Implemented | Tests: dialogs return focus, nested Escape, Stage returns focus, Tab through every page at two widths with focus visible and never covered | Screen reader walkthrough |
| S31-0080-06 Audit stale-response reconciliation and persistent data survival | Implemented | Tests: slow seam change, stale search, late request poll, Library deep links, stale chord audition | Owner review |
| S31-0080-07 Make error text specific and actionable | Partly implemented | No raw `Failed to fetch` or `Internal Server Error` reaches the page (`0f2a1f4`, `d7b3e4a`) | A test for the server-failure words |
| S31-0080-08 Review command palette and shortcut discoverability | Implemented | Test: an unavailable command says why, works from the keyboard, and typed text can always search the Library | Owner review |
| S31-0080-09 Review accessible announcements for non-chattering progress | Implemented | Test: six seconds of playing says nothing with a clock in it and fewer than six changes | Screen reader confirmation |
| S31-0080-10 Test rapid user input while the server is slow or disconnected | Implemented | Tests: server stops answering (three), slow seam writes, slow search, bridge answers sent in order | Owner review |
| S31-0081-01 Review new-user entry and folder path guidance | Implemented | Tests: the LRCLIB disclosure is shown before anything is sent, nothing leaves this PC, no unasked focus | Comprehension, by a person |
| S31-0081-02 Design distinct source-check, scan, analysis and mix-ready states | Implemented | Test: scanning, cancelled, failed, nothing found and preparing each say so, from what the server reports | Owner review |
| S31-0081-03 Test invalid, absent, empty, permission-denied and unplugged folder outcomes | Implemented | Test against the real folder check: missing, a file, an empty folder; another can be tried at once and nothing is scanned | Permission-denied on a real locked folder |
| S31-0081-04 Establish a first-play call to action as soon as genuinely possible | Implemented | Existing tests: waits for six mix-ready songs, then offers Play | Owner review |
| S31-0081-05 Review featured mix hierarchy and mood card choice | Needs a person | Reviewed in screenshots only | Comprehension, by a person |
| S31-0081-06 Clarify Play, Edit first, Save as draft and replacing the current mix | Implemented | Replacing asks first, says what Undo and Save as draft do; existing tests | Comprehension, by a person |
| S31-0081-07 Review mix length, feel, stems, energy and destination customization | Implemented | Serialized steering writes and truthful failed save (`26b7621`, `1cb6ae1`); arc button layout (`0f2a1f4`) | Owner review |
| S31-0081-08 Review unavailable preset reasons and recovery paths | Implemented | Existing tests: each unavailable preset says how many songs it needs | Owner review |
| S31-0081-09 Test long/unicode/missing metadata and small/zoomed devices | Implemented | Tests: long, RTL and duplicate names at 320 px; nothing overflows from 320 to 3840 px or at maximum zoom | Owner review |
| S31-0081-10 Measure unassisted time-to-first-valid-play in representative tasks | Needs a person | Not run | Unassisted timing |
| S31-0082-01 Review primary hierarchy across Listen playing/paused/empty/error states | Partly implemented | Reviewed in both themes and widths | Listener tasks, by a person |
| S31-0082-02 Test Next versus Skip semantics and transition countdown wording | Partly implemented | Tooltips say Next goes straight on and N jumps to the transition; key tests | Comprehension, by a person |
| S31-0082-03 Verify waveform seek and disabled-seek feedback with real audio | Partly implemented | Existing seek tests check time and output agree | Audible check |
| S31-0082-04 Review timed/untimed/instrumental/missing lyrics presentation | Implemented | Unit tests for timed, untimed, instrumental and missing lyrics | Owner review |
| S31-0082-05 Review Spectrum, Beat countdown, Lyrics focus and Why disclosure | Implemented | Display options disclosure; it stays open across fullscreen (`0f2a1f4`); tests | Owner review |
| S31-0082-06 Review next-song, steering, rating and requests grouping | Implemented | Steering and rating wait without dropping focus (`417f36e`); tests | Comprehension, by a person |
| S31-0082-07 Re-test mini-player and bottom nav geometry at narrow widths | Implemented | Tests: mini-player and bottom bar at 320 to 430 px and landscape; nothing half under the phone player at 8 heights | Real phones and safe areas |
| S31-0082-08 Verify visual keyboard and focus changes on narrow screens | Partly implemented | With an on-screen keyboard up the bar and player give way (test sets what a phone would) | A real phone keyboard |
| S31-0082-09 Verify Stage fullscreen denial and exit fallbacks | Implemented | Test: fullscreen refused, lyrics fill the page, Escape out, focus back, the music never stops (`0f2a1f4`) | Owner review |
| S31-0082-10 Exercise main/preview/multi-tab audio ownership on real media | Partly implemented | Existing tests: a preview takes the sound and gives it back, one tab plays | Audible check |
| S31-0082-11 Review route, history, breadcrumbs and deep-link continuity | Implemented | Existing tests: reload, Back and Forward, old addresses | Owner review |
| S31-0083-01 Review My Mixes current/draft/render-line hierarchy | Partly implemented | Reviewed in screenshots | Comprehension, by a person |
| S31-0083-02 Test new, rename, copy, delete, restore and reorder drafts | Implemented | Existing draft tests: new, rename, copy, delete with Undo, play | Owner review |
| S31-0083-03 Review creator timeline hierarchy at 2, 20 and 100 songs | Partly implemented | 100 songs measured: first rows 1.0 s, 17 ms frames, 0.3 s per move | Visual review at 20 and 100 songs |
| S31-0083-04 Provide predictable non-drag reorder and insertion affordances | Implemented | Test: arrow keys reorder and focus stays on the moved song; buttons for pointer and touch | Touch on a real device |
| S31-0083-05 Review draft versus current editor headers and action copy | Implemented | Scope bar says whether a change reaches what's playing; existing draft-versus-current tests | Owner review |
| S31-0083-06 Audit Inspector Listen/Change/Studio/Details consistency | Implemented | Test: tabs move with arrows, Home and End, and the pair stays named | Owner review |
| S31-0083-07 Review transition cue, style, bar count and fallback presentation | Implemented | The chosen move stays pressed until the server has it, then follows the server, including after Undo (`417f36e`); tests | Owner review |
| S31-0083-08 Verify preview/rating/render failure and stale-request recovery | Implemented | Tests: two quick changes on a slow server, last wins; late render skipped (`30bc40d`) | Owner review |
| S31-0083-09 Review export scope, prerequisites and exact snapshot identity | Implemented | Existing and PR tests: exact scope and draft, first and last song named | Owner review |
| S31-0083-10 Review persistent export stages, errors, retries and download recovery | Implemented | Test: closing the panel, changing the mix and reloading lose nothing; Windows job-file race fixed (`0f2a1f4`) | Owner review |
| S31-0083-11 Test cross-mix concurrent edits, requests and Undo | Implemented | Existing integration tests: draft and current edited together, Undo knows which | Owner review |
| S31-0083-12 Verify actual FLAC decoding and authored track order | Implemented | Test decodes the saved FLAC: 240.5 s, 2 channels, all 4 songs found at 1.000 in order, a song not in the mix 0.51 | Listening, by a person |
| S31-0084-01 Review session identity and the A/B song context | Implemented | Numbered pair and both songs named (`e638458`); test | Owner review |
| S31-0084-02 Improve lane and square visual/readable semantics | Partly implemented | Pressed state, underline and forced-colours border, not colour alone | Review |
| S31-0084-03 Verify keyboard grid movement and entry/exit | Implemented | Unit test: one tab stop, arrows, Home, End, Ctrl+Home, Ctrl+End, edges stop; 320 px test reaches square 8 and toggles with Space | Owner review |
| S31-0084-04 Review solo, audition, shape preset and AI actions | Partly implemented | Existing unit tests for solo, presets and fine tuning | Audible check |
| S31-0084-05 Separate dirty, retained, saved, applying and rendered states | Implemented | Existing tests: retained edits recovered, nothing final until Apply, malformed drafts ignored | Owner review |
| S31-0084-06 Review missing stem, separation wait, stale pair and partial failure states | Partly implemented | Missing lanes are marked in code | A test for a missing stem |
| S31-0084-07 Review narrow layouts, horizontal pan and large-zoom access | Implemented | Test: all 64 squares at 320 px, the grid scrolls by itself, names stay in view | Owner review |
| S31-0084-08 Verify preview/main audio takeover and return behaviour | Partly implemented | Existing tests: pauses the mix, closing lets go of the sound | Audible check |
| S31-0084-09 Confirm guarded Apply and restoration after concurrent edit | Implemented | Unit test: a mix that moved on is refused with its order, and the shape stays to try again | Owner review |
| S31-0085-01 Review request search and duplicate/pre-existing choices | Implemented | Existing tests: requested, in the mix and bridge songs told apart; cancel | Owner review |
| S31-0085-02 Clarify waiting, preparing, ready, inserted, failed and cancelled states | Implemented | Existing tests for each stage and late updates | Owner review |
| S31-0085-03 Review bridge proposal consent and alternatives | Implemented | Approval shows every song and joins all or nothing; existing tests | Comprehension, by a person |
| S31-0085-04 Verify bridge atomicity and retry/rejection paths | Implemented | Existing tests: goes in as one thing; answers now reach the server in order and the last stands (`417f36e`) | Owner review |
| S31-0085-05 Test competing requests, cancellation and late poll recovery | Implemented | Existing integration tests: two at once, cancelled answered late | Owner review |
| S31-0085-06 Review Word connections candidate, preview and rating flow | Implemented | Existing Links tests; an older render can't replace a newer one (`4fea3ca`) | Owner review |
| S31-0085-07 Review four-stage harmonic listen and verdict flow | Implemented | Existing tests; a press while the page settles is no longer thrown away (`d7b3e4a`) | Owner review |
| S31-0085-08 Verify cross-page and preview audio ownership | Partly implemented | Existing tests: pauses the mix, stopping really stops | Audible check |
| S31-0085-09 Review empty/no-match/failed-render and unreadable metadata states | Implemented | Existing tests: nothing yet, can't load | Owner review |
| S31-0085-10 Test keyboard/touch accessibility for request drawer and discovery actions | Partly implemented | Tests: request and cancel by keyboard alone; answering a pair keeps focus (`d7b3e4a`) | Touch on a real device |
| S31-0086-01 Review Library search, sort, filters, density and URL/history state | Implemented | Existing tests: address holds search, filter and depth; Back restores it | Owner review |
| S31-0086-02 Rebalance library row title, artist, readiness and action hierarchy | Partly implemented | Row alignment fixed (`0f2a1f4`) | Review |
| S31-0086-03 Review large-result pagination and background refresh behaviour | Implemented | Existing tests; 20,000 songs measured: load more 0.4 s median | Owner review |
| S31-0086-04 Review track detail and manual tempo/key/exclusion controls | Implemented | Existing tests: correction saved, put back, survives analysis | Owner review |
| S31-0086-05 Audit readiness language across Library, Explore and Workspace | Partly implemented | Transition states now have one name everywhere (`0f2a1f4`); song readiness checked by eye on three pages | A cross-page test |
| S31-0086-06 Review Workspace overview attention, background jobs and storage | Implemented | Existing test: Workshop tells the truth about what's running | Owner review |
| S31-0086-07 Review watched-folder, scan-stop, drive loss and storage-limit recovery | Partly implemented | Folders show whether they can be found; scan stop tested | A drive pulled out for real |
| S31-0086-08 Review operational diagnostics and local privacy explanations | Implemented | Existing test: diagnostics hold nothing private; LRCLIB named in first run and Sources | Owner review |
| S31-0086-09 Review listening-study setup, progress, A/B answers and completion | Implemented | Existing tests: blinding, failed send retried | Owner review |
| S31-0086-10 Validate narrow/high-zoom, missing/duplicate/RTL song data | Implemented | Tests at 320 px and maximum zoom | Owner review |
| S31-0086-11 Measure real 20k-track Library scale and constrained hardware response | Implemented | [Measured](selecta-3-1-measurements.md) at 20,000 songs on this PC | Owner review |
| S31-0087-01 Approve platform, width, zoom, orientation and keyboard matrix | Implemented | Reflow test covers 320 to 3840 px, landscape and maximum zoom | Owner review |
| S31-0087-02 Run full keyboard-only tasks across core journeys | Implemented | Tab walker on 14 pages at 1280 and 375 px; grid, reorder, requests, palette and Stage by keyboard | A person doing whole tasks |
| S31-0087-03 Run manual supported screen-reader tasks with actual versions logged | Needs a person | NVDA is not installed on this PC; not run | NVDA with Edge, and VoiceOver or TalkBack if available |
| S31-0087-04 Verify WCAG 2.2 AA reflow, focus, contrast and target size | Partly implemented | axe WCAG 2.2 AA on 14 pages, 4 dialogs, both themes, two widths, all passing | Manual audit |
| S31-0087-05 Check reduced motion, colour-independent statuses and live announcements | Implemented | Tests: nothing animates forever with reduced motion; statuses carry a mark and words; announcements don't chatter | Owner review |
| S31-0087-06 Verify mobile player/nav/keyboard/safe-area geometry under short viewports | Implemented | Tests at 8 phone heights and landscape | Owner review |
| S31-0087-07 Measure user interactions during background render on real hardware | Partly implemented | Measured with 99 transitions queued to render: slowest input 120 ms | Audio timing during a render |
| S31-0087-08 Profile 20k Library, 100-song Edit and full Studio grid | Implemented | [Measured](selecta-3-1-measurements.md): 20,000-song Library, 100-song editor, 64-square Studio | Owner review |
| S31-0087-09 Verify media continuity across page, theme, Stage, audition and tabs | Partly implemented | Existing tests: page moves, previews and tabs leave the music alone | Audible check |
| S31-0087-10 Review PWA installed-mode startup and backend-unavailable recovery | Partly implemented | Manifest test; messages never claim offline playback | Installed-mode startup |
| S31-0087-11 Define evidence-backed performance and accessibility budgets | Partly implemented | [Baseline measured](selecta-3-1-measurements.md) | Owner approval of budgets |
| S31-0088-01 Create deterministic visual snapshot matrix for approved screen/state/theme fixtures | Implemented | 19 states at 4 sizes including empty, failed, recovered and first run | Owner approval |
| S31-0088-02 Require reviewed diffs rather than bulk baseline replacement | Needs a person | No baseline approved | Owner |
| S31-0088-03 Preserve all existing Python, frontend, audio and E2E assertions | Implemented | Only 4 copy assertions changed, to the clearer words; every suite green on `c3fb6d3` | Owner review |
| S31-0088-04 Run integrated stale/offline/duplicate/concurrent failure scenarios | Implemented | `finishing.e2e.ts`: 21 adverse browser tests against a real server | Owner review |
| S31-0088-05 Conduct unguided listener, creator and expert tasks | Needs a person | Not run | Unguided sessions |
| S31-0088-06 Run manual auditory transition and export review | Partly implemented | FLAC decoded and matched automatically | Listening, by a person |
| S31-0088-07 Audit each unresolved P0/P1/P2 issue and written disposition | Partly implemented | Findings register with dispositions | Owner sign-off |
| S31-0088-08 Verify rollback compatibility and preservation of local persisted state | Implemented | `tests/rollback_check.py`: 3.0 (`3b01dc1`) reads this build's draft, steering, seam choice, correction and export record identically, and back | Owner review |
| S31-0088-09 Update ADR decisions, task checklist and evidence ledger per implementing PR | Implemented | This update | Owner review |
| S31-0088-10 Measure goals against an approved, recorded baseline | Needs a person | Not run | Observed task data |
| S31-0088-11 Prepare a release-candidate report listing support and known limitations | Implemented | [Release report](selecta-3-1-release-readiness.md) updated | Owner review |
| S31-0088-12 Obtain explicit owner go/no-go sign-off | Needs a person | The owner merged PR #25 on 2026-11-07; no written go or no-go | Owner |

## Findings register

Found while finishing PR #25, each by running it: the test named beside it fails on the code before the fix. P0 stops a release, P1 blocks unless the owner accepts the risk, P2 is polish.

| # | Priority | What happened | Fix | Test |
|---|---|---|---|---|
| 1 | P0 | Saying no to a bridge just after saying yes was dropped while the yes was on its way, so a bridge the person refused could go ahead | `417f36e` | `Requests.test.tsx`: sends a changed mind after the first answer |
| 2 | P1 | The seam editor compared its choice with everything the server stores, which never matched, so after Undo it still showed the undone move | `417f36e` | `Mix.test.tsx`: follows the server again; `finishing.e2e.ts`: two quick seam changes |
| 3 | P1 | On Windows, saving an export job's file could collide with the page reading it: a false missing job, or an export stopped partway. CI had been calling it a flake | `0f2a1f4` | `test_selecta3_changes.py`: a job file busy for a moment loses nothing |
| 4 | P1 | Steering and rating disabled the button just pressed, so keyboard and screen reader focus fell out of the page | `417f36e` | `Now.test.tsx`: blocks overlapping steering presses |
| 5 | P1 | Answering a chord pair disabled the button just pressed; the next Space then played the mix | `d7b3e4a` | `Links.test.tsx`: keeps focus on the answer while it saves |
| 6 | P1 | Leaving fullscreen lost focus and closed Display options (the focus part dates from 3.0) | `0f2a1f4` | `finishing.e2e.ts`: fullscreen refused |
| 7 | P1 | On a phone, Listen controls sat half under the player at some heights (the CI failure on PR #25) and keyboard focus could land behind it | `417f36e`, `0f2a1f4` | `pages.e2e.ts`: nothing half hidden at any height; Tab walker |
| 8 | P2 | The guard against stale chord auditions threw away a press made while the page was still settling | `d7b3e4a` | `Links.test.tsx`, six runs in a row |
| 9 | P2 | Raw browser and server words (Failed to fetch, Internal Server Error) reached the page | `0f2a1f4`, `d7b3e4a` | Shell tests for the stopped server |
| 10 | P2 | One transition state had three names on three surfaces | `0f2a1f4` | Copy assertions updated |
| 11 | P2 | Activity marked the newest change undone when the server had nothing to undo | `0f2a1f4` | None yet |
| 12 | P2 | R opened Requests without the search box ready to type into | `0f2a1f4` | `finishing.e2e.ts`: keyboard alone can request a song |
| 13 | P2 | Request a song used the download icon | `0f2a1f4` | None (visual) |
| 14 | P2 | Layout: the phone editor's actions filled the first screen, the energy arc button wrapped to four lines, the Requests list stopped short, Library rows shifted, Explore showed no tab on Listen with nothing to hear | `0f2a1f4` | Review images |
| 15 | P2 | Still open: Studio and Library buttons use real `disabled` while busy; Listen at 1280 x 860 with Display options open puts the lyrics below the fold; seven editor actions in one row on desktop; Library filters take three rows on a phone | Open | Owner disposition |

## Evidence schema required for each S31 ID

1. **Identity:** S31 ID, related ADR, inherited S3/T/P/parity IDs, product surface, issue priority.
2. **Decision:** owner, date, Accepted/Rejected/Superseded rationale and dependencies.
3. **Implementation:** PR, exact commit, merged status and file scope; partial implementation clearly described.
4. **Acceptance:** expected observable outcome, adverse test, actual result, supported browser/OS.
5. **Automated:** exact commands/CI link, named assertions, fixture and failure result. A green build alone is insufficient.
6. **Visual:** screenshot/test reference, approved baseline, dark/light, viewport, font, clock and source-safe synthetic metadata.
7. **Manual:** keyboard, supported screen reader with OS/AT version, touch, 200/400% zoom, user-task outcomes, as applicable.
8. **Music and data:** real audio continuity/revision-accurate FLAC/bridge or draft provenance as applicable; unrelated data unchanged.
9. **Scale/security:** hardware, production build, timings, external network observation and unsupported platforms where applicable.
10. **Release:** P0/P1/P2 disposition, owner review, rollback confirmation, open limitations and final Verified sign-off.

## Status advancement

- **Not started:** planning only; no runtime work or proven acceptance outcome.
- **In progress:** approved implementing PR with task IDs and actual code/test changes.
- **Implemented:** code merged and appropriate automated test evidence recorded.
- **Verified:** implemented *and* relevant human visual, accessibility, music, usability and performance acceptance independently recorded.
- **Blocked / N/A:** recorded reason with owner and impact. Neither counts as Verified.

Every check in [the 116-item tracker](selecta-3-1-implementation-checklist.md) remains unchecked until Verified. Do not rewrite historical 3.0 data; reconcile via evidence and link the old items.

## Current disposition

PR #25 is merged. 70 Implemented, 34 partly implemented, 10 need a person, 2 not started; **0/116 Verified**. What remains is the person-only work in the table: participants, NVDA and other assistive technology, listening, real devices, and owner approval of images, budgets and the release.
