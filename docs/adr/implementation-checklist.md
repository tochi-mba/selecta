# Selecta 2.0: the implementation and its checklist

> **One PR for everything:** the implementation now lands on this branch too, instead of in separate PRs, as the owner asked. A ticked box means the code is on this branch and [implementation-evidence.md](https://github.com/tochi-mba/selecta/blob/main/docs/adr/implementation-evidence.md) says how we know. This description holds the live checkbox state, and the committed `docs/adr/implementation-checklist.md` is the first snapshot of the scope.

## How to use this checklist

1. All of the implementation goes on this branch.
2. Tick a task only when its code is on this branch and its evidence is written down. Partly done tasks stay unticked, and the evidence file says what's left.
3. Mark a phase complete only when every phase task and its audio/QA/data gate passes. A docs-only change never completes a runtime task.
4. Update each ADR's **implementation status**, plus the ADR index, parity ledger and roadmap, as work lands. **Decision status** stays Proposed until the owner accepts it.
5. Do not blindly tick multiple tasks when the same code lands: each task has its own acceptance criteria and tests. New findings are added as new checkboxes with stable IDs.
6. Merging is the owner's call. Tasks that need a person (approvals, NVDA and VoiceOver, listening, installing it) stay unticked until they're done. Anything still open at merge stays listed in `docs/adr/implementation-checklist.md`.

**Invariants:** Preserve the whole current app and warm colour identity. No lost source music or drafts, no wrong current/draft mutation, no unintended audio silence/late seam, no unapproved/partial bridge joins, no inaccessible essential action, no invalid exported audio, no unsafe localhost access.

**Initial task count:** 279 tasks across 14 delivery phases, covering all 32 ADRs. **Completed so far: 212.**

**Related docs:** [ADR index](https://github.com/tochi-mba/selecta/tree/main/docs/adr) · [feature parity](https://github.com/tochi-mba/selecta/blob/main/docs/adr/feature-parity.md) · [test matrix](https://github.com/tochi-mba/selecta/blob/main/docs/adr/test-coverage-matrix.md) · [acceptance ledger](https://github.com/tochi-mba/selecta/blob/main/docs/acceptance.md)

## Phase 00 - Baseline, parity and implementation governance

### Product contract and parity - [ADR-0001](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0001-product-contract-and-parity.md)

- [ ] T0001 - Pin the pre-redesign main SHA and archive representative screenshots, API responses, settings and playback traces.
- [x] T0002 - Inventory every existing feature and expose each in the new Listen/Mixes/Library/Discover/Workshop structure.
- [x] T0003 - Record current user journeys for casual listening, live requesting, mix creation and expert seam editing.
 **Evidence (2026-11-11):** `docs/user-journeys.md` records the four journeys step by step, each step naming its `web/e2e` test; `tests/test_user_journeys.py` (`test_every_journey_is_recorded`, `test_every_step_names_a_test_that_exists`) passed 2026-11-11 (2 passed).
- [ ] T0004 - Verify the existing acceptance ledger against actual code and flag historical limits rather than copying speculative claims.
- [ ] T0005 - Agree with reviewers which features are in scope, non-goals and blocked-by-backend capabilities. **Needs a person:** agree in-scope features, non-goals and backend-blocked capabilities with a named reviewer and record it. ADR-0001 itself was accepted in #37 on 2026-11-08, but no reviewer scope record exists (checked 2026-11-10).
- [x] T0006 - Document hard invariants for no lost user data, no wrong-mix edits, no unauthorized bridge and no audio interruption.
- [x] T0007 - Approve ADR-0001 or document any explicitly superseding decision. **Evidence (2026-11-10):** The owner accepted ADR-0001 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Baseline and test architecture - [ADR-0029](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0029-testing-and-quality.md)

- [x] T0008 - Run and record baseline Windows CI: Ruff, pytest with coverage >=70%, pnpm test and pnpm build. **Evidence (2026-11-11):** green `test` workflow run [42899772224](https://github.com/tochi-mba/selecta/actions/runs/42899772224) on main `14b9709` (2026-11-10): Python pytest shards on `windows-latest` with coverage, `verify` combining them with `coverage report --fail-under=70`, `Lint / ruff`, `Web / unit tests and production build` (`pnpm test`, `pnpm build`) and the Windows Edge E2E jobs that run `pnpm build`, all success (`.github/workflows/test.yml`). The pre-redesign baseline was main `911c981`.
- [ ] T0009 - Inventory component and player tests; map every existing behavioural assertion to parity requirements.
- [ ] T0010 - Create deterministic original/licensed fixture audio with valid/invalid beat grids, cue positions and fallback seams.
- [x] T0011 - Create metadata fixtures for empty library, one song, short library, duplicate title, unicode/RTL, wrong tempo and missing files.
- [x] T0012 - Create render/request/stem fixtures for pending, ready, failed, canceled, stale and storage-blocked operations. **Evidence (2026-11-10):** `web/src/test/operations.ts` holds render, request, stem and export fixtures for all six states (pending, ready, failed, canceled, stale, storage-blocked); `web/src/test/operations.test.ts` (7 tests, operation fixtures (T0012)) checks each one means what its name says. Passed 2026-11-10 (vitest).
- [ ] T0013 - Set up a browser E2E test harness and deterministic clock/network failure injection.
- [ ] T0014 - Set up accessible component tests, visual-regression baseline and real Web Audio browser smoke tests.
- [x] T0015 - Record manual listening procedure and blind A/B benchmark separate from renderer assertions.
- [x] T0016 - Document how changed DOM text/selectors can be updated without removing behavioural coverage.
- [ ] T0017 - Approve ADR-0029 quality gates and record owners for every parity row. **Needs a person:** ADR-0029 was accepted in #37 on 2026-11-08; the owner still has to name a person owning each `feature-parity.md` row (rows name owning ADRs, not people) (checked 2026-11-10).

### Migration strategy - [ADR-0030](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0030-migration-and-release.md)

- [ ] T0018 - Approve phase ordering, code ownership and component-by-component migration boundaries. **Needs a person:** ADR-0030 (accepted in #37) fixes phase order and migration boundaries; the owner still has to record code ownership (checked 2026-11-10).
- [x] T0019 - Define a feature/route fallback strategy for phases that cannot launch atomically.
- [x] T0020 - Record compatibility and rollback requirements for every additive backend/API change.
- [x] T0021 - Agree the status update protocol: proposed/accepted decision separate from not-started/in-progress/implemented/verified execution. **Evidence (2026-11-10):** The protocol (decision status separate from not-started/in-progress/implemented/verified) is ADR-0030's governance rule and `docs/adr/README.md`; the owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`). Re-checked 2026-11-10.
- [x] T0022 - Approve ADR-0030 release governance; keep user music and durable data untouched. **Evidence (2026-11-10):** The owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. The data invariant (source music, drafts, ratings and preferences survive) is ADR-0030's own compatibility rule.


## Phase 01 - Design system, interaction primitives and accessibility

### Semantic visual language - [ADR-0003](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0003-design-tokens-and-brand.md)

- [x] T0023 - Audit current styles and CSS scope collisions including `.handoff`. **Evidence (2026-11-11):** audit in `docs/engineering/css-ownership.md` ("Scope collisions"); `web/src/styles/scope-collisions.test.ts` ("only Listen renders the .handoff card classes", ".handoff rules live only in the base layout, Listen and the shared musical objects", plus page-sheet collision checks) and `css-ownership.test.ts`. Passed 2026-11-11 (vitest).
- [x] T0024 - Codify dark/light colours and semantic surfaces/text/focus/status tokens without changing Selecta's existing identity.
- [x] T0025 - Define type scales, spacing, radii, motion, elevation and stacking tokens.
- [x] T0026 - Implement scoped feature styles or CSS modules; remove accidental global cross-feature selectors. **Evidence (2026-11-11):** owned feature sheets in `web/src/styles/` with load order in `docs/engineering/css-ownership.md`; `web/src/styles/scope-collisions.test.ts` ("no bare class is styled by two page stylesheets", "page stylesheets never restyle bare elements globally") and `css-ownership.test.ts`. Passed 2026-11-11 (vitest).
- [x] T0027 - Build visual examples for default, hover, focus, disabled, loading, selected, warning and error states.
- [ ] T0028 - Verify both themes, long text, fallback fonts, reduced motion and accessible contrasts.
- [ ] T0029 - Approve ADR-0003 and document visual exceptions. **Needs a person:** ADR-0003 was accepted in #37 on 2026-11-08; the owner has to write down which visual exceptions are allowed, since none are documented (checked 2026-11-10).

### Accessible shared components and feedback - [ADR-0004](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0004-interaction-primitives-and-notifications.md)

- [x] T0030 - Implement shared Button, IconButton, text input, combobox, select and slider with correct labels/states. **Evidence (2026-11-10):** `web/src/ui/formControls.tsx` (TextField, Select, Combobox on `Field`) with `Action`, `IconButton` and `Slider` from `controls.tsx`/`primitives.tsx`; `web/src/ui/formControls.test.tsx` (5 tests: names, busy state, joined label/help/error, disabled select, slider value text, combobox arrow/Enter/Escape). Passed 2026-11-10 (vitest). Existing pages still use labelled native controls; adopting the shared ones page by page is follow-up polish.
- [x] T0031 - Implement shared Dialog, Drawer, BottomSheet, Menu and Tooltip with focus trapping and restoration.
- [x] T0032 - Implement reusable audio preview, render status, validation error, skeleton/loading and error-boundary components.
- [x] T0033 - Replace global recent-click busy heuristic with per-mutation loading and disabled states.
- [x] T0034 - Implement persistent/conflict-free notifications; multiple toasts must not erase actionable Undo.
- [x] T0035 - Ensure retry/cancel and partial success are expressed accurately, not optimistically marked completed.
- [x] T0036 - Test Escape, focus, touch targets, screen-reader names, toast collisions and destructive recovery.
- [x] T0037 - Approve ADR-0004 interaction and notification contracts. **Evidence (2026-11-10):** The owner accepted ADR-0004 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Accessibility foundation - [ADR-0023](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0023-accessibility.md)

- [ ] T0038 - Agree WCAG 2.2 AA target, supported browser/assistive-tech matrix and documented exceptions. **Needs a person:** ADR-0023 (accepted in #37) states the WCAG 2.2 AA target; the owner still has to agree the browser and assistive-technology matrix and documented exceptions (checked 2026-11-10).
- [x] T0039 - Preserve or map existing global keyboard shortcuts and prevent them inside editable text.
- [x] T0040 - Define keyboard-equivalent actions for every drag/reorder and every waveform or grid operation.
- [x] T0041 - Implement screen-reader-friendly live status announcements without noisy high-frequency narration.
- [x] T0042 - Ensure visible focus is never obscured by sticky navigation or sheets.
- [ ] T0043 - Audit form validation, meaningful errors, non-colour state and reduced motion.
- [ ] T0044 - Run keyboard-only, NVDA/VoiceOver and 200/400% zoom journeys; log fixes with evidence. **Needs a person:** keyboard and zoomed layouts are tested automatically; NVDA and VoiceOver journeys need a person with those screen readers (checked 2026-11-10).
- [x] T0045 - Approve ADR-0023 accessibility standards. **Evidence (2026-11-10):** The owner accepted ADR-0023 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 02 - Navigation, responsiveness and PWA

### Routing and persistent app shell - [ADR-0002](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0002-routing-and-shell.md)

- [x] T0046 - Implement `/listen`, `/mixes`, `/library`, `/discover`, `/workshop` and contextual current/draft edit routes.
- [x] T0047 - Add desktop rail, mobile bottom navigation and coordinated persistent mini-player.
- [x] T0048 - Ensure browser Back/Forward, deep-link reload and return to previous focus and relevant scroll/filter state.
- [x] T0049 - Use stable song, draft, seam and request IDs in URLs and selection rather than array index.
- [x] T0050 - Handle deleted/missing resources with explicit recovery; never switch silently to another mix.
- [x] T0051 - Configure SPA path fallback without masking `/api` errors or asset 404 responses.
- [x] T0052 - Verify playback and previews survive supported navigation and do not duplicate media instances.
- [x] T0053 - Approve ADR-0002 routing rules. **Evidence (2026-11-10):** The owner accepted ADR-0002 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Responsive complex workspaces - [ADR-0024](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0024-responsive-workspaces.md)

- [x] T0054 - Define breakpoints and safe-area treatment for 320/375/390/430/768/1024/1440/1920/4K layouts.
- [x] T0055 - Ensure nav and mini-player do not obscure CTA, keyboard focus, notifications or mobile sheet content.
- [x] T0056 - Specify desktop editor timeline+inspector and mobile timeline+sheet behaviour.
- [x] T0057 - Specify desktop Studio 64-cell grid and mobile lane navigation without lost cells.
- [x] T0058 - Specify responsive Library list/table and long/unicode/RTL song metadata treatment.
- [ ] T0059 - Test virtual keyboard, touch/drag alternatives, landscape, 200/400% zoom and embedded scrolling. **Needs a person:** landscape, zoom-equivalent widths and touch alternatives are tested in the browser; a real on-screen keyboard needs a person on a phone or tablet (checked 2026-11-10).
- [ ] T0060 - Approve ADR-0024 with recorded narrow-viewport evidence. **Needs a person:** ADR-0024 was accepted in #37 on 2026-11-08; the narrow-viewport evidence it asks for has to be recorded against a SHA by a reviewer (checked 2026-11-10).

### Installed PWA and browser support - [ADR-0031](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0031-pwa-and-browsers.md)

- [ ] T0061 - Verify existing manifest, icons and Chrome/Edge install path before route migration. **Needs a person:** `web/e2e/pages.e2e.ts` checks the manifest and icons; installing the app in Chrome and Edge needs a person (checked 2026-11-10).
- [ ] T0062 - Preserve standalone launch/reload/deep links while requiring the local server. **Needs a person:** deep links and reloads work in a tab; launching it as an installed app needs a person to install it (checked 2026-11-10).
- [x] T0063 - Feature-detect Media Session, fullscreen, AudioContext, clipboard and native folder integrations.
- [x] T0064 - Audit service worker/static caching so API errors and private audio are never mishandled.
- [ ] T0065 - Test Chrome/Edge installed mode and documented Firefox/Safari fallbacks. **Needs a person:** install it in Chrome and Edge and try the Firefox and Safari fallbacks on real browsers; only Edge was run so far (checked 2026-11-10).
- [x] T0066 - Approve ADR-0031 support matrix. **Evidence (2026-11-10):** The owner accepted ADR-0031 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 03 - State, backend contracts, security and resilience

### Typed frontend state and mutations - [ADR-0005](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0005-domain-state-mutations.md)

- [x] T0067 - Define canonical domain types for current mix, draft, song, seam, request, analysis, render, storage and preferences.
- [ ] T0068 - Move API calls into typed client/services and centralize cache ownership and polling policy.
- [x] T0069 - Add cancellation/sequence protection so stale queries cannot overwrite newer data.
- [x] T0070 - Add mutation pending/error/rollback state with clearly scoped current-versus-draft resource IDs.
- [x] T0071 - Add optimistic request reconciliation keyed by operation ID and backend confirmation.
- [x] T0072 - Implement server revision or conflict tokens for mix/seam/request/settings mutations where required.
- [x] T0073 - Test rapid clicking, concurrent tabs, stale polling, double submit, retry and lost connection.
- [x] T0074 - Approve ADR-0005 state rules. **Evidence (2026-11-10):** The owner accepted ADR-0005 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Additive backend API evolution - [ADR-0026](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0026-api-compatibility.md)

- [ ] T0075 - Capture existing request/response contracts as fixtures; keep existing endpoints usable.
- [x] T0076 - Define typed error taxonomy and backward-compatible feature negotiation for older local servers.
- [x] T0077 - Add canonical planner `mix-ready` eligibility status with structured reason codes.
- [x] T0078 - Add paginated/cursor-based Library APIs and stable search/sort semantics.
- [x] T0079 - Add version/revision and idempotency support for high-risk mutations and renderer jobs.
- [x] T0080 - Add target-scoped, atomic linked-pair insertion and bridge insertion contracts.
- [x] T0081 - Expose actual renderer/planner explanations and progress, not client-invented percentages.
- [x] T0082 - Test old/new payloads, unknown fields, validation, conflict, atomic rollback and repeated requests.
- [x] T0083 - Approve ADR-0026 schema compatibility plan. **Evidence (2026-11-10):** The owner accepted ADR-0026 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Local-first security - [ADR-0025](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0025-local-privacy.md)

- [x] T0084 - Maintain loopback binding, Host and Origin checks and protection against cross-site mutations.
- [x] T0085 - Audit new SPA paths, APIs, request previews, worker endpoints and optional picker bridges for path traversal.
- [x] T0086 - Keep source audio, local song metadata and analytics offline; use no mandatory remote fonts/assets/telemetry.
- [x] T0087 - Treat library metadata, lyrics and filenames as untrusted text, not HTML.
- [x] T0088 - Protect original files from any storage eviction, folder remove or cache reset operation.
- [x] T0089 - Redact private paths and song metadata from default diagnostic output.
- [x] T0090 - Re-run security and network-request audits after integrating all new routes.
- [x] T0091 - Approve ADR-0025. **Evidence (2026-11-10):** The owner accepted ADR-0025 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Resilience and multi-tab ownership - [ADR-0028](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0028-recovery-and-multitab.md)

- [x] T0092 - Distinguish validation, 404/missing item, conflict, offline, storage limit and render failure states.
- [x] T0093 - Retain last safe snapshots on server loss; never replace them with false empty data.
- [ ] T0094 - Define server-reconnect, retry and idempotent recovery for every durable mutation.
- [x] T0095 - Implement active audio owner/takeover policy across multiple app tabs/windows.
- [ ] T0096 - Show conflicts rather than silently overwriting newer mix, cue, request or setting state.
- [ ] T0097 - Test backend stop/restart during edit, request, export and storage update; test tab sleep/wake.
- [x] T0098 - Approve ADR-0028 reliability policy. **Evidence (2026-11-10):** The owner accepted ADR-0028 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 04 - Playback, listening, lyrics and explanations

### Web Audio transport and conventional controls - [ADR-0006](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0006-audio-transport-and-media.md)

- [x] T0099 - Capture deterministic current seam scheduler/fallback behaviour before adding transport methods.
- [x] T0100 - Separate Next track from Jump/Hear transition; preserve the existing seam-jump action.
- [x] T0101 - Implement safe seek within the song, including cue rescheduling and no expired seam firing.
- [x] T0102 - Implement volume and mute with master gain and retained pre-mute level.
- [x] T0103 - Implement OS Media Session Play/Pause/Next/Previous/Seek only where semantics are correct and APIs supported.
- [x] T0104 - Honor audible commit boundary for already scheduled/live seams.
- [x] T0105 - Test pause/seek/Next during seam, repeat keys, end-of-mix, suspend/resume, decoding errors and gapless continuity. **Evidence (2026-11-10):** `web/src/audio/transportEdges.test.ts` (10 tests): pause, seek and Next mid-seam, held-down Next and repeated play/pause, end of mix, undecodable current and next songs, system suspend and resume in place, gapless ready seam and fallback overlap; real-browser pause/seek/Next/end in `web/e2e/listen.e2e.ts`. Unit tests passed 2026-11-10 (vitest).
- [x] T0106 - Approve ADR-0006 audio semantics. **Evidence (2026-11-10):** The owner accepted ADR-0006 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Cross-feature audio focus - [ADR-0007](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0007-audio-focus-ownership.md)

- [x] T0107 - Inventory audio owners: main set, seam preview, bridge, lyrics/harmonic demos, Stem Studio, blind trials.
- [x] T0108 - Implement centralized audio focus coordinator with explicit preview priority/owner lifecycle.
- [x] T0109 - Never resume the main set after a later explicit user Pause or a route change against intent.
- [x] T0110 - Cancel/release preview on close, unmount or stale render revision.
- [x] T0111 - Ensure Stage and preview UI state reflect the actual active audio session.
- [x] T0112 - Test A/B non-overlap, rapid preview switch, failed load, suspended context and multi-tab ownership. **Evidence (2026-11-10):** `web/src/audio/focusEdges.test.tsx` (7 tests): A/B non-overlap with one owner, twenty rapid preview switches and a late AbortError, a clip failing to load giving the sound back, slow and refused context resume, multi-tab ownership. Passed 2026-11-10 (vitest).
- [x] T0113 - Approve ADR-0007. **Evidence (2026-11-10):** The owner accepted ADR-0007 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Listen experience - [ADR-0008](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0008-listen-screen.md)

- [x] T0114 - Redesign Listen with prominent current track, artist, mix, transport and next-up context.
- [x] T0115 - Show waveform/sections, elapsed/progress and upcoming exit without misleading seek affordances.
- [x] T0116 - Keep spectrum/FFT visualizer, beat countdown and technical timing available as optional details.
- [x] T0117 - Distinguish intended, rendering, ready, warning and fallback transition state.
- [x] T0118 - Keep Bigger/Calmer/Something else, transition Good/Bad and Why this song/transition actions.
- [x] T0119 - Keep pending requests comprehensible without appearing queued to play prematurely.
- [x] T0120 - Ensure animation does not repeatedly rerender the entire React tree.
- [ ] T0121 - Test no next song, long metadata, failed seam, mobile and reduced motion.
- [x] T0122 - Approve ADR-0008. **Evidence (2026-11-10):** The owner accepted ADR-0008 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Lyrics and Stage - [ADR-0009](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0009-lyrics-and-stage.md)

- [x] T0123 - Build Standard, Lyrics and fullscreen Stage modes using one authoritative player clock.
- [x] T0124 - Preserve word-level focus where verified; fall back to line sync or plain lyrics honestly.
- [x] T0125 - Render no-lyrics, instrumental, loading and unavailable song states intentionally.
- [x] T0126 - Keep fullscreen enter/exit and browser denial recovery without losing transport.
- [x] T0127 - Make lyric layout readable under zoom, long/RTL lines and reduced motion.
- [ ] T0128 - Test word/line timing regressions and route changes while fullscreen.
- [x] T0129 - Approve ADR-0009. **Evidence (2026-11-10):** The owner accepted ADR-0009 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Explanations and feedback - [ADR-0027](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0027-explanations-and-feedback.md)

- [x] T0130 - Define plain-language copy for selected/planned/queued/ready/fallback states.
- [x] T0131 - Use actual planner factors and render audit data for Why this song/transition.
- [x] T0132 - Keep Good/Bad seam ratings effortless and tied to the exact ordered pair/style.
- [x] T0133 - Show why an energy curve, requested song or chosen seam could not be achieved.
- [x] T0134 - Do not overclaim word alignment, chord correctness or transition sound quality.
- [ ] T0135 - Test explanatory fallback, missing backend factors, stale rating and screen-reader announcements. **Needs a person:** someone runs NVDA or VoiceOver on Listen and confirms the notices are announced. Automated part: `web/src/views/explanations.test.tsx` (5 tests, passed 2026-11-11) covers fallback, missing factors, stale rating and polite status regions.
- [x] T0136 - Approve ADR-0027. **Evidence (2026-11-10):** The owner accepted ADR-0027 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 05 - Mix creation and steering

### Mix discovery and building - [ADR-0010](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0010-mix-discovery.md)

- [x] T0137 - Create Featured/Continue, Explore Presets and My Mixes sections with one-click Play.
- [x] T0138 - Preserve Selecta's Pick and all sixteen moment/mood/sound/journey presets.
- [x] T0139 - Design Customize flow for length, energy, transition feel, stems and destination.
- [x] T0140 - Label 30m/1h/2h as approximate while backend selects 12/24/48 songs.
- [x] T0141 - Explain mix-ready eligibility and reasons a preset is unavailable.
- [x] T0142 - Explicitly distinguish Replace current and Save as draft before committing.
- [ ] T0143 - Test every preset, sparse library, failed build, double click and playback preservation.
- [x] T0144 - Approve ADR-0010. **Evidence (2026-11-10):** The owner accepted ADR-0010 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Energy arc and setting scope - [ADR-0011](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0011-steering-and-energy.md)

- [x] T0145 - Preserve five-point curve, keyboard controls, drag/visual graph and reset to vibe.
- [x] T0146 - Display requested curve separately from achieved/planned per-song energy.
- [x] T0147 - Clearly distinguish this mix from stored global defaults; add per-mix API only when supported.
- [x] T0148 - Preserve Smooth/Punchy transition feel and Never/Sometimes/Often stem preference.
- [x] T0149 - Preserve song destination search/clear and explain unreachable endpoint constraints.
- [x] T0150 - Protect last slider user intent from stale async responses and optimistic rollback errors.
- [ ] T0151 - Test extreme curve, reset, rapid input, invalid target and persisted settings.
- [x] T0152 - Approve ADR-0011. **Evidence (2026-11-10):** The owner accepted ADR-0011 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 06 - Drafts, mix editing, seam inspection and export

### Drafts and render queue - [ADR-0012](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0012-drafts-and-queue.md)

- [x] T0153 - Create My Mixes cards showing current/draft, duration, readiness, render state and blocker.
- [x] T0154 - Preserve save current, create, rename, duplicate, delete, restore and independent Undo.
- [x] T0155 - Preserve intentional play/swap semantics without changing current mix prematurely.
- [x] T0156 - Expose prioritized render queue order, Move earlier/later and Remove from line.
- [x] T0157 - Explain storage-blocked rendering and link to Workshop.
- [x] T0158 - Ensure all project actions use stable IDs and survive reload/route navigation.
- [x] T0159 - Test queue competition, duplicate names, missing draft, deletion/undo, storage limit and swap.
- [x] T0160 - Approve ADR-0012. **Evidence (2026-11-10):** The owner accepted ADR-0012 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Edit timeline and scoped actions - [ADR-0013](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0013-edit-timeline.md)

- [x] T0161 - Implement distinct song, seam and pending-request timeline row types.
- [x] T0162 - Implement desktop timeline+inspector and mobile sheet for selected rows.
- [x] T0163 - Keep add/insert, ranked suggestions, Analyse, reorder, lock, remove and Undo.
- [x] T0164 - Add drag handle, insertion indicator, autoscroll and keyboard Move up/down.
- [x] T0165 - Use stable seam/song IDs and current/draft scope on every mutation.
- [x] T0166 - Protect playing audio commitment boundary and rollback rejected reorders.
- [x] T0167 - Test wrong-scope, locked moves, request ghost state, song removed while playing, reorder/poll race. **Evidence (2026-11-11):** Song removed while playing: new `web/src/s2PlayerRemoval.test.ts` (keeps sounding with no restart; Next goes to the song that followed it; the end fade brings that song in) plus a fix in `web/src/player.ts` (`tick`, `next`, `fadeInto`: a removed playing song no longer makes Next jump to the top of the mix or skip the following song, and the seam listed there is not used). Wrong scope, request ghost rows and reorder/poll race: `web/src/views/Mix.test.tsx` (`keeps each mix scope's exact selection separate...`, `show up faded in the timeline...`, `stop and catch up if the mix has moved on`). Locked moves: `tests/test_mix.py::test_a_new_plan_keeps_locked_songs_where_they_are`, `tests/test_request_routes.py::test_playing_it_anyway_never_moves_a_locked_song`. Run 2026-11-11: vitest player 38 passed, Mix 59 passed; pytest 2 + 167 passed. Known limit: while a removed song finishes, the Now card shows the next song's title (display only).
- [x] T0168 - Approve ADR-0013. **Evidence (2026-11-10):** The owner accepted ADR-0013 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Seam inspector and render truth - [ADR-0014](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0014-seam-inspector.md)

- [x] T0169 - Build Listen, Change, Studio and Details areas for selected seam.
- [x] T0170 - Preserve style, length, word phrase, manual entry/exit cues, preview, audit and Good/Bad.
- [x] T0171 - Explain unavailable styles, impossible cues and minimum post-transition playtime.
- [x] T0172 - Show requested/user-selected move separately from actual playable fallback.
- [x] T0173 - Key render request/results and previews to seam identity + revision, rejecting stale outcomes.
- [x] T0174 - Keep advanced audit accessible without overwhelming main timeline.
- [ ] T0175 - Test fast style switching, late render, malformed cue, failed fallback and rating correct seam.
- [x] T0176 - Approve ADR-0014. **Evidence (2026-11-10):** The owner accepted ADR-0014 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### FLAC export - [ADR-0022](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0022-flac-export.md)

- [x] T0177 - Show exact selected current/draft mix and revision in Export UI.
- [x] T0178 - Expose unmet seam render dependencies, actual progress and blocking errors.
- [x] T0179 - Keep FLAC export and final download link once artifact is confirmed ready.
- [x] T0180 - Define immutable export snapshot or invalidation when a mix changes mid-export.
- [x] T0181 - Test partial seam, disk full, failed render, retry, stale URL and playable FLAC decode. **Evidence (2026-11-11):** Partial seam and stale URL: `tests/test_s2_export_edges.py` (`test_a_partly_rendered_mix_waits_and_writes_no_file`, `test_a_ready_file_that_has_gone_is_shown_expired_and_its_link_is_refused`, `test_a_download_link_cannot_reach_outside_the_exports_folder`). Disk full before and mid-write, failed render and retry: `tests/test_flow_export_jobs.py` (`test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot`, `test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically`, `test_a_failed_transition_names_the_pair_and_the_job_says_failed`), `tests/test_export_retry.py`. Playable FLAC decode: `tests/test_export_validation.py::test_complete_export_is_decoded_frame_by_frame`. Run 2026-11-11 with the request tests: 167 passed.
- [x] T0182 - Approve ADR-0022. **Evidence (2026-11-10):** The owner accepted ADR-0022 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 07 - Live song requests and bridge transactions

### Live Requests and bridge atomicity - [ADR-0015](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0015-requests-and-bridges.md)

- [x] T0183 - Design persistent request drawer/sheet with debounced search and immediate acknowledgement.
- [x] T0184 - Map internal statuses to Finding place, Getting ready, Needs choice, Coming up, Needs attention.
- [x] T0185 - Preserve concurrent multi-request planning, no duplicated songs and reserved position conflicts.
- [x] T0186 - Display proposed direct insertion or bridge route with up to three intermediate songs.
- [x] T0187 - Preserve bridge audition, explicit approval, alternatives, cancel and Play anyway warning.
- [x] T0188 - Keep ghosted/pending rows visible but non-playable until atomic commit.
- [x] T0189 - Implement idempotent, revision-aware multi-song bridge commit when every seam is ready.
- [x] T0190 - Recheck after live playhead advances, edits, new requests and cancellation.
- [x] T0191 - Prevent canceled requests from resurrection after stale poll; no wrong or partial insertion.
- [x] T0192 - Test duplicate submit, approval-vs-cancel race, bridge partial render, preemption and imminent seam. **Evidence (2026-11-11):** Duplicate submit and approval-vs-cancel: `tests/test_requests.py::test_requests_survive_restart_deduplicate_and_cancel_without_changing_mix`, `tests/test_request_routes.py::test_answering_a_cancelled_request_says_so`, `test_playing_it_anyway_twice_is_refused_kindly`. Bridge partial render: `test_a_bridge_does_not_join_until_every_transition_is_ready`. Preemption: `tests/test_drafts.py::test_what_is_about_to_be_heard_still_beats_a_request`, `test_a_request_seam_stops_for_what_is_about_to_be_heard`, `test_lesser_work_stops_for_a_request`. Imminent seam: `tests/test_requests.py::test_request_waits_past_protected_audio_and_checks_return_to_mix`, `tests/test_request_routes.py::test_with_no_time_left_it_is_left_to_fade`, `test_going_past_the_way_out_makes_another_further_on`. Run 2026-11-11: 167 passed.
- [x] T0193 - Approve ADR-0015 and verify original request tests. **Evidence (2026-11-11):** ADR-0015 Decision status reads Accepted (owner, 2026-11-08, #37). Original request tests re-run 2026-11-11: `tests/test_requests.py`, `tests/test_request_routes.py`, `tests/test_requests_together.py`, `tests/test_request_planner.py` all pass (in a 167-passed run with the export tests).


## Phase 08 - Stem Studio

### Stem Studio - [ADR-0016](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0016-stem-studio.md)

- [x] T0194 - Preserve both songs × four stems × eight cells (64 toggles), two-bar timing and all existing presets.
- [x] T0195 - Implement clear song labels, four stem lane labels, time ruler, playhead and audition transport.
- [x] T0196 - Keep local instantaneous Web Audio response and individual stem solo. **Evidence (2026-11-11):** New `web/src/s2StemDeck.test.ts`: a toggled cell sets that stem's gain at the current AudioContext time (8 ms edge) with no network call, and solo plays one stem alone then un-solo restores the grid (`web/src/studio.ts` StemDeck). UI path: `web/src/views/Studio.test.tsx` (`tapping a square is heard straight away and renders nothing`, `pressing a name plays only that part`). Vitest 2026-11-11: 9 passed with s2Steering.
- [x] T0197 - Implement accessible roving-keyboard grid and full mobile lane navigation.
- [x] T0198 - Preserve Let Selecta arrange, Fine tune mine, explain diff and Put it back.
- [x] T0199 - Track local dirty candidate separately from committed seam shape; recover when navigating.
- [x] T0200 - Commit Use this to exact seam revision and retain shape on render failure.
- [ ] T0201 - Test every cell, rapid toggling, all presets, incomplete stems, AI success/failure, undo and A/B audio. **Status:** Needs a person: listening to A/B audio of real stems in Seam Studio (switching shapes and solos on a real pair and confirming what is heard). Automated parts pass 2026-11-11: every cell and rapid toggling (`web/src/views/Studio.test.tsx`, `web/src/views/gp-0261-studio.test.tsx`, 36 passed), every ready-made shape (new `web/src/s2StemDeck.test.ts`), incomplete stems, AI success/failure and undo (`Studio.test.tsx`, `web/src/views/StudioSafety.test.tsx`).
- [x] T0202 - Approve ADR-0016. **Evidence (2026-11-10):** The owner accepted ADR-0016 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 09 - Library, overrides and Discover

### Library readiness and scale - [ADR-0017](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0017-library-scale-and-readiness.md)

- [x] T0203 - Use actual planner mix-ready eligibility and reason codes instead of analysed boolean alone.
- [x] T0204 - Preserve Ready/Not yet/Priority/Set aside/Everything and full library search.
- [x] T0205 - Implement server pagination/cursors and stable sort so >200 songs remain accessible.
- [x] T0206 - Design desktop table, mobile rows and song detail with diagnostics.
- [x] T0207 - Preserve Priority, Never play, Add, Play next and Start mix context actions.
- [x] T0208 - Handle background scan arrivals and status changes without wrong-row identity or dropped focus.
- [x] T0209 - Test 20k library, duplicate names, Unicode, missing files, search races and failed analysis.
- [x] T0210 - Approve ADR-0017. **Evidence (2026-11-10):** The owner accepted ADR-0017 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Metadata corrections and local sources - [ADR-0018](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0018-library-corrections-and-folders.md)

- [x] T0211 - Add validated reversible per-song overrides for BPM, key and music/nonmusic classification.
- [x] T0212 - Keep override provenance distinct from original analyzer output and survive reanalysis.
- [x] T0213 - Invalidate only dependent features/seams/caches when analysis correction changes.
- [x] T0214 - Preserve priority analysis, Never-play exclusion and Set aside semantics separately.
- [x] T0215 - Improve watched folder list, scan progress, unavailable folder and typed path fallback.
- [ ] T0216 - Use native folder picker only with safe host-local path binding; no insecure browser access. **Status:** Superseded by ADR-0134: the owner rejected native folder picker work (also docs/adr/README.md owner-directed scope); the typed host-local path stays, validated by `tests/test_s4_folder_input.py`.
- [ ] T0217 - Test half/double BPM, invalid key, worker race, moved source, Unicode paths and malicious input.
- [x] T0218 - Approve ADR-0018. **Evidence (2026-11-10):** The owner accepted ADR-0018 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Word and harmonic Discover - [ADR-0019](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0019-discover-words-and-harmony.md)

- [x] T0219 - Separate Word connections and Harmonic discoveries in the Discover destination.
- [x] T0220 - Preserve phrase links, paired-song preview, rating and audible result state.
- [x] T0221 - Preserve complete four-stage chord audition with visible chord names and song playback.
- [x] T0222 - Preserve Yes/No/Skip judgment, revisiting/adjusting feedback and history.
- [x] T0223 - Add atomic pair insertion and explicit current/draft destination when backend supports it.
- [x] T0224 - Prevent partial insertion and audio conflicts across discovery previews.
- [x] T0225 - Test missing lyric timing, same word many times, failed render, stage skip and duplicate songs. **Evidence (2026-11-11):** Missing lyric timing, same word many times, duplicate songs: new `tests/test_s2_word_edges.py` (3 passed 2026-11-11). Failed render and stage skip: `web/src/views/Links.test.tsx` (`says so when a pair cannot be played, and you can still answer`, `lets you jump to any step`, `never plays an obsolete prepared audition after the user skips that pair`, `never calls a requested harmonic stage playing until the media element starts`); Links + LinksRating vitest 25 passed 2026-11-11.
- [x] T0226 - Approve ADR-0019. **Evidence (2026-11-10):** The owner accepted ADR-0019 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 10 - Workshop, listening research and diagnostics

### Workshop and cache/processing - [ADR-0020](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0020-workshop-and-storage.md)

- [x] T0227 - Organize Overview, Analysis, Storage, Sources and Learning/Listening without hiding old controls.
- [x] T0228 - Keep worker pause/start, analysis progress, render priority, preemption and real ETAs.
- [x] T0229 - Distinguish cached bytes/cache budget from free disk capacity and protected priority storage.
- [x] T0230 - Expose jobs queued, working, blocked, failed and unavailable with actual backend facts.
- [x] T0231 - Preserve source watchers, priority processing and live storage budget control.
- [x] T0232 - Use revision-aware storage writes and reconcile slider to confirmed value.
- [ ] T0233 - Test low disk, old cache metadata, paused worker, render contention, missing source and stale write.
- [x] T0234 - Approve ADR-0020. **Evidence (2026-11-10):** The owner accepted ADR-0020 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Blind listening studies - [ADR-0021](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0021-blind-listening.md)

- [x] T0235 - Preserve blind A/B presentation and listener/study identifiers.
- [x] T0236 - Preserve five-point quality, issue tags and A/B/No preference/Cannot judge choices.
- [x] T0237 - Replace difficult issue multi-select with accessible stable checkbox/multiselect control.
- [x] T0238 - Ensure only one study audio condition plays at once; don't disclose condition identity.
- [x] T0239 - Keep failed response submission recoverable and prevent duplicate stored trial responses.
- [x] T0240 - Do not change musical study protocol/meaning without a separate versioned ADR.
- [x] T0241 - Test missing clip, partial trial, refresh, keyboard, double submit and final completion. **Evidence (2026-11-10):** `web/src/views/ListeningStudyFlow.test.tsx` (5 tests, blind listening study, start to finish): missing clip with cannot-judge, refresh part way restoring the same comparison, double submit stored once, keyboard alone to the end, finishing saves each once and says complete. Passed 2026-11-10 (vitest).
- [x] T0242 - Approve ADR-0021. **Evidence (2026-11-10):** The owner accepted ADR-0021 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.

### Local diagnostics and operation tracing - [ADR-0032](https://github.com/tochi-mba/selecta/blob/main/docs/adr/adr-0032-diagnostics-and-operations.md)

- [x] T0243 - Show local server and worker availability, current jobs and actionable recent failure state.
- [ ] T0244 - Use operation IDs to correlate UI requests with backend outcomes when supported.
- [x] T0245 - Display accurate queued/blocked/running/failed jobs; label ETAs as estimates.
- [x] T0246 - Redact source filesystem paths and song metadata in default diagnostics.
- [x] T0247 - Ensure diagnostics add minimal CPU cost and no remote telemetry.
- [ ] T0248 - Test redaction, worker restart, slow status, storage block and operation correlation.
- [x] T0249 - Approve ADR-0032. **Evidence (2026-11-10):** The owner accepted ADR-0032 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header.


## Phase 11 - Cross-feature integration

### Cross-feature integration scenarios

- [x] T0250 - Complete current-vs-draft isolation sequence while listening, requesting, editing and undoing.
- [ ] T0251 - Complete two simultaneous requests competing for a slot, bridge approval and stale cancellation replay.
- [ ] T0252 - Complete manual cue change while a previous render finishes and fallback plays; verify intended/actual difference.
- [ ] T0253 - Complete Studio local audition → pause main playback → navigate → commit exact seam → render failure recovery. **Needs a person:** needs real stems on the owner's machine and someone listening to the committed seam (checked 2026-11-10).
- [x] T0254 - Complete export of a draft while switching/reordering other mixes; verify snapshot and FLAC bytes.
- [ ] T0255 - Complete metadata override while background analysis finishes and the library watch detects new files.
- [ ] T0256 - Complete backend restart during mutation, reconnect/retry and two-tab active playback takeover.
- [x] T0257 - Confirm no preserved feature in feature-parity ledger has lost navigation or an authoritative backend side effect.
- [ ] T0258 - Run end-to-end integration tests with representative song fixtures and audit all discovered regressions.


## Phase 12 - Quality, accessibility, performance and verification

### Full quality and acceptance gates

- [x] T0259 - Run unchanged/backwards-compatible legacy unit tests and explain any necessary selector updates.
- [x] T0260 - Run extended frontend tests, Python tests, API contracts and browser E2E suites on PR and main.
- [ ] T0261 - Run deterministic real Web Audio tests for seek, late seam, fallback, preview focus and exact media key behaviour.
- [ ] T0262 - Run visual regression for dark/light, 320px–4K, safe areas, reduced motion and high zoom.
- [ ] T0263 - Complete keyboard-only workflows for request, Mixes, Edit, Studio, Library, export and study.
- [ ] T0264 - Complete NVDA, VoiceOver and applicable mobile assistive-technology testing against WCAG 2.2 AA. **Needs a person:** NVDA, VoiceOver and mobile assistive-technology sessions run by a person (checked 2026-11-10).
- [ ] T0265 - Profile >20k Library, >100-song Edit, 64-cell Studio and concurrent render under constrained CPU/storage.
- [ ] T0266 - Conduct user task tests for casual listener, creator and expert editor without guided help. **Needs a person:** unguided task tests with a casual listener, a creator and an expert editor (checked 2026-11-10).
- [ ] T0267 - Conduct actual listener blind comparisons; document subjective audio quality separately from render pass. **Needs a person:** blind comparisons with real listeners, following `docs/listening-procedure.md` (checked 2026-11-10).
- [x] T0268 - Verify local networking/origin/security and no private telemetry or original-file deletion.
- [ ] T0269 - Audit every ADR acceptance criterion and link concrete CI/QA proof before marking Verified.
- [x] T0270 - Update ADR decision/implementation status history, the ADR index, parity matrix and roadmap with merged implementation PR links.


## Phase 13 - Release, rollback and final sign-off

### Controlled release and rollback

- [x] T0271 - Back up and restore representative existing mixes, drafts, ratings, settings, metadata and caches.
- [x] T0272 - Verify forward migration and backward compatibility with pre-overhaul local server/client where required.
- [ ] T0273 - Rehearse rollback of frontend routing and any schema changes without losing files or ratings.
- [ ] T0274 - Confirm a newly installed PWA, a normal browser tab and an existing upgraded installation. **Needs a person:** install the PWA fresh, use a normal tab and upgrade an existing installation (checked 2026-11-10).
- [ ] T0275 - Resolve all critical data-integrity, audio continuity, bridge atomicity, accessibility, export and privacy blockers.
- [ ] T0276 - Run Windows CI plus browser/audio/a11y gates on release candidate commit.
- [ ] T0277 - Record final human listening evidence and explicitly accepted remaining noncritical limitations. **Needs a person:** the owner's own listening evidence and sign-off on remaining noncritical limitations (checked 2026-11-10).
- [ ] T0278 - Verify every checklist item has a linked implementing PR and evidence; do not infer completion from docs.
- [ ] T0279 - Merge/close this tracking PR only after the programme's delivery is actually complete; keep it open otherwise. **Needs a person:** the owner merges or closes the tracking PR once delivery is complete (checked 2026-11-10).
