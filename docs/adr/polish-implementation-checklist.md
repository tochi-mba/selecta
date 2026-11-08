# Selecta UI/UX polish — implementation checklist

- **Decision status:** Accepted for implementation by the owner
- **Implementation status:** PR [#23](https://github.com/tochi-mba/selecta/pull/23) merged as `84b8b5cbadf7204bf526e8932124b5c4890e2c44`; the original 0/143 task snapshot still requires item-by-item source and independent-evidence reconciliation.
- **Created:** 2026-11-06
- **Scope:** 143 tasks across 14 new ADRs and 8 phases. **Completed: 0.**
- **Implementation PR:** [#23](https://github.com/tochi-mba/selecta/pull/23), merged. See the [repository checklist audit](implementation-checklist-audit.md); merge state is not a blanket verification claim.

## How to use this checklist

1. This is a new programme. Preserve the historical [T-task checklist](implementation-checklist.md) and [its evidence](implementation-evidence.md). Its historical instruction to implement everything on that branch is historical; the owner has now authorized implementation on PR #23.
2. Use stable P-prefixed IDs. Before coding, map inherited unfinished T tasks and existing capability to these P tasks; existing implementation can be reused, but new verification must have evidence.
3. This committed checklist is the canonical task state. PR bodies link to it rather than becoming an independently maintained second checklist.
4. Tick a task only when its deliverable and acceptance evidence are recorded in [the evidence ledger](polish-implementation-evidence.md). Runtime tasks require implemented code and relevant tests; partial work remains unchecked.
5. Separate decision approval from execution: Proposed does not mean Accepted; code on a branch does not mean merged or Verified. Record implementing PR/commit and remaining checks.
6. Keep human listening, screen readers, installed-app and user-testing checks unchecked until performed. A plan, mocked success or automatic scan cannot substitute.
7. Apply accessibility, responsive and failure-state requirements during every phase; phases 6 and 7 verify the integrated result.
8. Add new findings with new IDs. Do not renumber IDs or quietly drop hard cases.

**Invariants:** preserve source music, drafts, ratings, settings, existing routes/features, current/draft isolation, audio continuity and ownership, explicit bridge consent and atomic insertion, truthful readiness/exports and localhost/privacy boundaries.

**Priority:** P0 = integrity or essential-access blocker; P1 = task, recovery or misleading-state problem; P2 = consistency/detail defect. All are in scope; fix blockers before decorative polish.

**Common state contract:** for each surface evaluate initial loading, populated, empty, partial, refreshing, saving, success, failed, offline, unavailable and recovery states. Record not-applicable cases with reasons.

## Phase 00 — Baseline and scope

### [ADR-0033 — Polish baseline, complete state inventory and evidence governance](adr-0033-polish-baseline-and-governance.md)

- [ ] P0001 — Pin the full baseline commit and record supported browser, OS, installed-app and device assumptions; distinguish source inspection from rendered and audible evidence.
- [ ] P0002 — Inventory every route, subview, overlay and shared component, including first launch, missing routes, missing drafts, multi-tab takeover and reconnect.
- [ ] P0003 — Record applicable initial/loading/populated/empty/partial/refreshing/saving/success/failed/offline/unavailable/recovery states for each surface; explain every not-applicable entry.
- [ ] P0004 — Capture deterministic baseline screenshots in dark and light themes with long, missing, duplicate and mixed-direction metadata; keep private song data out of published fixtures.
- [ ] P0005 — Map existing feature-parity rows and unfinished T tasks to new P tasks; retain original task IDs and evidence, and identify inherited work without double-counting completion.
- [ ] P0006 — Write casual-listener, creator and expert-editor task scripts, including desired outcomes and observable errors.
- [ ] P0007 — Classify findings as P0 integrity/access blockers, P1 task/recovery problems or P2 consistency/detail defects; give each a location, impact and acceptance check.
- [ ] P0008 — Record decision acceptance separately from implementation progress; record the owner’s implementation authorization and move statuses only when work exists.
- [ ] P0009 — Create an evidence entry for each task when work begins, including implementation PR, commit, test/capture and remaining manual checks; partial tasks remain unchecked.
- [ ] P0010 — Confirm this programme preserves source music, drafts, ratings, current/draft isolation, audio ownership, bridge consent, FLAC correctness and localhost boundaries.

**Exit gate:** A reviewer can locate every existing capability and meaningful state in the inventory, trace inherited work, and distinguish planned work from verified behaviour.

## Phase 01 — Visual foundations and language

### [ADR-0034 — Precise visual foundations, typography and coherent iconography](adr-0034-polish-visual-system.md)

- [ ] P0011 — Specify display/page/section/body/label/metadata/numeric typography, line heights, weights and fallback fonts; reserve oversized display type for appropriate screens.
- [ ] P0012 — Define tabular time/count numerals and consistent units, number formats and baseline alignment.
- [ ] P0013 — Map page gutters, row padding, section spacing, label gaps and action groups to a documented spacing scale, with explicit exceptions.
- [ ] P0014 — Define listening, browsing and editing content-width/density rules and responsive transitions.
- [ ] P0015 — Define semantic surface, border, text, selected, focus, playback, working, warning and error treatments in both themes.
- [ ] P0016 — Replace mixed emoji/Unicode UI icons with a consistent local vector family, sizing, stroke, optical alignment and accessible-label rules.
- [ ] P0017 — Specify radii, separators, overlays and stacking; inspect overlay, player, navigation and notification intersections.
- [ ] P0018 — Define long-title wrapping, truncation with accessible full text, unknown metadata, Unicode/RTL and missing-artwork treatment without invented assets.
- [ ] P0019 — Audit actual text/control contrast and fallback-font rendering independently in dark and light themes; record measurements and screenshots.
- [ ] P0020 — Migrate feature styles incrementally, check selector collisions and remove unexplained one-off values without changing audio or domain logic.

**Exit gate:** The state gallery and representative screens use documented visual roles consistently, with measured contrast and reviewed typography/alignment in both themes.

### [ADR-0044 — Consistent product vocabulary, truthful explanations and restrained motion](adr-0044-polish-language-and-motion.md)

- [ ] P0112 — Define everyday transition terminology and explicitly distinguish current mix, draft, playback order and processing queue.
- [ ] P0113 — Audit every action label, tooltip, empty/error/loading message and notification for specific outcome and consistent voice.
- [ ] P0114 — Standardize sentence case, punctuation, pluralization, durations, counts, keyboard hints and units.
- [ ] P0115 — Give errors appropriate what-happened/what-remains-safe/next-action content without unsupported reassurance.
- [ ] P0116 — Explain when steering takes effect and distinguish requested, estimated and confirmed outcomes.
- [ ] P0117 — Keep explanations factual and on demand; retain a clear distinction between automated checks and human musical judgment.
- [ ] P0118 — Specify duration/easing/property roles for hover, press, overlays, skeletons, lyrics and playback motion; avoid decorative movement that shifts targets.
- [ ] P0119 — Respect reduced motion for all CSS and canvas effects, including changes to the preference while the app is open.
- [ ] P0120 — Review announcement frequency, truncation, mixed-language text and missing metadata with the same copy/motion rules.

**Exit gate:** The same concept and action have the same meaning everywhere, and animation supports feedback without misleading progress or disrupting control.

## Phase 02 — Shared components and loading

### [ADR-0035 — Complete shared control states, overlays and recoverable feedback](adr-0035-polish-components-and-feedback.md)

- [ ] P0021 — Inventory buttons, icon buttons, links, inputs, selects, sliders, chips, tabs, badges, rows, cards, menus, tooltips and overlays in a development-only state gallery.
- [ ] P0022 — Specify default/hover/pressed/selected/focus/disabled/busy/success/error states where applicable, including long labels and both themes.
- [ ] P0023 — Keep action geometry stable while labels change; prevent duplicate submission while preserving understandable busy and disabled semantics.
- [ ] P0024 — Provide persistent labels, inline validation, required/optional guidance and useful unavailable-action explanations; do not rely on placeholder text or hover alone.
- [ ] P0025 — Implement complete inspector tab focus, arrow-key navigation, selection and tab-panel relationships; distinguish route navigation links from tab widgets.
- [ ] P0026 — Verify dialog/drawer focus entry, containment, Escape, restoration, scroll boundaries and stacked overlay behaviour, including dirty-work handling.
- [ ] P0027 — Verify menus and tooltips with pointer, keyboard and touch; keep essential instructions visible outside tooltips.
- [ ] P0028 — Retain access to every actionable Undo under notification bursts, including more than three Undo messages; avoid silently evicting the only recovery path.
- [ ] P0029 — Make persistent failures actionable near their source, deduplicate repeated connectivity notices and avoid notification storms.
- [ ] P0030 — Keep destructive actions separate and use confirmation only for appropriate destructive consequences; preserve established undoable operations.
- [ ] P0031 — Run component keyboard/assistive checks and visual state comparisons before migrating consumers.

**Exit gate:** Every shared component has reviewed visual and behavioural states; keyboard focus, duplicate-submit prevention and Undo access survive async failures and notification collisions.

### [ADR-0036 — Content-shaped skeletons and truthful asynchronous state transitions](adr-0036-polish-loading-and-skeletons.md)

- [ ] P0032 — Design Mix card skeletons with the same title, description, metadata and reserved action geometry as populated cards.
- [ ] P0033 — Design Library row skeletons matching song/artist, facts and readiness columns at every layout mode.
- [ ] P0034 — Design Listen placeholders for title, waveform region and lyrics without drawing fake audio-derived waveform data.
- [ ] P0035 — Design Edit track/transition and inspector-content skeletons that preserve timeline and panel geometry.
- [ ] P0036 — Design Discover pair and Workshop information skeletons; keep modal chrome and known labels real.
- [ ] P0037 — Specify first-load versus background-refresh behaviour; preserve usable content, navigation, selection and playback during refresh.
- [ ] P0038 — Measure and choose a short-load reveal policy that avoids flicker; do not impose artificial minimum waits on already-ready content.
- [ ] P0039 — Use subtle theme-aware motion and a static reduced-motion variant; keep decorative bars out of the accessibility tree and announce each loading region once.
- [ ] P0040 — Provide actual job stages and labelled estimates for scanning, analysis, stem preparation, rendering and export; never fabricate percentages.
- [ ] P0041 — Replace failed or overdue retrieval with honest slow/error/retry states, including failed Listen details and inspector capability checks.
- [ ] P0042 — Test immediate, delayed, partial, failed, retried, stale and out-of-order responses without duplicate announcements or skeleton/content flashes.
- [ ] P0043 — Measure loading-to-content layout stability and verify focus/scroll position and action targets do not jump.

**Exit gate:** Each loader has specified entry, geometry, motion, completion, slow-response, error and retry behaviour; long jobs never remain anonymous skeletons.

## Phase 03 — Core listening, mixes and requests

### [ADR-0037 — First-run setup, truthful readiness and local privacy explanations](adr-0037-polish-onboarding-and-readiness.md)

- [ ] P0044 — Specify first-run composition, folder-path help, supported-content guidance and one clear primary action.
- [ ] P0045 — Distinguish invalid path, unavailable folder, empty folder, no supported music, scan in progress and scan failure.
- [ ] P0046 — Show finding songs, audio analysis, cue/lyric preparation and mix readiness as distinct facts using available backend information.
- [ ] P0047 — Explain the six-ready-song threshold and give an actionable reason when analysis is complete but too few songs can mix.
- [ ] P0048 — Let users inspect available Library/progress information while preparation continues where supported; identify any needed navigation work explicitly.
- [ ] P0049 — Verify actual lyric-network triggers and metadata fields and reconcile onboarding, README and privacy wording without claiming all operations are offline.
- [ ] P0050 — Specify optional native folder selection separately with safe local-path binding and typed fallback; no remote path upload or expanded server exposure.
- [ ] P0051 — Test retry, restart, copied-in files, Unicode paths, removed sources and return visits without losing setup progress.

**Exit gate:** A new user can identify the folder, understand what leaves the PC, see why preparation is blocked and reach the first playable mix without guessing.

### [ADR-0038 — Mix browsing, creation defaults and unmistakable draft scope](adr-0038-polish-mixes-and-drafts.md)

- [ ] P0052 — Refine the recommendation hero, duration choices and Customize hierarchy without hiding existing mix choices.
- [ ] P0053 — Standardize card typography, metadata, action order and unavailable-state explanations across all groups.
- [ ] P0054 — Differentiate Play now, Edit and Save as draft and put the effect on active playback beside replacement actions.
- [ ] P0055 — Keep current mix and saved drafts visually distinct, including paused, empty, rendering, ready, failed and unavailable states.
- [ ] P0056 — Make customization scope explicit: persistent defaults affect new mixes, not existing mixes.
- [ ] P0057 — Label requested versus achieved energy with a meaningful shared interpretation; audit normalization before claiming curves are directly comparable.
- [ ] P0058 — Polish destination search loading/no-results/failure/selection states and distinguish no ready match from request failure.
- [ ] P0059 — Standardize draft rename/copy/delete/prioritize/reorder feedback and distinguish rendering priority from playback order.
- [ ] P0060 — Verify switching and building while audio plays, failed builds, stale responses, undo and long mix names.

**Exit gate:** Users can create, save and edit another mix without accidentally replacing playback or confusing persistent defaults with current-mix edits.

### [ADR-0039 — Calm listening hierarchy, stable transport and shell continuity](adr-0039-polish-listen-and-shell.md)

- [ ] P0061 — Define default Listen hierarchy and compact view controls while retaining lyrics focus, spectrum and beat countdown preferences.
- [ ] P0062 — Keep Play/Pause/Resume, next/previous and volume stable across loading, paused, playing and transition states.
- [ ] P0063 — Differentiate Next song from Jump to transition in labels, icons, tooltips and shortcut help.
- [ ] P0064 — Design missing lyrics, untimed lyrics, instrumental, missing beat-grid, failed details and last-song layouts intentionally.
- [ ] P0065 — Keep feedback and next-song changes from moving the transport; retain factual requested-versus-playable transition explanations.
- [ ] P0066 — Review waveform seek/transition markers, countdown units and non-colour cues at normal and high zoom.
- [ ] P0067 — Coordinate rail/bottom navigation, mini-player, banners, safe areas and keyboard focus across all routes.
- [ ] P0068 — Verify fullscreen entry/exit/rejection, restored view preferences and reduced-motion visualizer/countdown behaviour.
- [ ] P0069 — Verify deep links, Back/Forward, scroll restoration, missing routes/drafts, media keys, multi-tab takeover and installed-app layout without duplicate audio.

**Exit gate:** Listening and steering remain effortless, controls do not move unexpectedly, and navigation/fullscreen/preview transitions preserve the established audio behaviour.

### [ADR-0042 — Understandable requests, explicit bridge consent and auditionable discovery](adr-0042-polish-requests-and-discovery.md)

- [ ] P0089 — Standardize requested/finding placement/preparing/scheduled/played/cancelled/failed labels across Requests, Listen and Edit.
- [ ] P0090 — Show planned insertion location when known and separate waiting, unavailable placement and actual failure.
- [ ] P0091 — Display bridge song sequence and added-track count before explicit approval; preserve all-or-nothing joining.
- [ ] P0092 — Polish request search, duplicate prevention, cancellation, retry, stale placement and no-match states.
- [ ] P0093 — Design word-pair cards around the connection and audio result with coherent rating and failed-render recovery.
- [ ] P0094 — Distinguish harmonic initial loading from no candidates, and show current audition stage and preparation failure.
- [ ] P0095 — Make audition playback rejection visible and recoverable; preserve one-audio-owner behaviour and return from previews.
- [ ] P0096 — Keep candidate/reviewed/prepared states distinct and preserve Yes/No/Skip, revisiting and feedback history.
- [ ] P0097 — Show current versus named-draft insertion destinations and preserve atomic pair insertion.
- [ ] P0098 — Verify competing requests, bridge rejection, moving playhead, stale cancellation and duplicate-song races.
- [ ] P0099 — Verify discovery background refresh, unavailable cues, rapid stage switches and destination changes without losing context.

**Exit gate:** Users understand what is pending, what they have actually heard, and exactly which songs and destination their approval affects.

## Phase 04 — Editing and Stem Studio

### [ADR-0040 — Precise editing timeline and context-preserving transition inspector](adr-0040-polish-editor-and-inspector.md)

- [ ] P0070 — Keep mix name, current/draft status, selection and save/undo context visible throughout editing.
- [ ] P0071 — Standardize song-row and transition-connector rhythm, alignment, readiness and now-playing/selected treatments.
- [ ] P0072 — Group secondary song and mix actions while preserving insertion, reorder, remove, hold and existing expert operations.
- [ ] P0073 — Provide keyboard alternatives and visible results for reordering; preserve selection after insert/remove/undo.
- [ ] P0074 — Keep the selected song pair and position understandable in desktop inspector and narrow-screen sheet layouts.
- [ ] P0075 — Present requested move, queued/rendering state, fallback and actual playable result without conflating them.
- [ ] P0076 — Polish cue, length and unavailable-move controls with reasons, units, error recovery and stable focus.
- [ ] P0077 — Prevent stale preview results or capability responses from presenting the wrong pair; explicitly surface failed loading.
- [ ] P0078 — Verify current/draft switching, deletion in another tab, stale edits, renderer completion races and undo scope.
- [ ] P0079 — Review 100-song timelines with long metadata and open inspectors while playback and rendering continue.

**Exit gate:** Every edit has an unmistakable target, selection remains stable, and what will actually play is distinguishable from what the user requested.

### [ADR-0041 — Readable Stem Studio grid, audition ownership and explicit commit state](adr-0041-polish-stem-studio.md)

- [ ] P0080 — Define song, lane and bar-label hierarchy and stable labels during scrolling or lane navigation.
- [ ] P0081 — Differentiate enabled cells, keyboard focus, solo lanes, selection and playhead without colour alone.
- [ ] P0082 — Polish stem-preparing/loading/ready/unavailable/failed states with truthful estimates and retry paths.
- [ ] P0083 — Explain preview audio ownership and verify main-player pause/resume behaviour on play, stop, navigation and failure.
- [ ] P0084 — Separate preview, arrange, fine-tune, restore, reset and commit actions visually and verbally.
- [ ] P0085 — Show dirty/saving/saved/failed/restored state; name the exact transition affected by commit.
- [ ] P0086 — Preserve local work after failed saving and define close/reopen/reset behaviour without silent data loss.
- [ ] P0087 — Verify every grid cell and solo control with keyboard and touch at narrow widths; do not shrink below usable targets.
- [ ] P0088 — Exercise real-stem audition through navigation, exact-pair commit and render-failure recovery; record audible evidence separately from UI tests.

**Exit gate:** Users can identify every lane/cell, know which audio owns playback, and distinguish local experiments from committed transition changes.

## Phase 05 — Library, discovery and operations

### [ADR-0043 — Scannable Library, actionable Workshop and polished export/study flows](adr-0043-polish-library-and-workshop.md)

- [ ] P0100 — Prioritize Library title/artist/readiness and relevant action; group secondary actions without hover-only access.
- [ ] P0101 — Unify search/filter/sort/count presentation and provide clear-filter recovery for empty search results.
- [ ] P0102 — Keep analysed versus mix-ready, detected versus corrected, Never play versus Set aside, and priority versus readiness distinct.
- [ ] P0103 — Preserve filter/query/scroll/focus through song details, correction saves, errors and return navigation.
- [ ] P0104 — Verify 20,000-song responsiveness with realistic metadata/action density and pagination or rendering strategy.
- [ ] P0105 — Organize Workshop overview, analysis, storage, sources, learning and diagnostics around actual work and useful actions.
- [ ] P0106 — Move the developer state showcase out of everyday Workshop navigation while retaining a development review surface.
- [ ] P0107 — Distinguish storage budget, cache usage, free disk and protected content; reconcile controls to confirmed saved values.
- [ ] P0108 — Specify export preparation/render/file-creation/success/download/error states, mix snapshot identity and close/reopen behaviour based on actual backend support.
- [ ] P0109 — Provide direct recovery from failed export transitions and verify the downloaded FLAC matches the intended mix.
- [ ] P0110 — Polish blind-study validation, audio switching, partial responses, retry and completion without revealing conditions or changing scoring/protocol.
- [ ] P0111 — Verify disconnected sources, low disk, worker pause/restart, stale storage writes and private-diagnostic redaction.

**Exit gate:** Users can find and assess songs, resolve operational blockers and export the intended mix; study presentation remains neutral and submissions recoverable.

Also complete the discovery-specific tasks in ADR-0042 (P0093–P0097 and P0099); the task IDs remain in their original section, not duplicated here.

## Phase 06 — Responsive and accessibility verification

### [ADR-0045 — Responsive workspace finish and complete accessible task journeys](adr-0045-polish-responsive-accessibility.md)

- [ ] P0121 — Agree supported browser/OS/assistive-technology and installed-app matrix, with real-device versus simulated evidence labelled.
- [ ] P0122 — Review 320/375/390/430/768/1024/1440/1920/3840 widths, short windows, landscape, safe areas and virtual keyboards.
- [ ] P0123 — Verify actual 200% and 400% browser zoom, text resizing, focus visibility and scroll behaviour in addition to viewport simulations.
- [ ] P0124 — Target generous 44px touch controls where practical and verify WCAG 2.2 AA 24px minimum/spacing exceptions accurately.
- [ ] P0125 — Measure text contrast (4.5:1 normal, 3:1 large) and applicable non-text contrast (3:1), focus visibility and non-colour status information.
- [ ] P0126 — Complete keyboard-only setup, listening, requests, mixes, editing, Studio, Library, discovery, export and study journeys.
- [ ] P0127 — Test custom sliders, waveform seeking, energy curves, tabs and grids against their documented keyboard and accessible-value behaviour.
- [ ] P0128 — Complete NVDA and supported VoiceOver journeys with human evidence; automated axe success is not a substitute.
- [ ] P0129 — Check sticky navigation/player/notifications/sheets never fully obscure focused controls and provide reachable close/recovery actions.
- [ ] P0130 — Review dynamic announcements, reduced motion, forced-colour presentation and long mixed-direction metadata.
- [ ] P0131 — Record and resolve failures per surface/state; keep unperformed human checks explicitly pending.

**Exit gate:** All supported essential journeys are usable with keyboard and applicable assistive technology at documented sizes, with measured contrast and human evidence.

## Phase 07 — Integrated verification and release

### [ADR-0046 — Visual regression, performance, listening and polish release gates](adr-0046-polish-verification-and-release.md)

- [ ] P0132 — Build deterministic visual baselines for every inventory surface/state in both themes and representative widths; control clocks/audio animation and document masks.
- [ ] P0133 — Review screenshot differences rather than blindly refreshing baselines; include loading, empty, error and recovery states.
- [ ] P0134 — Run existing applicable frontend/backend/browser/file-length checks without weakening behavioural assertions to accommodate new layouts.
- [ ] P0135 — Measure realistic large-Library, 100-song Edit and Studio interactions during background rendering on recorded hardware.
- [ ] P0136 — Set and report responsiveness budgets, using INP <=200ms and CLS <=0.1 as reference targets with methodology; distinguish local lab results from field percentiles.
- [ ] P0137 — Check no audio interruption or unintended overlap during navigation, preview, edits, requests, recovery and multi-tab takeover using actual audio evidence.
- [ ] P0138 — Run integrated disconnect/reconnect, stale-response, failed-render, failed-save, missing-source and export-recovery scenarios.
- [ ] P0139 — Conduct unguided tasks with casual listeners, creators and expert editors; record task success, errors and confusion without inventing results.
- [ ] P0140 — Resolve P0/P1 blockers and review all P2 visual/detail findings against the state inventory; document any explicitly accepted limitation.
- [ ] P0141 — Verify incremental rollback preserves music, mixes, drafts, ratings, settings and metadata; no schema or engine change is implicitly authorized by this polish plan.
- [ ] P0142 — Update each relevant ADR, checklist, evidence record and inherited parity/test mapping with implementing PR and verification links.
- [ ] P0143 — Publish a release-candidate review with screenshots, CI, accessibility, task and audible evidence; leave unperformed checks unchecked and obtain explicit release disposition.

**Exit gate:** Every applicable state is reviewed, required automated and human evidence exists, and no unresolved integrity, accessibility, audio or recovery blocker is disguised as polish completion.

## Completion rule

No phase is complete until its tasks and applicable verification cases pass. A release disposition must name remaining limitations and outstanding tasks; merging a planning PR is not evidence of implementation. See [roadmap](polish-roadmap.md) and [verification matrix](polish-verification-matrix.md).
