# Selecta 4.0 — 250-item UI/UX implementation checklist

- **Historical register status:** Created with 25 Proposed decisions and 250 Not started tasks. Runtime implementation PR #29 later merged as `6638ec2313ce53843adfaf363306f8e79c4c8c7e`; task-specific implementation/verification remains unreconciled in this ledger.
- **Date:** 2026-11-07.
- **Base:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after PR #25 and #26 merge).
- **Scope:** Documentation only, no application or test changes.
- **Rule:** A checkbox means **Verified**, not merely coded. Every checkbox intentionally remains unchecked.
- **Task identity:** `S4-XXXX-NN` is new; old T/P/S3/S31 statuses are independent and preserved.

## How to update

**Not started → In progress (named implementing PR) → Implemented (merged code + applicable automated/contract checks) → Verified (human visual, accessible, audible, scale and functional evidence as applicable).** Decisions separately Proposed → Accepted / Rejected / Superseded with owner/rationale. N/A requires explicit owner justification. Link each task to [the evidence ledger](selecta-4-evidence.md), original test/parity invariants and real screenshots/audio/AT when applicable. No task becomes complete because this documentation PR merges.

## Task register — all unchecked

### [ADR-0089 — Selecta 4.0 charter, baseline and full feature-preservation governance](adr-0089-charter-baseline-parity-and-governance.md)

**Phase:** 0 Baseline. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0089-01 — Pin and document baseline SHA, supported Windows/Edge/server version and outstanding previous PR history.** Acceptance: Signed inventory identifies actual merged main head; old plans are called historical rather than verified. Required verification: Check exact commit and previous ADR index at implementation start. **Implementation: Not started.**
- [ ] **S4-0089-02 — Inventory routes, overlays, controls, settings, schemas, API side effects and every state.** Acceptance: All capabilities have traceable owners including obscure menus and error branches. Required verification: Source-to-capability crosscheck against router, views, state and API. **Implementation: Not started.**
- [ ] **S4-0089-03 — Create feature-to-test-to-ADR parity mapping and blocking invariants.** Acceptance: No old capability is orphaned or dropped. Required verification: Review parity map against existing unit/E2E and Python tests. **Implementation: Not started.**
- [ ] **S4-0089-04 — Record current dark/light responsive baselines with deterministic fixtures.** Acceptance: Every captured image names fixture, browser, theme, viewport and commit. Required verification: 320/375/768/1280/1440 screenshots plus loaded/error states. **Implementation: Not started.**
- [ ] **S4-0089-05 — Run unassisted listener, creator and expert baseline tasks.** Acceptance: Results separate observations from hypotheses and record failures. Required verification: Music-folder, first mix, request, draft, Studio, export scripts. **Implementation: Not started.**
- [ ] **S4-0089-06 — Define P0/P1/P2 triage and evidence owners.** Acceptance: Wrong scope, data loss, audio overlap, bridge consent and bad FLAC are stop-ship. Required verification: Fault/reproduction register and accepted-risk owner. **Implementation: Not started.**
- [ ] **S4-0089-07 — Require no-runtime-change documentation boundary.** Acceptance: This ADR PR changes only docs; implementation occurs separately. Required verification: PR changed-path audit. **Implementation: Not started.**
- [ ] **S4-0089-08 — Set decision/implementation/verification lifecycle and change log.** Acceptance: Proposed never means accepted; merged docs never means working code. Required verification: Ledger validation and owner sign-off evidence. **Implementation: Not started.**
- [ ] **S4-0089-09 — Define compatibility and rollback requirements before UI replacement.** Acceptance: Existing paths/preferences/drafts/export jobs remain usable across rollback. Required verification: Upgrade/rollback fixture tests. **Implementation: Not started.**
- [ ] **S4-0089-10 — Approve separately staged implementation PR order with each dependency.** Acceptance: Each PR traces to stable S4 IDs and explicit tests. Required verification: Phase gate review against roadmap. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0090 — Preserve lime/cream/charcoal identity with an independently polished dark and light theme](adr-0090-palette-theme-semantics-and-contrast.md)

**Phase:** 1 Foundations. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0090-01 — Audit every current token consumer and hard-coded colour.** Acceptance: Semantic role registry covers all page/overlay/chart surfaces. Required verification: Static scan plus visual spot checks in both themes. **Implementation: Not started.**
- [ ] **S4-0090-02 — Approve theme palettes, contrast pairings and lime usage.** Acceptance: Text, control boundaries and focus meet WCAG 2.2 AA targets. Required verification: Contrast report for rendered foreground/background pairs. **Implementation: Not started.**
- [ ] **S4-0090-03 — Implement semantic background, text, border and action roles.** Acceptance: No view independently overrides core brand meanings. Required verification: Component-gallery light/dark snapshots. **Implementation: Not started.**
- [ ] **S4-0090-04 — Define states for selection, hover, pressed, focus and disabled.** Acceptance: No state relies on colour alone and focus is distinct from selection. Required verification: Keyboard and forced-colours screenshots. **Implementation: Not started.**
- [ ] **S4-0090-05 — Calibrate request blue, warning orange, error and success per theme.** Acceptance: Status remains readable and semantically distinct on both themes. Required verification: Contrast and status-interpretation checks. **Implementation: Not started.**
- [ ] **S4-0090-06 — Preserve explicit system/light/dark preference and first-paint behaviour.** Acceptance: Reload and system preference changes do not flash or override saved choice. Required verification: Theme migration and reload E2E. **Implementation: Not started.**
- [ ] **S4-0090-07 — Ensure spectrum/waveform/lyrics charts use semantic colours.** Acceptance: Visualizations adapt live without audio interruption. Required verification: Theme switch while playing with screenshot and audio checks. **Implementation: Not started.**
- [ ] **S4-0090-08 — Review dialogs, menus, mini-player, editor and grid in each theme.** Acceptance: Depth and hierarchy are visible even with subtle borders. Required verification: Golden screenshot paired review. **Implementation: Not started.**
- [ ] **S4-0090-09 — Support forced-colours/high-contrast and disabled styling.** Acceptance: Critical borders, toggles and statuses survive system overrides. Required verification: Windows forced-colours and keyboard run. **Implementation: Not started.**
- [ ] **S4-0090-10 — Record approved contrast exceptions and owner review.** Acceptance: No unmeasured light-mode fallback or invisible control. Required verification: Documented pair table in evidence ledger. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0091 — Typography, spacing, density, icons, visual hierarchy and CSS ownership](adr-0091-type-spacing-density-and-css-ownership.md)

**Phase:** 1 Foundations. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0091-01 — Define display, H1-H3, body and caption role scale with responsive limits.** Acceptance: Long metadata cannot force primary controls offscreen. Required verification: Long/mixed-direction fixture in all breakpoints. **Implementation: Not started.**
- [ ] **S4-0091-02 — Define tabular-numeral and bidi-isolation rules.** Acceptance: Times, BPM and keys remain aligned with RTL song metadata. Required verification: Numeric alignment, Arabic/Hebrew/CJK fixture tests. **Implementation: Not started.**
- [ ] **S4-0091-03 — Publish spacing, radius, border, depth and control-size tokens.** Acceptance: Related actions group consistently across pages. Required verification: Review component states at normal/compact density. **Implementation: Not started.**
- [ ] **S4-0091-04 — Audit CSS duplication, specificity and source ownership.** Acceptance: Proposed canonical owner for each shared/layout/page rule. Required verification: Selector-collision inventory and style regression review. **Implementation: Not started.**
- [ ] **S4-0091-05 — Standardize song identity, transition identity and status order.** Acceptance: User learns same title/artist/facts/status/action order in every view. Required verification: Cross-page snapshots and screen reader reading order. **Implementation: Not started.**
- [ ] **S4-0091-06 — Standardize SVG icon sizing and text/icon alignment.** Acceptance: No clipped glyph, uneven baseline or icon-only mystery action. Required verification: Browser/platform font fallback checks. **Implementation: Not started.**
- [ ] **S4-0091-07 — Define truncation and full-text retrieval conventions.** Acceptance: Critical names and errors can always be read fully. Required verification: 200/400% zoom, long/unbroken/emoji fixture. **Implementation: Not started.**
- [ ] **S4-0091-08 — Define readable disabled/secondary/tiny-caption constraints.** Acceptance: No important content disappears under compact mode. Required verification: Contrast, touch and text-enlargement tests. **Implementation: Not started.**
- [ ] **S4-0091-09 — Reconcile shared CSS breakpoints and page-local responsive rules.** Acceptance: Studio adjustments do not unexpectedly break Library. Required verification: CSS dependency tests and screenshot pairs. **Implementation: Not started.**
- [ ] **S4-0091-10 — Create development-only component/typography review surfaces.** Acceptance: Every variant can be inspected in dark/light and focused states. Required verification: Reviewed gallery and screenshot coverage. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0092 — Responsive navigation shell, optional inspector, global header and route integrity](adr-0092-navigation-shell-viewport-and-deep-links.md)

**Phase:** 2 Shell. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0092-01 — Inventory deep links, aliases, search params and browser history.** Acceptance: All current routes still load directly and Back/Forward restores context. Required verification: Router E2E for old paths and query combinations. **Implementation: Not started.**
- [ ] **S4-0092-02 — Implement desktop rail with active and focus identity.** Acceptance: Nested edits retain their correct parent nav destination. Required verification: Keyboard navigation, collapsed rail and screen reader current-page. **Implementation: Not started.**
- [ ] **S4-0092-03 — Implement mobile bottom navigation and Workspace under More.** Acceptance: Essential services and blockers remain discoverable. Required verification: 320/375/390/430px and orientation tests. **Implementation: Not started.**
- [ ] **S4-0092-04 — Build contextual header with bounded global utilities.** Acceptance: No redundant button flood; breadcrumb/title reflect actual route. Required verification: Header action audit on all routes. **Implementation: Not started.**
- [ ] **S4-0092-05 — Create optional inspector region and accessible resize controls.** Acceptance: Resize persists safely; timeline retains usable minimum width. Required verification: Pointer/keyboard resize, 200/400% zoom. **Implementation: Not started.**
- [ ] **S4-0092-06 — Centralize sticky chrome/safe-area/visual-viewport calculations.** Acceptance: Player and nav do not cover last list row or focused input. Required verification: Mobile keyboard/short viewport/landscape tests. **Implementation: Not started.**
- [ ] **S4-0092-07 — Preserve per-route selection and scroll where safe by stable ID.** Acceptance: Returning from Library to editor restores same valid transition. Required verification: Back/Forward and removal invalidation tests. **Implementation: Not started.**
- [ ] **S4-0092-08 — Remove content/route ambiguity on empty Listen.** Acceptance: Route, heading and selected nav match visible content. Required verification: No-current-mix deep-link test. **Implementation: Not started.**
- [ ] **S4-0092-09 — Make status and task blockers available without Workspace clutter.** Acceptance: Critical storage/analysis blocker cannot be hidden in More. Required verification: Attention indicator and accessible announcement tests. **Implementation: Not started.**
- [ ] **S4-0092-10 — Validate standalone PWA, browser tab and reload shell geometry.** Acceptance: No false offline-without-server promise and no state loss. Required verification: Installed Edge and server-disconnected checks. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0093 — Persistent playback presentation, previews, audio focus and immersive Stage lifecycle](adr-0093-persistent-player-audio-focus-and-stage-lifecycle.md)

**Phase:** 2 Shell / 4 Listen. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0093-01 — Specify audio-owner state graph for every audition surface.** Acceptance: At most one active owner; no implicit resume after explicit Pause. Required verification: Pairwise preview owner race tests. **Implementation: Not started.**
- [ ] **S4-0093-02 — Decouple transport lifecycle from routes, themes and overlay mounts.** Acceptance: Playback survives navigation/density/theme changes. Required verification: Real-media route/nav/theme E2E. **Implementation: Not started.**
- [ ] **S4-0093-03 — Redesign desktop and mobile mini-player hierarchy.** Acceptance: Primary transport available without text/icon collision. Required verification: Long-title and 320–430px screenshots. **Implementation: Not started.**
- [ ] **S4-0093-04 — Document play, pause, resume, next, previous and Jump semantics.** Acceptance: User can distinguish immediate skip from transition jump. Required verification: Audio timing and copy comprehension checks. **Implementation: Not started.**
- [ ] **S4-0093-05 — Preserve seeking and disabled transition-seek feedback.** Acceptance: Position remains accurate and unavailable areas explain why. Required verification: Seek near boundaries and during transition tests. **Implementation: Not started.**
- [ ] **S4-0093-06 — Preserve and test volume, mute and Media Session behaviours.** Acceptance: System media controls work where supported; in-app fallback always works. Required verification: Windows/Edge real hardware plus browser API tests. **Implementation: Not started.**
- [ ] **S4-0093-07 — Implement preview interruption/cleanup rules.** Acceptance: Late preview cannot resume stale owner or leave silence. Required verification: Open/close/switch/fail preview adversarial tests. **Implementation: Not started.**
- [ ] **S4-0093-08 — Rebuild Stage fullscreen/fallback/exit and focus handling.** Acceptance: Escape/Close recover without interrupting playback. Required verification: Fullscreen denial, tab switch, reduced motion. **Implementation: Not started.**
- [ ] **S4-0093-09 — Test paused, last-song, no-mix, missing-file and interrupted audio states.** Acceptance: UI never falsely claims audio playing or downloadable. Required verification: Fault-injected transport suite. **Implementation: Not started.**
- [ ] **S4-0093-10 — Validate multi-tab and background lifecycle.** Acceptance: Existing leader/ownership protections remain intact. Required verification: Two tabs, hidden tab, suspension, wake and server restart. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0094 — Shared accessible controls, menus, sheets, dialogs and activity presentation](adr-0094-accessible-components-overlays-and-feedback.md)

**Phase:** 1 Foundations / 2 Shell. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0094-01 — Publish component state and semantic API contracts.** Acceptance: Every control maps user intent to correct accessible state. Required verification: Unit/story gallery dark/light snapshots. **Implementation: Not started.**
- [ ] **S4-0094-02 — Standardize buttons, toggles, icon actions and disabled reasons.** Acceptance: Single visible primary action per task context where practical. Required verification: Pointer/keyboard/touch state testing. **Implementation: Not started.**
- [ ] **S4-0094-03 — Standardize field/search/combobox results and validation.** Acceptance: Typing, Enter/Escape, fast queries and duplicate titles behave consistently. Required verification: ARIA combobox and stale-query tests. **Implementation: Not started.**
- [ ] **S4-0094-04 — Harden menu/tab/tooltip/roving focus interactions.** Acceptance: No keyboard trap and accurate selected/current state. Required verification: Tab, arrow, Escape and screen reader tests. **Implementation: Not started.**
- [ ] **S4-0094-05 — Centralize dialogs/drawers/sheets focus and inert background.** Acceptance: Focus returns to invoker or safe fallback after deletion. Required verification: Nested overlay and missing-trigger tests. **Implementation: Not started.**
- [ ] **S4-0094-06 — Make overlays viewport-safe with visual keyboard.** Acceptance: Close/submit remain accessible at short heights and zoom. Required verification: Mobile on-screen keyboard E2E. **Implementation: Not started.**
- [ ] **S4-0094-07 — Implement shared pending/error/stale/success feedback.** Acceptance: No false success before authoritative acknowledgement. Required verification: Delayed, failed and reordered response fixtures. **Implementation: Not started.**
- [ ] **S4-0094-08 — Constrain toast stacking and Undo retention.** Acceptance: Important feedback doesn't obscure player or expire sole undo path. Required verification: Notification timing and Activity scope tests. **Implementation: Not started.**
- [ ] **S4-0094-09 — Define icon and text contrast in forced-colours.** Acceptance: All selected/status/control boundaries remain discernible. Required verification: NVDA/Edge forced-colours/manual checks. **Implementation: Not started.**
- [ ] **S4-0094-10 — Audit existing controls for migration parity.** Acceptance: No action disappears because it moved into a menu. Required verification: Feature parity inventory and route task scripts. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0095 — Truthful asynchronous state, revision guards, Undo, recovery and multi-tab consistency](adr-0095-async-consistency-undo-offline-and-multitab.md)

**Phase:** 1 Foundations / cross-cutting. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0095-01 — Inventory domain state machines and user-visible labels.** Acceptance: Request/export/analysis/render statuses translate truthfully without data loss. Required verification: State transition table per domain. **Implementation: Not started.**
- [ ] **S4-0095-02 — Create mutation scope/operation/revision contracts.** Acceptance: Late response cannot target a newer pair or different draft. Required verification: Out-of-order mutation tests. **Implementation: Not started.**
- [ ] **S4-0095-03 — Define last-intent-wins versus server-authoritative cases.** Acceptance: Newer local intent preserved while conflicts remain visible. Required verification: Rapid transition choice, energy and preference tests. **Implementation: Not started.**
- [ ] **S4-0095-04 — Enforce safe idempotency and retry policy.** Acceptance: No duplicated request, bridge, export or song insert on timeout/retry. Required verification: Ambiguous commit and duplicate-submit fault tests. **Implementation: Not started.**
- [ ] **S4-0095-05 — Standardize pending, stale, offline and recovery UI.** Acceptance: Offline does not erase last confirmed data or imply failure. Required verification: Server disconnect/reconnect E2E. **Implementation: Not started.**
- [ ] **S4-0095-06 — Preserve scoped Undo order and Activity semantics.** Acceptance: Wrong-scope Undo is impossible; older Undo blocked with explanation. Required verification: Draft A/B plus intervening operation tests. **Implementation: Not started.**
- [ ] **S4-0095-07 — Audit polling ownership/backoff and tab visibility.** Acceptance: No duplicate loops, stale deep Library rows or backend overload. Required verification: Background tab and multi-view poll tests. **Implementation: Not started.**
- [ ] **S4-0095-08 — Implement user-friendly conflict and supersession notices.** Acceptance: Conflict reveals exact object and safe next action. Required verification: Two-tab edit, deleted target and newer revision tests. **Implementation: Not started.**
- [ ] **S4-0095-09 — Validate browser storage and migration fallbacks.** Acceptance: Malformed or denied preferences cannot crash or claim persistence. Required verification: Storage denial/quota/version migration tests. **Implementation: Not started.**
- [ ] **S4-0095-10 — Publish invariant-oriented model/property tests.** Acceptance: Single audio owner, atomic bridge, snapshot export and scoped writes hold. Required verification: Property and model-based race suite. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0096 — First-run folder import, analysis readiness and time to first valid play](adr-0096-onboarding-sources-and-time-to-first-play.md)

**Phase:** 3 Listener. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0096-01 — Redesign welcome hierarchy and path entry guidance.** Acceptance: New user can supply backend-usable path without guessing. Required verification: Unassisted Windows/Edge task and 320px screenshots. **Implementation: Not started.**
- [ ] **S4-0096-02 — Specify path parsing/quoting/normalization and validation copy.** Acceptance: Input preserved on missing/invalid/unreadable path. Required verification: Quote, space, UNC, Unicode, file-versus-folder tests. **Implementation: Not started.**
- [ ] **S4-0096-03 — Preserve existing source validation and safety.** Acceptance: No input path escapes backend permissions/origin policy. Required verification: Python/API security and filesystem fixture tests. **Implementation: Not started.**
- [ ] **S4-0096-04 — Design accurate scanning and partial-progress states.** Acceptance: Scan started only after backend acceptance; cancelled != lost. Required verification: Delayed/failed/cancel/reload scan E2E. **Implementation: Not started.**
- [ ] **S4-0096-05 — Represent readiness threshold precisely at 5/6/7 tracks.** Acceptance: First-play enabled at valid minimum, not full-library completion. Required verification: Fixture count and unsuitable-ready-song tests. **Implementation: Not started.**
- [ ] **S4-0096-06 — Surface specific blockers and recovery actions.** Acceptance: Disconnected drive and failed analysis lead to helpful next step. Required verification: Permission, drive disconnect, zero supported music tests. **Implementation: Not started.**
- [ ] **S4-0096-07 — Preserve lyric privacy and error-isolated lyric lookup.** Acceptance: Lyric outage does not falsely block all music. Required verification: Mock unavailable LRCLIB, disclosure review. **Implementation: Not started.**
- [ ] **S4-0096-08 — Handle server restarts and browser reload during preparation.** Acceptance: No duplicate scan and accurate recovered counts. Required verification: Restart/reload fault tests. **Implementation: Not started.**
- [ ] **S4-0096-09 — Design first mix with one primary gesture and optional customization.** Acceptance: First play is obvious but no automatic unexpected audio. Required verification: Real browser gesture and first-run usability. **Implementation: Not started.**
- [ ] **S4-0096-10 — Record time-to-first-valid-play baseline and follow-up.** Acceptance: Only observed sessions establish improvement. Required verification: Listener task log and evidence. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0097 — Explore discovery, energy and cue customization, and safe current-mix activation](adr-0097-explore-presets-steering-and-mix-activation.md)

**Phase:** 3 Listener. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0097-01 — Redesign featured suggestion and category card hierarchy.** Acceptance: Listener sees one clear Play; every other action remains discoverable. Required verification: Light/dark/mobile card screenshots and task completion. **Implementation: Not started.**
- [ ] **S4-0097-02 — Provide Play/Edit first/Save draft action parity.** Acceptance: Same resulting backend behaviour from all card entry points. Required verification: Generated mix and draft comparison tests. **Implementation: Not started.**
- [ ] **S4-0097-03 — Define shared current-mix replacement consequence policy.** Acceptance: Explore/Library/Drafts do not silently disrupt playback inconsistently. Required verification: Cross-entry current playing/paused/empty E2E. **Implementation: Not started.**
- [ ] **S4-0097-04 — Group feel/duration/stem/energy/destination controls predictably.** Acceptance: Every old control and saved preference remains available. Required verification: Feature parity audit and preference persistence tests. **Implementation: Not started.**
- [ ] **S4-0097-05 — Improve five-point energy graph, sliders and option presets.** Acceptance: Visual graph matches actual stored values with keyboard alternative. Required verification: Rapid edits, keyboard, out-of-range and stale saves. **Implementation: Not started.**
- [ ] **S4-0097-06 — Harden destination song autocomplete and scope wording.** Acceptance: Duplicate title/artists identified; desired end not promised as guaranteed. Required verification: Search stale-order, unavailable destination tests. **Implementation: Not started.**
- [ ] **S4-0097-07 — Clarify settings affect next generation versus current mix.** Acceptance: No accidental current audio changes from preference edit. Required verification: Listen-while-customizing E2E. **Implementation: Not started.**
- [ ] **S4-0097-08 — Create unavailable recommendation and partial library states.** Acceptance: Specific blocker without misleading ready label. Required verification: No matches, empty, partial-analysis and server-error fixtures. **Implementation: Not started.**
- [ ] **S4-0097-09 — Protect build submission and result reconciliation.** Acceptance: Double click/failure/latest build cannot erase current mix. Required verification: Idempotency and late-result tests. **Implementation: Not started.**
- [ ] **S4-0097-10 — Measure time and confidence selecting first mix.** Acceptance: Observe task errors rather than infer from screenshots. Required verification: Listener/creator usability session. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0098 — Listening-first Now view, accurate waveform, lyrics, spectrum and Stage](adr-0098-listen-waveform-lyrics-visualizer-and-stage.md)

**Phase:** 4 Listen. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0098-01 — Rebuild Listen hierarchy for idle/playing/paused/transition.** Acceptance: Transport and current song are immediate and readable. Required verification: Real media listener testing. **Implementation: Not started.**
- [ ] **S4-0098-02 — Add optional DJ detail without branching audio behaviour.** Acceptance: All core actions remain in both views. Required verification: Preference change while playing E2E. **Implementation: Not started.**
- [ ] **S4-0098-03 — Redesign waveform layers and seek semantics.** Acceptance: Rendered markers correspond to real audio and controls report exact values. Required verification: Seek near start/end, non-seekable clip and metadata tests. **Implementation: Not started.**
- [ ] **S4-0098-04 — Improve lyric typography, active line and auto-scroll.** Acceptance: Long/missing/untimed/RTL text is readable without jumping. Required verification: Lyric fixtures, reduced motion, visual screenshots. **Implementation: Not started.**
- [ ] **S4-0098-05 — Contain visualizer canvas work and theme redraw.** Acceptance: No excessive React renders or frame work when hidden. Required verification: Profile plus light/dark switch while playing. **Implementation: Not started.**
- [ ] **S4-0098-06 — Clarify Up next and pending requests.** Acceptance: Future plan is not falsely promised when request may alter order. Required verification: Request join near transition E2E. **Implementation: Not started.**
- [ ] **S4-0098-07 — Clarify Bigger/Calmer/Something else intent and feedback.** Acceptance: Accepted request distinct from successful track selection. Required verification: Steering failure/stale-race tests. **Implementation: Not started.**
- [ ] **S4-0098-08 — Tie feedback/rating to actually heard transition identity.** Acceptance: Late rating never attaches to newer transition. Required verification: Rating key and cross-song tests. **Implementation: Not started.**
- [ ] **S4-0098-09 — Redesign Stage focus/fullscreen and long-song display.** Acceptance: Escape/fallback and resume focus work without audio interruption. Required verification: Fullscreen denial, small screen, keyboard tests. **Implementation: Not started.**
- [ ] **S4-0098-10 — Create honest Listen empty/no lyrics/missing-media states.** Acceptance: No Explore content silently under Listen URL; no fabricated playback. Required verification: Deep-link, empty and fault injection tests. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0099 — My Mixes current-vs-draft clarity, safe activation and render queue](adr-0099-my-mixes-drafts-render-line-and-scoped-activation.md)

**Phase:** 5 Creator. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0099-01 — Redesign current mix overview and actions.** Acceptance: User can identify actual playing mix and its readiness. Required verification: Active/paused/empty card screenshots. **Implementation: Not started.**
- [ ] **S4-0099-02 — Redesign saved-draft list with stable identity and status.** Acceptance: Same-name drafts remain disambiguated and editable. Required verification: Duplicate title and multi-draft fixture. **Implementation: Not started.**
- [ ] **S4-0099-03 — Preserve create, copy, rename, delete and Undo contracts.** Acceptance: No lost work or wrong draft operations. Required verification: CRUD and sequence tests. **Implementation: Not started.**
- [ ] **S4-0099-04 — Clarify Edit versus Play/Make current behaviour.** Acceptance: Draft editing does not affect live player; activation does only as contracted. Required verification: Play A/edit B task script. **Implementation: Not started.**
- [ ] **S4-0099-05 — Redesign activation consequence and recovery flow.** Acceptance: Failed activation preserves prior current mix and audio. Required verification: Server error, pause/play and multi-tab activation tests. **Implementation: Not started.**
- [ ] **S4-0099-06 — Separate rendering queue and progress from saved collection.** Acceptance: Queued, working and finished have truthful distinctions. Required verification: Reorder/remove queue and background completion tests. **Implementation: Not started.**
- [ ] **S4-0099-07 — Ensure draft render readiness is detailed, not binary.** Acceptance: 8/11 prepared is distinct from saved status. Required verification: Partial/failed seam fixtures. **Implementation: Not started.**
- [ ] **S4-0099-08 — Preserve user position through draft mutation and navigation.** Acceptance: Selection/focus not redirected to another card. Required verification: Rename/delete/reorder focus tests. **Implementation: Not started.**
- [ ] **S4-0099-09 — Support long lists, search or sort where supported.** Acceptance: No phantom backend capabilities or lost deep link. Required verification: Long draft dataset and URL restoration. **Implementation: Not started.**
- [ ] **S4-0099-10 — Review destructive confirmation and scope-aware Undo.** Acceptance: Deleting a draft cannot undo current-mix action. Required verification: Multiple deletion and intervening edit tests. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0100 — Timeline editor, precise insertion/reorder, persistent scope and problem navigation](adr-0100-editor-timeline-song-seam-and-identity.md)

**Phase:** 5 Creator. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0100-01 — Implement persistent current/draft scope header and clear actions.** Acceptance: Editing a draft never silently mutates what plays. Required verification: Play A/edit B live scenario. **Implementation: Not started.**
- [ ] **S4-0100-02 — Redesign song and seam rows with clear hierarchy.** Acceptance: Long, duplicate, RTL song names remain identifiable. Required verification: 2, 20 and 100-song screenshots. **Implementation: Not started.**
- [ ] **S4-0100-03 — Preserve pointer/touch/keyboard reorder and move controls.** Acceptance: Every method yields identical order with visible focus. Required verification: First/middle/last/locked and touch-scroll tests. **Implementation: Not started.**
- [ ] **S4-0100-04 — Preserve exact-position insertion, removal, locking and Undo.** Acceptance: No impossible or inaccessible insertion gap. Required verification: Empty/one-song/edge-gap scenarios. **Implementation: Not started.**
- [ ] **S4-0100-05 — Keep selection attached to stable object through mutation.** Acceptance: After reorder focus stays with same track; invalid pair explained. Required verification: Concurrent request insertion/delete pair tests. **Implementation: Not started.**
- [ ] **S4-0100-06 — Create compact status/problem navigation.** Acceptance: Jumps to actual failed/missing/unrendered seam and restores focus. Required verification: 100-song fixture and keyboard problem jump. **Implementation: Not started.**
- [ ] **S4-0100-07 — Define consistent whole-mix action grouping.** Acceptance: Save copy, export, new, clear and preview remain discoverable. Required verification: Action parity and keyboard menu audit. **Implementation: Not started.**
- [ ] **S4-0100-08 — Handle stale revision and conflicting operations truthfully.** Acceptance: No wrong-scope edit or old response overriding newest mix. Required verification: Two tabs, delayed reorder, request join race tests. **Implementation: Not started.**
- [ ] **S4-0100-09 — Preserve scroll/context and responsiveness with long lists.** Acceptance: Input remains responsive without inappropriate virtualized focus loss. Required verification: 100-song, zoom and measured perf tests. **Implementation: Not started.**
- [ ] **S4-0100-10 — Standardize empty/one-song/missing-audio/failure/undo states.** Acceptance: No fake transitions or misleading success state. Required verification: Error and recovery E2E. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0101 — Transition Inspector: requested intent, rendered reality, exact cues and safe previews](adr-0101-transition-inspector-requested-versus-rendered.md)

**Phase:** 5 Creator. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0101-01 — Design Inspector overview with exact pair identity and readiness.** Acceptance: Opening any seam never appears to target another pair after reordering. Required verification: Selected seam removal and request join tests. **Implementation: Not started.**
- [ ] **S4-0101-02 — Differentiate requested setting, working render and audible fallback.** Acceptance: User understands why actual rendered move differs. Required verification: Fallback, delayed render and failed render fixtures. **Implementation: Not started.**
- [ ] **S4-0101-03 — Redesign move picker while retaining every available transition style.** Acceptance: All old options, disabled reasons and semantics remain operable. Required verification: Option parity and keyboard selection tests. **Implementation: Not started.**
- [ ] **S4-0101-04 — Reorganize bar/cue/overlap controls by outgoing/incoming/handoff.** Acceptance: Every existing parameter persists exactly and is validated. Required verification: Boundary, missing cue and out-of-range tests. **Implementation: Not started.**
- [ ] **S4-0101-05 — Preserve per-seam rendering, retry and status feedback.** Acceptance: No claim of success until matching output key is available. Required verification: Backend delayed/error/old server tests. **Implementation: Not started.**
- [ ] **S4-0101-06 — Define old/new preview identities and A/B only where actually supported.** Acceptance: No two labels point to one audio version falsely. Required verification: Preview key/snapshot and audio owner tests. **Implementation: Not started.**
- [ ] **S4-0101-07 — Harden concurrent setting changes and stale responses.** Acceptance: Older render result cannot overwrite newer intent. Required verification: Blend→Cut out-of-order response race. **Implementation: Not started.**
- [ ] **S4-0101-08 — Preserve rating/comment and detailed why information.** Acceptance: Feedback applies to actually heard transition version. Required verification: Rating after changed render and key mismatch. **Implementation: Not started.**
- [ ] **S4-0101-09 — Validate inspector tabs/sheet/focus and resize.** Acceptance: Keyboard, NVDA, touch and zoom remain usable. Required verification: Tabs/resize/close/focus-return tests. **Implementation: Not started.**
- [ ] **S4-0101-10 — Record musical quality limitations distinctly from technical readiness.** Acceptance: Successful render not falsely scored good by algorithm. Required verification: Human auditory review on diverse transitions. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0102 — Stem Studio eight-lane arrangement, accessible time grid and recovery-safe Apply](adr-0102-stem-studio-arrangement-grid-and-recovery.md)

**Phase:** 6 Expert. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0102-01 — Redesign Studio pair header, ruler and eight-lane grid hierarchy.** Acceptance: Track/stem/time identities are always understandable. Required verification: 8/16/32/64-cell screenshot and screen reader tests. **Implementation: Not started.**
- [ ] **S4-0102-02 — Preserve mouse, touch, Space, arrow, Home/End and Ctrl+Home/End grid actions.** Acceptance: All grid operations act on correct cell with visible focus. Required verification: ARIA grid keyboard and touch-scroll suite. **Implementation: Not started.**
- [ ] **S4-0102-03 — Make labels and time orientation sticky where appropriate.** Acceptance: Horizontal scroll never hides which stem or song is edited. Required verification: Narrow viewport, zoom, scroll tests. **Implementation: Not started.**
- [ ] **S4-0102-04 — Preserve solo/mute and missing-stem disabling truthfully.** Acceptance: Missing media cannot be toggled as if auditionable. Required verification: Partial/missing/corrupt stem fixtures. **Implementation: Not started.**
- [ ] **S4-0102-05 — Unify preview transport and audio-focus lifecycle.** Acceptance: Closing, failing, switching preview cannot overlap main mix. Required verification: Studio→Inspector→Listen audio-owner races. **Implementation: Not started.**
- [ ] **S4-0102-06 — Clarify dirty, recovered, applied and rendered states.** Acceptance: User knows if work has reached the mix or audio file. Required verification: Apply pending/complete/failure screenshot + data assertions. **Implementation: Not started.**
- [ ] **S4-0102-07 — Preserve validated local working-copy recovery.** Acceptance: Malformed, wrong cell count or wrong pair data not misapplied. Required verification: Storage blocked, invalid JSON, 64-to-8 migration tests. **Implementation: Not started.**
- [ ] **S4-0102-08 — Preserve human/AI arrangements and undo Put it back.** Acceptance: Late generated suggestions cannot erase more recent manual edit. Required verification: AI response ordering, rapid toggles and retry. **Implementation: Not started.**
- [ ] **S4-0102-09 — Harden Apply against stale pair, draft and revision.** Acceptance: Failed Apply retains local work and does not modify other draft. Required verification: Concurrent reorder, draft switch and server timeout tests. **Implementation: Not started.**
- [ ] **S4-0102-10 — Explore alternate accessible nonspatial lane editor without capability loss.** Acceptance: All toggles could be operated via conventional controls if adopted. Required verification: Human NVDA tasks before acceptance. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0103 — Requests drawer, bridge alternatives, explicit consent and atomic joining](adr-0103-request-states-bridge-consent-and-atomic-join.md)

**Phase:** 7 Discovery. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0103-01 — Rebuild request search and matching results with song identity.** Acceptance: No wrong duplicate-title selection or inaccessible result. Required verification: Rapid search, Unicode, duplicate ID and keyboard tests. **Implementation: Not started.**
- [ ] **S4-0103-02 — Map all backend request states to truthful user-facing groups.** Acceptance: Waiting/approval/preparing/ready are not conflated. Required verification: State transition matrix including stalled/offline. **Implementation: Not started.**
- [ ] **S4-0103-03 — Prioritize decisions needing human action within drawer.** Acceptance: Pending approvals cannot be buried in long list. Required verification: 50+ requests scrolling and focus tests. **Implementation: Not started.**
- [ ] **S4-0103-04 — Design entire bridge path and extra-song consent.** Acceptance: Every inserted extra track is explicitly approved. Required verification: Proposed/declined/approved route E2E. **Implementation: Not started.**
- [ ] **S4-0103-05 — Preserve alternate bridge finder and preview.** Acceptance: Selection controls don't imply a path is already inserted. Required verification: Unavailable preview, missing bridge and selection race tests. **Implementation: Not started.**
- [ ] **S4-0103-06 — Preserve Play it anyway as deliberate override.** Acceptance: Warning clear and backend override behaves as before. Required verification: Rough transition and failure tests. **Implementation: Not started.**
- [ ] **S4-0103-07 — Represent uncommitted requests as provisional editor rows.** Acceptance: Ghost rows never claim they already play or render. Required verification: Timeline request join/reorder tests. **Implementation: Not started.**
- [ ] **S4-0103-08 — Guarantee atomic insertion and operation idempotency.** Acceptance: Whole approved route inserts once or not at all. Required verification: Partial render fail/retry/two-tab duplicate tests. **Implementation: Not started.**
- [ ] **S4-0103-09 — Harden cancel/approval and late polling reconciliation.** Acceptance: Cancelled request cannot reappear due to older result. Required verification: Cancellation vs join and out-of-order poll tests. **Implementation: Not started.**
- [ ] **S4-0103-10 — Explain request dependencies and no-mix waiting.** Acceptance: Request order never falsely promised when music routing varies. Required verification: Multi-request/dependency/empty-mix scenarios. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0104 — Lyric-word connections, harmonic four-stage auditions and version-bound feedback](adr-0104-word-connections-harmonic-discovery-and-feedback.md)

**Phase:** 7 Discovery. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0104-01 — Redesign word-connection result card hierarchy.** Acceptance: Shared phrase and exact two tracks precede technical controls. Required verification: Multiple/zero/weak matches snapshots. **Implementation: Not started.**
- [ ] **S4-0104-02 — Preserve pair previews and actual rendered transition context.** Acceptance: Preview-ready is different from render requested. Required verification: Slow/failed/mismatched render tests. **Implementation: Not started.**
- [ ] **S4-0104-03 — Preserve word-pair add-to-mix/draft and placement.** Acceptance: Both tracks and transition join according to existing atomic contract. Required verification: Pair insertion, duplicate ID, wrong-scope tests. **Implementation: Not started.**
- [ ] **S4-0104-04 — Preserve move change, Good/Bad rating and feedback key.** Acceptance: Rating applies only to corresponding audible version. Required verification: Change move during rating race. **Implementation: Not started.**
- [ ] **S4-0104-05 — Rebuild harmonic stage progress and audition controls.** Acceptance: Four stages remain in order, with replay and safe Stop. Required verification: Audition stage timing and individual replay tests. **Implementation: Not started.**
- [ ] **S4-0104-06 — Use text/time indicators beyond colour-only chord strip.** Acceptance: Current stage/chord information discernible at zoom and via AT. Required verification: Contrast, NVDA and keyboard tests. **Implementation: Not started.**
- [ ] **S4-0104-07 — Preserve Yes/No/Skip semantics and record saves.** Acceptance: No double submission or wrong pair rating. Required verification: Rapid skip/rate/reload/error tests. **Implementation: Not started.**
- [ ] **S4-0104-08 — Handle missing or failed audio with truthful recovery.** Acceptance: Cannot claim audio heard when clip unavailable. Required verification: Missing clip, delayed preparation tests. **Implementation: Not started.**
- [ ] **S4-0104-09 — Keep main playback isolated during audition.** Acceptance: No simultaneous owner or surprise resumption. Required verification: Preview ownership switching with Listen/Studio. **Implementation: Not started.**
- [ ] **S4-0104-10 — Document learning-versus-playlist outcomes in labels.** Acceptance: Users understand feedback does not automatically alter mix. Required verification: Unassisted task question and content review. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0105 — Large-Library browse, URL-backed search, readiness filters and 20k-song responsiveness](adr-0105-library-browse-search-filters-and-scale.md)

**Phase:** 8 Library. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0105-01 — Redesign desktop list and mobile card-row hierarchy.** Acceptance: Titles, artist, status and actions remain legible with dense data. Required verification: 320/375/768/1280 and 20k screenshot fixtures. **Implementation: Not started.**
- [ ] **S4-0105-02 — Preserve all existing Library actions and availability rules.** Acceptance: Add/Play next/Start a mix/Analyze/Prioritize/Never play intact. Required verification: Feature parity and action-by-readiness tests. **Implementation: Not started.**
- [ ] **S4-0105-03 — Preserve URL-backed search/filter/page and history semantics.** Acceptance: Reload/Back/Forward restore correct browse state. Required verification: Deep link and browser navigation E2E. **Implementation: Not started.**
- [ ] **S4-0105-04 — Harden asynchronous search and debouncing.** Acceptance: Late query response cannot replace newer result. Required verification: Rapid typing/empty query/server failure tests. **Implementation: Not started.**
- [ ] **S4-0105-05 — Design filter grouping and clear active state.** Acceptance: Every preexisting filter remains accessible and visible. Required verification: Filter-combination/multi-select tests. **Implementation: Not started.**
- [ ] **S4-0105-06 — Clarify ready/processing/failed/excluded reasons.** Acceptance: Badges never falsely mark track as mix-ready. Required verification: Canonical backend readiness fixture cases. **Implementation: Not started.**
- [ ] **S4-0105-07 — Fix deep-page readiness freshness during processing.** Acceptance: Currently displayed page updates without requiring return to page 1. Required verification: Page >200 refresh and analysis progress tests. **Implementation: Not started.**
- [ ] **S4-0105-08 — Measure pagination versus virtualization before changing architecture.** Acceptance: Focus/find-in-page/AT/scroll restoration not sacrificed. Required verification: 20k rows, 100-page deep browsing and memory tests. **Implementation: Not started.**
- [ ] **S4-0105-09 — Support missing, long, duplicate and RTL metadata.** Acceptance: Search and list never produce wrong song action. Required verification: Synthetic Unicode/colliding titles tests. **Implementation: Not started.**
- [ ] **S4-0105-10 — Review new advanced tempo/key/genre filters separately.** Acceptance: No unsupported analysis field presented as available. Required verification: Backend capability flag tests if enhancement approved. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0106 — Song Details, measured-versus-corrected metadata, classification and safe source management](adr-0106-song-details-corrections-and-local-sources.md)

**Phase:** 8 Library. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0106-01 — Redesign Song Details section hierarchy and accessibility.** Acceptance: Relevant identity/readiness easy before technical metadata. Required verification: Readiness variants and NVDA reading order. **Implementation: Not started.**
- [ ] **S4-0106-02 — Preserve measured, override and effective BPM/key distinction.** Acceptance: UI never mislabels manual value as measured. Required verification: Half/double/blank/reset and server validation tests. **Implementation: Not started.**
- [ ] **S4-0106-03 — Harden correction constraints and input errors.** Acceptance: Out-of-range and malformed Camelot values retain draft input. Required verification: Boundary, locale decimal and invalid text tests. **Implementation: Not started.**
- [ ] **S4-0106-04 — Expose downstream analysis/transition effects without overclaiming.** Acceptance: User knows edits may trigger rerender without fake guarantee. Required verification: Dependent render invalidation contract tests. **Implementation: Not started.**
- [ ] **S4-0106-05 — Preserve prioritize/exclude/never/play/music classification.** Acceptance: Actions remain scoped to exact song ID. Required verification: Duplicate-name and conflicting updates tests. **Implementation: Not started.**
- [ ] **S4-0106-06 — Design analysed/partial/failed/unsuitable readiness explanation.** Acceptance: No false ready from missing beat or key fields. Required verification: Readiness state decision table tests. **Implementation: Not started.**
- [ ] **S4-0106-07 — Preserve Library context after closing Song Details.** Acceptance: Search page and focused song restored where valid. Required verification: Back/Forward and deletion focus tests. **Implementation: Not started.**
- [ ] **S4-0106-08 — Represent watched, missing and disconnected sources separately.** Acceptance: Unavailable drive is not interpreted as deleted audio. Required verification: Disconnect/reconnect/path change fixtures. **Implementation: Not started.**
- [ ] **S4-0106-09 — Verify folder removal semantics and local-file safety.** Acceptance: Stop watch never deletes user music. Required verification: Filesystem snapshot backend contract tests. **Implementation: Not started.**
- [ ] **S4-0106-10 — Maintain local-first privacy in diagnostics/copy actions.** Acceptance: No accidental private paths in sharing surfaces. Required verification: Redaction, permissions and text injection tests. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0107 — Workspace operations, background analysis, watched sources, storage and diagnostics](adr-0107-workspace-analysis-sources-storage-and-diagnostics.md)

**Phase:** 9 Operations. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0107-01 — Redesign Workspace overview with attention hierarchy.** Acceptance: Actual blockers distinguish from harmless background activity. Required verification: Storage full, no-ready-songs, offline fixtures. **Implementation: Not started.**
- [ ] **S4-0107-02 — Preserve analysis start/pause/progress and deprioritization.** Acceptance: Processing state is accurate while user listens. Required verification: Paused/playing/restart/poll cases. **Implementation: Not started.**
- [ ] **S4-0107-03 — Preserve folder source watch/unwatch and recovery.** Acceptance: Missing drive shown separately from stopped watch. Required verification: Permission, disconnect, rescan and original-file tests. **Implementation: Not started.**
- [ ] **S4-0107-04 — Rebuild storage budget/meter and meaning labels.** Acceptance: Cache is not confused with durable data or originals. Required verification: Slider min/max/save failed/rapid changes. **Implementation: Not started.**
- [ ] **S4-0107-05 — Preserve background render jobs, priorities and queue.** Acceptance: Job accepted distinct from complete; queue actions correct. Required verification: Failure, cancel and duplicate mutation tests. **Implementation: Not started.**
- [ ] **S4-0107-06 — Clarify learning feedback and locate blind study.** Acceptance: Ratings and formal A/B trials remain separate. Required verification: Task findability and study context tests. **Implementation: Not started.**
- [ ] **S4-0107-07 — Preserve diagnostics operations with privacy-safe copying.** Acceptance: Copied data contains only declared safe fields. Required verification: Actual payload inspection and path-redaction tests. **Implementation: Not started.**
- [ ] **S4-0107-08 — Expose global critical health attention without header clutter.** Acceptance: Blockers visible outside Workspace with direct route. Required verification: Mobile More and accessible indicator tests. **Implementation: Not started.**
- [ ] **S4-0107-09 — Harden offline/recovery and old-server capability detection.** Acceptance: Failure to fetch not represented as zero cache usage. Required verification: Backend restart, unsupported API tests. **Implementation: Not started.**
- [ ] **S4-0107-10 — Measure quiet background polling impact on UI/audio.** Acceptance: No excessive refreshes or animation stutter. Required verification: Performance trace during analysis and render. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0108 — Export audio, revision-pinned FLAC jobs, durable progress and verified downloads](adr-0108-flac-export-jobs-and-frozen-revisions.md)

**Phase:** 9 Operations. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0108-01 — Standardize Save/Export/Download terminology across routes.** Acceptance: User cannot confuse editable project and completed file. Required verification: Copy audit plus unassisted task comprehension. **Implementation: Not started.**
- [ ] **S4-0108-02 — Redesign pre-export scope/snapshot confirmation.** Acceptance: Exact source and revision visible before submission. Required verification: Current/draft same-name and edited-after-start cases. **Implementation: Not started.**
- [ ] **S4-0108-03 — Preserve revision-pinned export backend job.** Acceptance: Mix edits after submission do not affect FLAC bytes. Required verification: Frozen snapshot and server contract tests. **Implementation: Not started.**
- [ ] **S4-0108-04 — Design queued/rendering/encoding/ready/failed/cancelled/expired stages.** Acceptance: No invented readiness or percent on incomplete backend data. Required verification: Job state fixture screenshots. **Implementation: Not started.**
- [ ] **S4-0108-05 — Preserve export while dialog closes, route changes or browser reloads.** Acceptance: Authoritative job remains retrievable independent of UI. Required verification: Reload/draft switch/Stage navigation tests. **Implementation: Not started.**
- [ ] **S4-0108-06 — Harden cancel/retry/duplicate export and idempotency.** Acceptance: Interrupted mutation does not create duplicate job unnoticed. Required verification: Server timeout, twice-submit and cancel race tests. **Implementation: Not started.**
- [ ] **S4-0108-07 — Make correct download discoverable and failure recoverable.** Acceptance: No missing/expired file shown as downloadable. Required verification: Expired URL, storage full and unauthorized route tests. **Implementation: Not started.**
- [ ] **S4-0108-08 — Verify actual FLAC file identity and decode correctness.** Acceptance: Decodable output matches song order, duration and frozen transitions. Required verification: Decode file, compare sample format/timing/revision. **Implementation: Not started.**
- [ ] **S4-0108-09 — Clarify transitions prepared or falling back at export start.** Acceptance: Export status accurately reports technical readiness. Required verification: Missing seam, fallback and rerender fixture tests. **Implementation: Not started.**
- [ ] **S4-0108-10 — Record real listening acceptance separately from encoder success.** Acceptance: Successful encode not evidence of musically good handoff. Required verification: Audible review with representative transition set. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0109 — Blind A/B listening study, harmonic feedback and learning-data integrity](adr-0109-blind-listening-study-and-learning-integrity.md)

**Phase:** 9 Operations. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0109-01 — Inventory exact trial protocol and field requirements before UI changes.** Acceptance: No study variable is removed or accidentally exposed. Required verification: Protocol comparison against backend and tests. **Implementation: Not started.**
- [ ] **S4-0109-02 — Redesign enrollment, session status and progress hierarchy.** Acceptance: Study code/input failure and session recovery understandable. Required verification: Invalid/expired code/reload tests. **Implementation: Not started.**
- [ ] **S4-0109-03 — Create accessible Version A/B transport.** Acceptance: Correct clip, no main-player overlap or wrong label. Required verification: Real media and focus/keyboard tests. **Implementation: Not started.**
- [ ] **S4-0109-04 — Preserve exact heard-before-answer constraint where applicable.** Acceptance: UI cannot accept unsupported judgement or bypass required listen. Required verification: Missing clip and incomplete audition tests. **Implementation: Not started.**
- [ ] **S4-0109-05 — Preserve preference, quality and multi-tag form.** Acceptance: Data values correspond to existing response schema. Required verification: Validation/boundary/selection tests. **Implementation: Not started.**
- [ ] **S4-0109-06 — Prevent version provenance leakage in UI/logs.** Acceptance: Blind A/B identity not inferable from labels, URLs or status. Required verification: Protocol/privacy review and E2E. **Implementation: Not started.**
- [ ] **S4-0109-07 — Make submit pending/success/failure and retry truthful.** Acceptance: Duplicate or timed-out submit cannot record multiple trials. Required verification: Idempotent save and reordered response tests. **Implementation: Not started.**
- [ ] **S4-0109-08 — Handle skip, no trials left and early exit safely.** Acceptance: No false completion and session state recoverable. Required verification: Skip/reload/end-of-study tests. **Implementation: Not started.**
- [ ] **S4-0109-09 — Protect main audio ownership during study.** Acceptance: Explicit pause/resume policy never surprises listener. Required verification: Listen→study→Listen handoff tests. **Implementation: Not started.**
- [ ] **S4-0109-10 — Record human comprehension and actual protocol acceptance.** Acceptance: No claimed scientific validity without review. Required verification: Researcher sign-off and task observation. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0110 — WCAG 2.2 AA accessibility, keyboard ownership, touch, reflow and human assistive technology](adr-0110-wcag-keyboard-zoom-motion-and-screen-readers.md)

**Phase:** 1–11 Cross-cutting. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0110-01 — Audit keyboard tab order/landmarks/headings on every route.** Acceptance: Core journeys complete with no focus trap. Required verification: Keyboard-only listener/creator/expert scripts. **Implementation: Not started.**
- [ ] **S4-0110-02 — Fix Space conflict on custom role-button reorder grip.** Acceptance: Space activates focused control rather than global playback. Required verification: Targeted custom button/global handler test. **Implementation: Not started.**
- [ ] **S4-0110-03 — Define shortcuts preference and assistive-tech-safe ownership.** Acceptance: Single-character shortcuts can be turned off/remapped as required. Required verification: Typing in text fields, modal and grid tests. **Implementation: Not started.**
- [ ] **S4-0110-04 — Verify draggable interactions have non-drag alternatives.** Acceptance: Reorder/insertion and sliders accessible without dragging. Required verification: Touch/keyboard/pointer alternatives acceptance. **Implementation: Not started.**
- [ ] **S4-0110-05 — Audit form/search/tab/menu/grid ARIA patterns.** Acceptance: Semantics reflect actual key model and status. Required verification: NVDA/Edge and component axe checks. **Implementation: Not started.**
- [ ] **S4-0110-06 — Test 200/400% zoom and 320px reflow.** Acceptance: No essential hidden action or keyboard-trapped scroll. Required verification: Viewport screenshot and manual reflow test. **Implementation: Not started.**
- [ ] **S4-0110-07 — Verify touch target spacing, high contrast and focus visibility.** Acceptance: Measured exceptions documented; not colour-only. Required verification: Computed geometry and forced-colours tests. **Implementation: Not started.**
- [ ] **S4-0110-08 — Implement reduced-motion and restrained progress announcements.** Acceptance: Visual state preserved while decorative motion disabled. Required verification: prefers-reduced-motion and live-region checks. **Implementation: Not started.**
- [ ] **S4-0110-09 — Handle mobile safe areas/soft keyboard/short landscape.** Acceptance: Focused input, submit and Close reachable. Required verification: Real/simulated mobile keyboard task. **Implementation: Not started.**
- [ ] **S4-0110-10 — Record manual screen-reader tests with precise environment.** Acceptance: Automated passes not called full WCAG compliance. Required verification: Named NVDA/Edge and available VoiceOver/TalkBack task results. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0111 — Frontend module boundaries, CSS performance, 20k/100-song scale and local-first privacy](adr-0111-frontend-architecture-performance-and-privacy.md)

**Phase:** 1–11 Cross-cutting. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0111-01 — Document component/domain ownership and import boundaries.** Acceptance: App.tsx complexity reduced incrementally without duplicated stores. Required verification: Dependency diagram and tests. **Implementation: Not started.**
- [ ] **S4-0111-02 — Separate persistent player state from route composition.** Acceptance: Theme/route/overlay re-render cannot stop playback. Required verification: Transport continuity E2E. **Implementation: Not started.**
- [ ] **S4-0111-03 — Inventory API responses and version compatibility.** Acceptance: Missing fields produce honest unsupported states, not fake success. Required verification: Old-server feature detection and contract tests. **Implementation: Not started.**
- [ ] **S4-0111-04 — Audit CSS layering and component specificity regressions.** Acceptance: No expensive blanket override cascade or unrelated changes. Required verification: Stylelint/static check and visual diffs. **Implementation: Not started.**
- [ ] **S4-0111-05 — Profile 20k Library search/filter/deep refresh.** Acceptance: Input responsiveness and memory meet measured budget. Required verification: Hardware/version controlled performance traces. **Implementation: Not started.**
- [ ] **S4-0111-06 — Profile 100-song Editor reorder/selection/scroll.** Acceptance: No long main-thread stall or focus loss. Required verification: Performance and keyboard task under workload. **Implementation: Not started.**
- [ ] **S4-0111-07 — Profile full 64-cell Studio and simultaneous analysis/render.** Acceptance: Cell toggle and preview respond smoothly without audio dropout. Required verification: Real-machine memory/frame/audio trace. **Implementation: Not started.**
- [ ] **S4-0111-08 — Control fast lyric/visualizer updates and hidden work.** Acceptance: No global per-frame React rerender, reduced motion supported. Required verification: Profiler, offscreen and animation testing. **Implementation: Not started.**
- [ ] **S4-0111-09 — Preserve browser preference and local recovery migration.** Acceptance: Invalid/blocked storage cannot crash or erase durable backend data. Required verification: Malformed values, quota, rollback test. **Implementation: Not started.**
- [ ] **S4-0111-10 — Audit local-first privacy, diagnostics and added asset requests.** Acceptance: No new remote tracking/artwork or original-file write without separate review. Required verification: Network activity/redaction/Host-Origin security tests. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0112 — Full regression strategy, stable test fixtures, visual review and adversarial races](adr-0112-tests-matrix-visual-e2e-and-concurrency.md)

**Phase:** 0–12 Verification. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0112-01 — Inventory all prior Python, Web, audio and Edge tests and contracts.** Acceptance: No behavioural assertion silently dropped due to selector change. Required verification: File-by-file old-to-new test mapping. **Implementation: Not started.**
- [ ] **S4-0112-02 — Create deterministic fixtures for small/large/error/race states.** Acceptance: Fixtures independent and avoid private user music. Required verification: Isolated server/data setup and seeded media checks. **Implementation: Not started.**
- [ ] **S4-0112-03 — Establish component interaction/state suite for shared controls.** Acceptance: Every default/focused/pressed/busy/error variant covered. Required verification: Unit, component, keyboard tests. **Implementation: Not started.**
- [ ] **S4-0112-04 — Expand transport/audio-focus and player lifecycle regression.** Acceptance: No unintended overlap/stop/resume across every preview owner. Required verification: Pairwise player-owner matrix and real-media checks. **Implementation: Not started.**
- [ ] **S4-0112-05 — Expand current/draft/editor/request/export concurrency suite.** Acceptance: No wrong pair, duplicate join, partial bridge or wrong FLAC. Required verification: Sequences A–J in verification matrix. **Implementation: Not started.**
- [ ] **S4-0112-06 — Promote screenshot captures to reviewed golden comparisons.** Acceptance: Each intended diff approved and stored with fixture metadata. Required verification: Playwright toHaveScreenshot pinned browser. **Implementation: Not started.**
- [ ] **S4-0112-07 — Run automated WCAG checks plus manual AT acceptance.** Acceptance: Axe pass not misreported as manual conformance. Required verification: Per-route axe + NVDA/Edge session logs. **Implementation: Not started.**
- [ ] **S4-0112-08 — Measure large-data performance and export audio bytes.** Acceptance: 20k/100-song/64 cell and decodable snapshot-accurate FLAC. Required verification: Performance traces and audio decode assertions. **Implementation: Not started.**
- [ ] **S4-0112-09 — Require negative/offline/recovery/old server fixtures.** Acceptance: Failed, stale, interrupted and recovered visibly distinct. Required verification: Fault injection including timeout/duplicate response. **Implementation: Not started.**
- [ ] **S4-0112-10 — Publish CI matrix, flakes, quarantine policy and evidence links.** Acceptance: No broad test skip/update of failing snapshot to force green. Required verification: Exact-head checks, flake owner and PR review. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

### [ADR-0113 — User research, phased migration, evidence ledger, rollback and explicit go/no-go](adr-0113-research-migration-rollback-and-release.md)

**Phase:** 0–13 Governance/release. **Decision:** Accepted. **Implementation:** Not started. **Verified:** 0/10.

- [ ] **S4-0113-01 — Approve baseline, explicit feature parity and release-owner responsibilities.** Acceptance: Every invariant/test has named owner and no inherited status guesses. Required verification: Recorded baseline signature and task mapping. **Implementation: Not started.**
- [ ] **S4-0113-02 — Conduct initial qualitative listener/creator/expert tasks.** Acceptance: Observed findings logged with no fabricated usability success. Required verification: Participant tasks and reproducible notes. **Implementation: Not started.**
- [ ] **S4-0113-03 — Approve dark/light visual design and content hierarchy separately.** Acceptance: Both themes independently inspected across devices and states. Required verification: Reviewed screenshot sets and contrast report. **Implementation: Not started.**
- [ ] **S4-0113-04 — Sequence implementing PRs behind reversible dev feature flag.** Acceptance: Each PR isolated, roll-backable and names S4 task IDs. Required verification: Feature flag and route compatibility smoke. **Implementation: Not started.**
- [ ] **S4-0113-05 — Define operational migration for preferences and local working copies.** Acceptance: No lost drafts, corrections, ratings, settings or Studio recoveries. Required verification: Old→new→old fixture migration tests. **Implementation: Not started.**
- [ ] **S4-0113-06 — Review new dependencies, backend needs and PWA compatibility separately.** Acceptance: No unapproved engine/data/network change hidden in UI work. Required verification: API/dependency/security PR checklist. **Implementation: Not started.**
- [ ] **S4-0113-07 — Require critical cross-feature and real audio acceptance.** Acceptance: Playback, requests, revisions and FLAC verified end-to-end. Required verification: Windows/Edge and decodable export session. **Implementation: Not started.**
- [ ] **S4-0113-08 — Require WCAG/human AT, viewport and performance evidence.** Acceptance: No inaccessible core workflow and measured scale regression. Required verification: NVDA/Edge and recorded profiler results. **Implementation: Not started.**
- [ ] **S4-0113-09 — Reconcile P0/P1/P2 defects and acceptance exceptions.** Acceptance: P0 blocks; P1 owner risk approval documented; P2 disposition. Required verification: Issue register, exact SHA and owner signoff. **Implementation: Not started.**
- [ ] **S4-0113-10 — Prepare exact-head release report and demonstrate rollback.** Acceptance: Final verdict explicitly GO/NO-GO with linked proof. Required verification: Release runbook and rollback exercise. **Implementation: Not started.**

**Exit gate:** Accepted decision, merged implementation, preserved old tests, observed negative cases and reviewed per-task evidence.

## Global completion policy

1. No capability is removed to make screenshots cleaner; compare with [4.0 feature parity](selecta-4-feature-parity.md).
2. Replaced UI selectors may change test code, but every existing behavioural assertion must remain protected.
3. Each implementing PR cites `S4-XXXX-NN`, owner, exact commit, API contract, fault tests, dark/light screenshots, accessibility and real audio where relevant.
4. Progress is recorded as **In progress** or **Implemented** in [the evidence ledger](selecta-4-evidence.md); check the box only at independent **Verified**.
5. Previous S3/S31 statuses are historical and do not automatically count toward S4.
6. Releasing actual 4.0 UI requires the separate [NO-GO/GO gate](selecta-4-release-gates.md).
