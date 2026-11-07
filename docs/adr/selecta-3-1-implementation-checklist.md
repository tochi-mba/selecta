# Selecta 3.1 — 116-item UI/UX finishing implementation checklist

- **Decision:** Proposed (11 ADRs, ADR-0078–0088).
- **Implementation:** Five tasks In progress on PR #25, 111 not started; **0/116 Implemented; 0/116 Verified.**
- **Baseline:** `main` at `3b01dc1` (merged Selecta 3.0).
- **Checklist discipline:** Every checkbox intentionally remains unchecked. PR #25 now includes a small amount of implementation, but no task yet has independent Verified evidence.
- **Identity:** `S31-XXXX-NN` is unique to this finishing programme; historical T, P and S3 IDs remain unchanged.

## How to use

Each checkbox identifies the exact deliverable and acceptance evidence from its ADR. On implementation, add the implementing PR and commit, tests, fixture screenshot, viewport/theme, failure/concurrency result, relevant audio/AT/user observations, old S3 reference and owner. Keep the checkbox empty if partially implemented or not independently verified. **The checkbox is a Verified marker, not a code-present marker.** Document Implemented separately in the ledger.

### Status contract

| Status | Requirement |
|---|---|
| Not started | No accepted implementing work or proven outcome for this new task |
| In progress | Implementing PR, owner and traceable changes exist |
| Implemented | Merged code with appropriate automated/behaviour preservation evidence |
| Verified | Implemented plus all applicable manual screen reader, audible, visual, performance and unassisted task acceptance, with owner review |
| N/A | Named owner rationale that the state/test cannot apply; not silently omitted |

## Task register — all 116 open

### [ADR-0078 — Reconcile the shipped 3.0 baseline and govern finishing work](adr-0078-baseline-evidence-and-governance.md)

**Phase:** 0 Baseline. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S31-0078-01 — Pin baseline to actual 3.0 merge and current release head.** Acceptance: Evidence record names commit, environment, browser, installed/PWA assumptions and support boundary.
- [ ] **S31-0078-02 — Reconcile the 258 inherited S3 IDs with merged code and CI.** Acceptance: Every S3 ID maps to code/PR/tests or remains unresolved; no unchecked legacy item is silently marked done.
- [ ] **S31-0078-03 — Inventory every destination, subview, overlay and always-on surface.** Acceptance: One route/surface map includes Listen, Explore, My Mixes, Edit, Library, Workspace, requests, Stage, Studio, Activity and edge screens.
- [ ] **S31-0078-04 — Build the state coverage matrix for each surface.** Acceptance: Initial, partial, empty, background refresh, stale, failed, offline and recovered states are recorded or explicitly N/A.
- [ ] **S31-0078-05 — Capture deterministic light/dark screenshots of the real built app.** Acceptance: Fixture, viewport, theme, browser, font, state and asset license are recorded; no captured private music metadata.
- [ ] **S31-0078-06 — Run baseline core-task scripts without coaching participants.** Acceptance: Observed completion, hesitation, errors and recovery are separated from hypotheses; no fabricated success rates.
- [ ] **S31-0078-07 — Create a risk-ranked finding record.** Acceptance: Every finding has repro, affected user, severity P0/P1/P2, owner, acceptance test and old/new ADR link.
- [ ] **S31-0078-08 — Define non-regression comparisons against current behaviour.** Acceptance: Each proposed polish change specifies expected playback, persisted data, route and UI state unchanged.
- [ ] **S31-0078-09 — Record decision, implementation and verification status independently.** Acceptance: Proposed/Accepted decision and Not started/In progress/Implemented/Verified are not conflated.
- [ ] **S31-0078-10 — Approve and freeze the scope and baseline before implementation.** Acceptance: Owner signs decision boundaries and prioritization; no new engine, API or schema work is implied.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0079 — Unify typography, themes, visual rhythm and CSS ownership](adr-0079-visual-system-and-css-ownership.md)

**Phase:** 1 Foundations. **Decision:** Proposed. **Implementation:** In progress (selected sub-tasks). **Verified:** 0/10.

- [ ] **S31-0079-01 — Approve visual hierarchy for page, song, metadata and technical values.** Acceptance: Screens use a documented typographic scale; long/RTL/missing song metadata remains readable.
- [ ] **S31-0079-02 — Specify semantic colour role mapping for both themes.** Acceptance: Buttons, links, statuses, playback, requests, caution, focus and selections preserve contrast and meaning in light/dark.
- [ ] **S31-0079-03 — Audit existing CSS cascade and overlapping selectors.** Acceptance: Ownership map names each rule's canonical file; proposals identify obsolete overrides without changing code in this PR.
- [ ] **S31-0079-04 — Standardize spacing, gutters, radii, separators and depth.** Acceptance: Listen, browse, work, panel, dialog and toast examples use a reviewed common rhythm with justified exceptions.
- [ ] **S31-0079-05 — Standardize SVG icon dimensions, stroke and accessible names.** Acceptance: All core actions have consistent icon alignment, discernible names and non-glyph fallback behaviour.
- [ ] **S31-0079-06 — Review button, input, checkbox, tab, menu and status variants.** Acceptance: Control gallery covers default, hover, focus, pressed, busy, disabled, failure and destructive states.
- [ ] **S31-0079-07 — Review light/dark/system theme and first-paint transitions.** Acceptance: No theme flash, incorrect title-bar colour, unreadable lime text, or unexpected audio reaction on switch.
- [ ] **S31-0079-08 — Audit visible numerical values and truncation.** Acceptance: BPM, keys, durations, counts, storage, waveforms and titles align and remain understandable.
- [ ] **S31-0079-09 — Review screen composition at every density and content width.** Acceptance: No arbitrary giant heading, excessive dead space, clipping or giant unstructured action clusters in representative screenshots.
- [ ] **S31-0079-10 — Approve visual regression fixtures and change-review rules.** Acceptance: Reviewed baselines exist for representative pages and state changes; no blind snapshot acceptance.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0080 — Make controls, asynchronous states, recovery and Undo dependable](adr-0080-interaction-state-recovery-and-undo.md)

**Phase:** 1 Foundations. **Decision:** Proposed. **Implementation:** In progress (selected sub-tasks). **Verified:** 0/10.

- [ ] **S31-0080-01 — Define shared initial/empty/partial/refresh/error/offline/recovery presentation rules.** Acceptance: Each state includes visible facts, allowed actions, focus/announcement behaviour and next step.
- [ ] **S31-0080-02 — Review skeleton geometry for every high-traffic content surface.** Acceptance: Placeholders match real content structure and do not cause large avoidable layout jumps.
- [ ] **S31-0080-03 — Unify busy and duplicate-submit behaviour.** Acceptance: One action has immediate feedback, prevents duplicate mutations, and remains recoverable after timeout or failure.
- [ ] **S31-0080-04 — Audit global toast, Activity and scoped Undo lifetimes.** Acceptance: Burst messages never make the only undo inaccessible; undo never targets a newer or different mix.
- [ ] **S31-0080-05 — Review all dialog, drawer, sheet, menu and tooltip focus paths.** Acceptance: Escape, Tab, trigger-return, focus restore, outside click and stacked overlay behaviour match expected patterns.
- [ ] **S31-0080-06 — Audit stale-response reconciliation and persistent data survival.** Acceptance: Late search, poll, request, render or edit response cannot overwrite the latest user action.
- [ ] **S31-0080-07 — Make error text specific and actionable.** Acceptance: Every meaningful failure states what failed, what remains safe and how to retry or recover.
- [ ] **S31-0080-08 — Review command palette and shortcut discoverability.** Acceptance: Disabled commands explain why; typed search, pointer selection, arrow keys and keyboard shortcut opt-out work.
- [ ] **S31-0080-09 — Review accessible announcements for non-chattering progress.** Acceptance: Song/page/action outcome is announced once; clocks, polling and repeated progress do not flood live regions.
- [ ] **S31-0080-10 — Test rapid user input while the server is slow or disconnected.** Acceptance: No silent lost clicks, fabricated success, duplicate request, or focus reset during reconnect.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0081 — Reduce friction from first music folder to a confident first mix](adr-0081-first-run-explore-and-mix-choice.md)

**Phase:** 2 Listener. **Decision:** Proposed. **Implementation:** In progress (selected sub-tasks). **Verified:** 0/10.

- [ ] **S31-0081-01 — Review new-user entry and folder path guidance.** Acceptance: User knows where to find a path, what stays local, what metadata can leave, and why a path can be rejected.
- [ ] **S31-0081-02 — Design distinct source-check, scan, analysis and mix-ready states.** Acceptance: Every stage has accurate progress or uncertainty, separate failures, and useful next action.
- [ ] **S31-0081-03 — Test invalid, absent, empty, permission-denied and unplugged folder outcomes.** Acceptance: Error does not imply music was lost; recovery is possible without a full restart.
- [ ] **S31-0081-04 — Establish a first-play call to action as soon as genuinely possible.** Acceptance: User can start a valid mix without waiting for unrelated full-library processing.
- [ ] **S31-0081-05 — Review featured mix hierarchy and mood card choice.** Acceptance: Recommendation, artist context and outcomes are understandable without DJ terminology or excessive competing actions.
- [ ] **S31-0081-06 — Clarify Play, Edit first, Save as draft and replacing the current mix.** Acceptance: Each action explains whether current audio changes and how to avoid replacing it.
- [ ] **S31-0081-07 — Review mix length, feel, stems, energy and destination customization.** Acceptance: Frequent options are simple; advanced options are discoverable and persisted truthfully.
- [ ] **S31-0081-08 — Review unavailable preset reasons and recovery paths.** Acceptance: Each unavailable card states the specific prerequisite and relevant analysis progress.
- [ ] **S31-0081-09 — Test long/unicode/missing metadata and small/zoomed devices.** Acceptance: Choices remain understandable and actionable without horizontal overflow or off-screen controls.
- [ ] **S31-0081-10 — Measure unassisted time-to-first-valid-play in representative tasks.** Acceptance: Record actual success, critical errors, hesitation and any misleading disclosure.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0082 — Polish Listen, navigation, mini-player and Stage without audio regressions](adr-0082-listen-shell-stage-and-audio-trust.md)

**Phase:** 2 Listener. **Decision:** Proposed. **Implementation:** In progress (selected sub-tasks). **Verified:** 0/11.

- [ ] **S31-0082-01 — Review primary hierarchy across Listen playing/paused/empty/error states.** Acceptance: Song, artist, progress, Play/Pause and Next are immediately recognizable; optional controls do not compete.
- [ ] **S31-0082-02 — Test Next versus Skip semantics and transition countdown wording.** Acceptance: Users understand whether the next song is immediate or transition-aligned without changing transport behaviour.
- [ ] **S31-0082-03 — Verify waveform seek and disabled-seek feedback with real audio.** Acceptance: Time, output and accessibility value agree; unavailable areas explain why.
- [ ] **S31-0082-04 — Review timed/untimed/instrumental/missing lyrics presentation.** Acceptance: Readable line and word focus; no fabricated timing; explicit no-lyrics fallback.
- [ ] **S31-0082-05 — Review Spectrum, Beat countdown, Lyrics focus and Why disclosure.** Acceptance: View options are discoverable but do not obscure transport, player state or song title.
- [ ] **S31-0082-06 — Review next-song, steering, rating and requests grouping.** Acceptance: Users can inspect the next song and shape energy without mistaking a preview for a live edit.
- [ ] **S31-0082-07 — Re-test mini-player and bottom nav geometry at narrow widths.** Acceptance: No overlap or obscured last row at 320–430px, short height, orientation or display safe area.
- [ ] **S31-0082-08 — Verify visual keyboard and focus changes on narrow screens.** Acceptance: Input is visible, navigation/player step away predictably, and focus resumes correctly.
- [ ] **S31-0082-09 — Verify Stage fullscreen denial and exit fallbacks.** Acceptance: Exit/Escape work, focus returns, audio continues, reduced motion and announcements remain appropriate.
- [ ] **S31-0082-10 — Exercise main/preview/multi-tab audio ownership on real media.** Acceptance: One active owner, no unintended overlap, silence, play restart or surprise resume.
- [ ] **S31-0082-11 — Review route, history, breadcrumbs and deep-link continuity.** Acceptance: Listen and mini-player survive page navigation, Back/Forward and old aliases with correct page titles.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0083 — Make drafts, timeline editing, transition intent and export unambiguous](adr-0083-mixes-editor-inspector-and-export.md)

**Phase:** 3 Creator. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/12.

- [ ] **S31-0083-01 — Review My Mixes current/draft/render-line hierarchy.** Acceptance: Users distinguish what plays, what is saved, what is queued and what will render next.
- [ ] **S31-0083-02 — Test new, rename, copy, delete, restore and reorder drafts.** Acceptance: Each action has clear scope, durable feedback, failure recovery and correct Undo identity.
- [ ] **S31-0083-03 — Review creator timeline hierarchy at 2, 20 and 100 songs.** Acceptance: Track identity, seam status and contextual actions stay scannable under long metadata.
- [ ] **S31-0083-04 — Provide predictable non-drag reorder and insertion affordances.** Acceptance: Pointer/touch/keyboard alternatives clearly indicate destination and resulting order.
- [ ] **S31-0083-05 — Review draft versus current editor headers and action copy.** Acceptance: User knows what changes immediately affect playback and what remains a separate project.
- [ ] **S31-0083-06 — Audit Inspector Listen/Change/Studio/Details consistency.** Acceptance: Tab semantics, pair context, focus and requested-versus-rendered outcome stay stable.
- [ ] **S31-0083-07 — Review transition cue, style, bar count and fallback presentation.** Acceptance: User choice is not visually overwritten by a different actually rendered move.
- [ ] **S31-0083-08 — Verify preview/rating/render failure and stale-request recovery.** Acceptance: A late render cannot trump newer intent; audio preview preserves proper owner.
- [ ] **S31-0083-09 — Review export scope, prerequisites and exact snapshot identity.** Acceptance: Before confirm, user knows selected mix/revision and why export may be unavailable.
- [ ] **S31-0083-10 — Review persistent export stages, errors, retries and download recovery.** Acceptance: Closing panel or modifying mix does not lose job; final output corresponds to captured revision.
- [ ] **S31-0083-11 — Test cross-mix concurrent edits, requests and Undo.** Acceptance: Mutation/Undo only affects intended current/draft revision despite stale responses.
- [ ] **S31-0083-12 — Verify actual FLAC decoding and authored track order.** Acceptance: Downloaded file format, duration, transition identity and source scope match intended snapshot.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0084 — Refine Stem Studio's expert controls without reducing capability](adr-0084-stem-studio-workstation-polish.md)

**Phase:** 3 Creator. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/9.

- [ ] **S31-0084-01 — Review session identity and the A/B song context.** Acceptance: User can always tell which songs/pair and revision are being changed.
- [ ] **S31-0084-02 — Improve lane and square visual/readable semantics.** Acceptance: Voice, drums, bass and melody cells are distinguishable without colour alone.
- [ ] **S31-0084-03 — Verify keyboard grid movement and entry/exit.** Acceptance: One grid Tab stop, arrow/Home/End navigation, Space toggle and a reliable way out.
- [ ] **S31-0084-04 — Review solo, audition, shape preset and AI actions.** Acceptance: Each control describes its audio effect and has predictable active/busy/unavailable feedback.
- [ ] **S31-0084-05 — Separate dirty, retained, saved, applying and rendered states.** Acceptance: No wording implies locally retained edits have already been committed or heard.
- [ ] **S31-0084-06 — Review missing stem, separation wait, stale pair and partial failure states.** Acceptance: Unavailable lanes say why; viable work is preserved and next recovery step is clear.
- [ ] **S31-0084-07 — Review narrow layouts, horizontal pan and large-zoom access.** Acceptance: Grid remains operable and controls/focus are not covered by sheets or keyboard.
- [ ] **S31-0084-08 — Verify preview/main audio takeover and return behaviour.** Acceptance: No overlapping audio, stale preview or unintended resume after navigation/close.
- [ ] **S31-0084-09 — Confirm guarded Apply and restoration after concurrent edit.** Acceptance: A changed/deleted/reordered pair cannot receive stale Studio edits; recovery is traceable.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0085 — Clarify Requests, consented bridges and discovery auditions](adr-0085-requests-and-music-discovery.md)

**Phase:** 4 Discovery/Operations. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S31-0085-01 — Review request search and duplicate/pre-existing choices.** Acceptance: Users understand requested versus already planned/playing songs and can cancel safely.
- [ ] **S31-0085-02 — Clarify waiting, preparing, ready, inserted, failed and cancelled states.** Acceptance: Status and detail agree with server truth, including late updates and refresh.
- [ ] **S31-0085-03 — Review bridge proposal consent and alternatives.** Acceptance: Before approval, all songs, transitions, reason and whole-route effects are explicit.
- [ ] **S31-0085-04 — Verify bridge atomicity and retry/rejection paths.** Acceptance: Nothing joins until all parts are ready and approved; no partial route plays.
- [ ] **S31-0085-05 — Test competing requests, cancellation and late poll recovery.** Acceptance: No duplicate song, same-slot assignment, cancelled resurface or misleading success.
- [ ] **S31-0085-06 — Review Word connections candidate, preview and rating flow.** Acceptance: User distinguishes discovered phrase from rendered transition and can add the intended pair only.
- [ ] **S31-0085-07 — Review four-stage harmonic listen and verdict flow.** Acceptance: A/B context, stages, verdict and retry are understandable and no result is claimed beyond the actual audition.
- [ ] **S31-0085-08 — Verify cross-page and preview audio ownership.** Acceptance: Audition never overlaps main player or silently changes playback intent.
- [ ] **S31-0085-09 — Review empty/no-match/failed-render and unreadable metadata states.** Acceptance: Clear zero-result, stale-data and partial-readiness explanations without hiding controls.
- [ ] **S31-0085-10 — Test keyboard/touch accessibility for request drawer and discovery actions.** Acceptance: Search, approval, skip, stop, review and pair insertion work without pointer-only gestures.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0086 — Polish Library, Workspace, studies and operational status](adr-0086-library-workspace-study-and-operational-trust.md)

**Phase:** 4 Discovery/Operations. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/11.

- [ ] **S31-0086-01 — Review Library search, sort, filters, density and URL/history state.** Acceptance: Results match query, Back restores selected filter, and deep links remain valid.
- [ ] **S31-0086-02 — Rebalance library row title, artist, readiness and action hierarchy.** Acceptance: Scanning reveals song identity and blockers before secondary maintenance controls.
- [ ] **S31-0086-03 — Review large-result pagination and background refresh behaviour.** Acceptance: Show counts/loaded subset, preserve focus and prior results during refresh or failure.
- [ ] **S31-0086-04 — Review track detail and manual tempo/key/exclusion controls.** Acceptance: Controls explain effective versus detected values; corrections persist after analysis.
- [ ] **S31-0086-05 — Audit readiness language across Library, Explore and Workspace.** Acceptance: Same song has the same true readiness and same explanation on every surface.
- [ ] **S31-0086-06 — Review Workspace overview attention, background jobs and storage.** Acceptance: Users know what's working, what is paused, and what specific action is needed.
- [ ] **S31-0086-07 — Review watched-folder, scan-stop, drive loss and storage-limit recovery.** Acceptance: Cancelling or losing a drive never appears to destroy original music or its records.
- [ ] **S31-0086-08 — Review operational diagnostics and local privacy explanations.** Acceptance: Only safe fields shown; metadata lookup disclosure names LRCLIB data accurately.
- [ ] **S31-0086-09 — Review listening-study setup, progress, A/B answers and completion.** Acceptance: Blinding holds, trials are attributed correctly and user can continue after a failed submission.
- [ ] **S31-0086-10 — Validate narrow/high-zoom, missing/duplicate/RTL song data.** Acceptance: Every main library and Workspace action is readable and navigable at supported sizes.
- [ ] **S31-0086-11 — Measure real 20k-track Library scale and constrained hardware response.** Acceptance: Capture input latency, scroll smoothness, memory growth and background-render interference.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0087 — Verify WCAG, device reflow, audio latency and scale](adr-0087-accessibility-responsive-and-performance-gates.md)

**Phase:** 5 Cross-cutting quality. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/11.

- [ ] **S31-0087-01 — Approve platform, width, zoom, orientation and keyboard matrix.** Acceptance: Matrix covers 320/375/390/430/768/1024/1280/1440/1920/3840 CSS px where meaningful.
- [ ] **S31-0087-02 — Run full keyboard-only tasks across core journeys.** Acceptance: Skip link, menus, forms, tabs, waveform, timeline, Studio grid, requests and export have no traps.
- [ ] **S31-0087-03 — Run manual supported screen-reader tasks with actual versions logged.** Acceptance: At minimum NVDA/Edge and available VoiceOver/TalkBack; unsupported/unavailable runs remain pending.
- [ ] **S31-0087-04 — Verify WCAG 2.2 AA reflow, focus, contrast and target size.** Acceptance: Record objective measurements/exceptions; 24px AA minimum is not falsely described as a universal 44px requirement.
- [ ] **S31-0087-05 — Check reduced motion, colour-independent statuses and live announcements.** Acceptance: No flashing/chattering, no essential meaning relies only on colour or animated visuals.
- [ ] **S31-0087-06 — Verify mobile player/nav/keyboard/safe-area geometry under short viewports.** Acceptance: Focused controls and final list rows remain visible without overlap.
- [ ] **S31-0087-07 — Measure user interactions during background render on real hardware.** Acceptance: Record hardware, production build, input latency, long tasks and any audio timing disturbances.
- [ ] **S31-0087-08 — Profile 20k Library, 100-song Edit and full Studio grid.** Acceptance: Realistic search, reorder, scroll, repaint, memory and loading budgets defined from baseline.
- [ ] **S31-0087-09 — Verify media continuity across page, theme, Stage, audition and tabs.** Acceptance: Real audible evidence shows correct owner, seek/transition timing and no surprise resume.
- [ ] **S31-0087-10 — Review PWA installed-mode startup and backend-unavailable recovery.** Acceptance: No claim of offline playback without running local server; direct routes and recovery remain truthful.
- [ ] **S31-0087-11 — Define evidence-backed performance and accessibility budgets.** Acceptance: Use reference 200ms INP/0.1 CLS properly as context, not unsupported field compliance claim.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

### [ADR-0088 — Require observable user, visual and product acceptance before release](adr-0088-research-visual-regression-and-release.md)

**Phase:** 6 Verification. **Decision:** Proposed. **Implementation:** Not started. **Verified:** 0/12.

- [ ] **S31-0088-01 — Create deterministic visual snapshot matrix for approved screen/state/theme fixtures.** Acceptance: Include full UI, modal open, empty, loading, error, recovery, 320px and desktop examples.
- [ ] **S31-0088-02 — Require reviewed diffs rather than bulk baseline replacement.** Acceptance: All visual changes have owner approval and intentional reasons; no accidentally hidden content.
- [ ] **S31-0088-03 — Preserve all existing Python, frontend, audio and E2E assertions.** Acceptance: Selectors can evolve, but regressions in identity, playback, export or privacy remain blocking.
- [ ] **S31-0088-04 — Run integrated stale/offline/duplicate/concurrent failure scenarios.** Acceptance: No invented ready/success, wrong mix write, lost draft, partial request or silent unsupported retry.
- [ ] **S31-0088-05 — Conduct unguided listener, creator and expert tasks.** Acceptance: Record actual pass/fail, completion time, hesitation, wrong action and participant quotes without fabricated metrics.
- [ ] **S31-0088-06 — Run manual auditory transition and export review.** Acceptance: Evaluate playback continuity separately from perceived mix quality; real FLAC decodes and matches snapshot.
- [ ] **S31-0088-07 — Audit each unresolved P0/P1/P2 issue and written disposition.** Acceptance: P0 always blocks; P1 blocks unless specifically risk-accepted; P2 has reviewed disposition.
- [ ] **S31-0088-08 — Verify rollback compatibility and preservation of local persisted state.** Acceptance: Restored old build sees source files, drafts, settings and prior URLs without migration loss.
- [ ] **S31-0088-09 — Update ADR decisions, task checklist and evidence ledger per implementing PR.** Acceptance: No status advances from Proposed/Not started without owner decision and evidence.
- [ ] **S31-0088-10 — Measure goals against an approved, recorded baseline.** Acceptance: Proposed success targets are calibrated from observed task data, not asserted as achieved.
- [ ] **S31-0088-11 — Prepare a release-candidate report listing support and known limitations.** Acceptance: Report screenshots, CI SHA, user/AT/audio/performance evidence and excluded environments.
- [ ] **S31-0088-12 — Obtain explicit owner go/no-go sign-off.** Acceptance: No automatic merge or release merely from planning PR, green CI or completed cosmetic work.

**Exit gate:** Check each applicable item against the [verification matrix](selecta-3-1-verification-matrix.md) and link its real outcome in the [evidence ledger](selecta-3-1-evidence.md); no acceptance from documentation alone.

## Pre-release integrated gate

- [ ] All high-frequency listener/creator workflows have human-observed, non-blocking outcomes.
- [ ] No unaccepted P0/P1 critical task, identity, privacy, audio or accessibility defect.
- [ ] All affected existing Python/web/E2E behavioural assertions remain in place and pass on an actual implementing commit.
- [ ] Approved visual diff in light/dark, narrow/wide and meaningful non-happy states.
- [ ] Real keyboard and available screen-reader review; unperformed combinations explicitly pending.
- [ ] Real audible continuity/transition and decodable revision-correct FLAC review when relevant.
- [ ] Hardware/profile measurements and rollback review are recorded.
- [ ] Owner authorizes release after reviewing evidence, not because this checklist exists.

The integrated checklist above is **an additional release gate, not included in the 116 S31 task count**.
