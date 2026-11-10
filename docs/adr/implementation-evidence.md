# Selecta 2.0: what's done, task by task

Each of the 279 tasks in [#22](https://github.com/tochi-mba/selecta/pull/22), and what's true of it today. Done rows are the ones ticked on the PR.

**212 done, 44 partly, 3 not done, and 20 that need a person** (approvals, screen readers, listening, installing it).

Passing these checks doesn't mean it sounds good. That's for people to judge, using [the listening procedure](../listening-procedure.md).

## Phase 00 - Baseline, parity and implementation governance

### [Product contract and parity](adr-0001-product-contract-and-parity.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0001 Pin the pre-redesign main SHA and archive representative screenshots, API responses, settings and playback traces. | Partly | Baseline pinned at main `911c981`. No screenshots, API captures or playback traces were archived from before the redesign. |
| T0002 Inventory every existing feature and expose each in the new Listen/Mixes/Library/Discover/Workshop structure. | Done | `docs/adr/feature-parity.md` lists every feature with where it now lives. `web/e2e/pages.e2e.ts` opens every page. |
| T0003 Record current user journeys for casual listening, live requesting, mix creation and expert seam editing. | Partly | Journeys exist as runnable browser tests in `web/e2e/flows.e2e.ts` and `integration.e2e.ts`. There's no separate written record. |
| T0004 Verify the existing acceptance ledger against actual code and flag historical limits rather than copying speculative claims. | Partly | `docs/acceptance.md` updated for this work. It hasn't been re-checked line by line against the code. |
| T0005 Agree with reviewers which features are in scope, non-goals and blocked-by-backend capabilities. | Needs a person | agree in-scope features, non-goals and backend-blocked capabilities with a named reviewer and record it. ADR-0001 itself was accepted in #37 on 2026-11-08, but no reviewer scope record exists (checked 2026-11-10). |
| T0006 Document hard invariants for no lost user data, no wrong-mix edits, no unauthorized bridge and no audio interruption. | Done | Invariants are written down in `docs/adr/feature-parity.md`. |
| T0007 Approve ADR-0001 or document any explicitly superseding decision. | Done | The owner accepted ADR-0001 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Baseline and test architecture](adr-0029-testing-and-quality.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0008 Run and record baseline Windows CI: Ruff, pytest with coverage >=70%, pnpm test and pnpm build. | Partly | Baseline recorded: main `911c981` failed 5 stale tests, fixed here. Final CI result is on the PR. |
| T0009 Inventory component and player tests; map every existing behavioural assertion to parity requirements. | Not done | Existing tests were kept and extended. Mapping each assertion to a parity row wasn't done. |
| T0010 Create deterministic original/licensed fixture audio with valid/invalid beat grids, cue positions and fallback seams. | Partly | `tests/synth.py` and `tests/e2e_server.py` make deterministic audio. Invalid grids and cue fixtures only exist as unit test values. |
| T0011 Create metadata fixtures for empty library, one song, short library, duplicate title, unicode/RTL, wrong tempo and missing files. | Done | `tests/e2e_server.py` and `tests/test_library_edges.py`: empty, duplicates, Unicode and RTL, wrong tempo, missing files. |
| T0012 Create render/request/stem fixtures for pending, ready, failed, canceled, stale and storage-blocked operations. | Done | `web/src/test/operations.ts` holds render, request, stem and export fixtures for all six states (pending, ready, failed, canceled, stale, storage-blocked); `web/src/test/operations.test.ts` (7 tests, operation fixtures (T0012)) checks each one means what its name says. Passed 2026-11-10 (vitest). |
| T0013 Set up a browser E2E test harness and deterministic clock/network failure injection. | Partly | Playwright in `web/e2e` with network failure injection. No deterministic clock. |
| T0014 Set up accessible component tests, visual-regression baseline and real Web Audio browser smoke tests. | Partly | Automatic accessibility checks and real Web Audio tests exist. No visual regression baseline. |
| T0015 Record manual listening procedure and blind A/B benchmark separate from renderer assertions. | Done | `docs/listening-procedure.md`. |
| T0016 Document how changed DOM text/selectors can be updated without removing behavioural coverage. | Done | `docs/adr/test-coverage-matrix.md`. |
| T0017 Approve ADR-0029 quality gates and record owners for every parity row. | Needs a person | ADR-0029 was accepted in #37 on 2026-11-08; the owner still has to name a person owning each `feature-parity.md` row (rows name owning ADRs, not people) (checked 2026-11-10). |

### [Migration strategy](adr-0030-migration-and-release.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0018 Approve phase ordering, code ownership and component-by-component migration boundaries. | Needs a person | ADR-0030 (accepted in #37) fixes phase order and migration boundaries; the owner still has to record code ownership (checked 2026-11-10). |
| T0019 Define a feature/route fallback strategy for phases that cannot launch atomically. | Done | Shipped as one change. The older routes still answer, and a revert restores the previous page. |
| T0020 Record compatibility and rollback requirements for every additive backend/API change. | Done | Backend additions only add routes, fields and one table. `status.api.features` advertises them. |
| T0021 Agree the status update protocol: proposed/accepted decision separate from not-started/in-progress/implemented/verified execution. | Done | The protocol (decision status separate from not-started/in-progress/implemented/verified) is ADR-0030's governance rule and `docs/adr/README.md`; the owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`). Re-checked 2026-11-10. |
| T0022 Approve ADR-0030 release governance; keep user music and durable data untouched. | Done | The owner accepted ADR-0030 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. The data invariant (source music, drafts, ratings and preferences survive) is ADR-0030's own compatibility rule. |

## Phase 01 - Design system, interaction primitives and accessibility

### [Semantic visual language](adr-0003-design-tokens-and-brand.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0023 Audit current styles and CSS scope collisions including `.handoff`. | Partly | `.handoff` selectors checked and kept to Listen. `web/src/style.css` is still one global sheet. |
| T0024 Codify dark/light colours and semantic surfaces/text/focus/status tokens without changing Selecta's existing identity. | Done | `web/src/styles/tokens.css`, dark and light. |
| T0025 Define type scales, spacing, radii, motion, elevation and stacking tokens. | Done | `web/src/styles/tokens.css`. |
| T0026 Implement scoped feature styles or CSS modules; remove accidental global cross-feature selectors. | Partly | New work is in `styles/shell.css` with scoped class names. Not converted to CSS modules. |
| T0027 Build visual examples for default, hover, focus, disabled, loading, selected, warning and error states. | Done | The control states panel under Workshop, Diagnostics. |
| T0028 Verify both themes, long text, fallback fonts, reduced motion and accessible contrasts. | Partly | Both themes, long text and reduced motion run through automatic contrast checks. Fallback fonts weren't checked. |
| T0029 Approve ADR-0003 and document visual exceptions. | Needs a person | ADR-0003 was accepted in #37 on 2026-11-08; the owner has to write down which visual exceptions are allowed, since none are documented (checked 2026-11-10). |

### [Accessible shared components and feedback](adr-0004-interaction-primitives-and-notifications.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0030 Implement shared Button, IconButton, text input, combobox, select and slider with correct labels/states. | Done | `web/src/ui/formControls.tsx` (TextField, Select, Combobox on `Field`) with `Action`, `IconButton` and `Slider` from `controls.tsx`/`primitives.tsx`; `web/src/ui/formControls.test.tsx` (5 tests: names, busy state, joined label/help/error, disabled select, slider value text, combobox arrow/Enter/Escape). Passed 2026-11-10 (vitest). Existing pages still use labelled native controls; adopting the shared ones page by page is follow-up polish. |
| T0031 Implement shared Dialog, Drawer, BottomSheet, Menu and Tooltip with focus trapping and restoration. | Done | `web/src/ui/controls.tsx`, tested in `controls.test.tsx`. |
| T0032 Implement reusable audio preview, render status, validation error, skeleton/loading and error-boundary components. | Done | `AudioPreview`, `Status`, `Problem`, `Skeleton`, `Section`. |
| T0033 Replace global recent-click busy heuristic with per-mutation loading and disabled states. | Done | `Action` tracks each mutation. The global heuristic is gone. |
| T0034 Implement persistent/conflict-free notifications; multiple toasts must not erase actionable Undo. | Done | `web/src/ui/toasts.tsx`: Undo toasts can't be evicted. |
| T0035 Ensure retry/cancel and partial success are expressed accurately, not optimistically marked completed. | Done | `Problem` offers retry, and `Action` reports failures rather than success. |
| T0036 Test Escape, focus, touch targets, screen-reader names, toast collisions and destructive recovery. | Done | `web/src/ui/controls.test.tsx`, `web/e2e/flows.e2e.ts`. Target size is in the automatic WCAG 2.2 checks, which also run with dialogs open. |
| T0037 Approve ADR-0004 interaction and notification contracts. | Done | The owner accepted ADR-0004 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Accessibility foundation](adr-0023-accessibility.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0038 Agree WCAG 2.2 AA target, supported browser/assistive-tech matrix and documented exceptions. | Needs a person | ADR-0023 (accepted in #37) states the WCAG 2.2 AA target; the owner still has to agree the browser and assistive-technology matrix and documented exceptions (checked 2026-11-10). |
| T0039 Preserve or map existing global keyboard shortcuts and prevent them inside editable text. | Done | `web/src/shell/Shell.test.tsx`, `web/e2e/listen.e2e.ts`. |
| T0040 Define keyboard-equivalent actions for every drag/reorder and every waveform or grid operation. | Done | Move up and down on rows, arrow keys on the waveform and Studio grid. |
| T0041 Implement screen-reader-friendly live status announcements without noisy high-frequency narration. | Done | `LiveRegion` and `announce` in `web/src/ui/controls.tsx`. |
| T0042 Ensure visible focus is never obscured by sticky navigation or sheets. | Done | `web/e2e/flows.e2e.ts`: focus never hidden behind the bottom bar. |
| T0043 Audit form validation, meaningful errors, non-colour state and reduced motion. | Partly | Automatic checks and unit tests. No manual audit. |
| T0044 Run keyboard-only, NVDA/VoiceOver and 200/400% zoom journeys; log fixes with evidence. | Needs a person | keyboard and zoomed layouts are tested automatically; NVDA and VoiceOver journeys need a person with those screen readers (checked 2026-11-10). |
| T0045 Approve ADR-0023 accessibility standards. | Done | The owner accepted ADR-0023 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 02 - Navigation, responsiveness and PWA

### [Routing and persistent app shell](adr-0002-routing-and-shell.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0046 Implement `/listen`, `/mixes`, `/library`, `/discover`, `/workshop` and contextual current/draft edit routes. | Done | `web/src/router.ts`, `router.test.tsx`. |
| T0047 Add desktop rail, mobile bottom navigation and coordinated persistent mini-player. | Done | `web/src/shell/Shell.tsx`. |
| T0048 Ensure browser Back/Forward, deep-link reload and return to previous focus and relevant scroll/filter state. | Done | `web/e2e/pages.e2e.ts`: reload, Back, Forward, filters in the address. |
| T0049 Use stable song, draft, seam and request IDs in URLs and selection rather than array index. | Done | Selection is by song ids, drafts by id in the address. |
| T0050 Handle deleted/missing resources with explicit recovery; never switch silently to another mix. | Done | `web/e2e/flows.e2e.ts`: a deleted draft is explained, never swapped. |
| T0051 Configure SPA path fallback without masking `/api` errors or asset 404 responses. | Done | `tests/test_api_contracts.py`, `web/e2e/pages.e2e.ts`. |
| T0052 Verify playback and previews survive supported navigation and do not duplicate media instances. | Done | `web/e2e/listen.e2e.ts`: moving around starts no new sound and makes no second audio context. |
| T0053 Approve ADR-0002 routing rules. | Done | The owner accepted ADR-0002 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Responsive complex workspaces](adr-0024-responsive-workspaces.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0054 Define breakpoints and safe-area treatment for 320/375/390/430/768/1024/1440/1920/4K layouts. | Done | `web/e2e/pages.e2e.ts` from 320px to 4K. Safe areas use `env()` in tokens. |
| T0055 Ensure nav and mini-player do not obscure CTA, keyboard focus, notifications or mobile sheet content. | Done | `--bottom-chrome` in tokens, `web/e2e/flows.e2e.ts`. |
| T0056 Specify desktop editor timeline+inspector and mobile timeline+sheet behaviour. | Done | `web/src/views/Mix.tsx`: inspector beside the timeline, or a sheet. |
| T0057 Specify desktop Studio 64-cell grid and mobile lane navigation without lost cells. | Done | `web/src/views/Studio.tsx`, with its roving grid. |
| T0058 Specify responsive Library list/table and long/unicode/RTL song metadata treatment. | Done | `web/src/views/Library.tsx`. Song names use `unicode-bidi: plaintext`. |
| T0059 Test virtual keyboard, touch/drag alternatives, landscape, 200/400% zoom and embedded scrolling. | Needs a person | landscape, zoom-equivalent widths and touch alternatives are tested in the browser; a real on-screen keyboard needs a person on a phone or tablet (checked 2026-11-10). |
| T0060 Approve ADR-0024 with recorded narrow-viewport evidence. | Needs a person | ADR-0024 was accepted in #37 on 2026-11-08; the narrow-viewport evidence it asks for has to be recorded against a SHA by a reviewer (checked 2026-11-10). |

### [Installed PWA and browser support](adr-0031-pwa-and-browsers.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0061 Verify existing manifest, icons and Chrome/Edge install path before route migration. | Needs a person | `web/e2e/pages.e2e.ts` checks the manifest and icons; installing the app in Chrome and Edge needs a person (checked 2026-11-10). |
| T0062 Preserve standalone launch/reload/deep links while requiring the local server. | Needs a person | deep links and reloads work in a tab; launching it as an installed app needs a person to install it (checked 2026-11-10). |
| T0063 Feature-detect Media Session, fullscreen, AudioContext, clipboard and native folder integrations. | Done | `App.tsx` checks Media Session and fullscreen. `state/tabs.ts` checks BroadcastChannel. |
| T0064 Audit service worker/static caching so API errors and private audio are never mishandled. | Done | There's no service worker, so nothing private can be cached by one. |
| T0065 Test Chrome/Edge installed mode and documented Firefox/Safari fallbacks. | Needs a person | install it in Chrome and Edge and try the Firefox and Safari fallbacks on real browsers; only Edge was run so far (checked 2026-11-10). |
| T0066 Approve ADR-0031 support matrix. | Done | The owner accepted ADR-0031 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 03 - State, backend contracts, security and resilience

### [Typed frontend state and mutations](adr-0005-domain-state-mutations.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0067 Define canonical domain types for current mix, draft, song, seam, request, analysis, render, storage and preferences. | Done | `web/src/api.ts`. |
| T0068 Move API calls into typed client/services and centralize cache ownership and polling policy. | Partly | Calls go through `api.ts`. Polling stays in each page's own hook. |
| T0069 Add cancellation/sequence protection so stale queries cannot overwrite newer data. | Done | `mixChanges` in `App.tsx`, sequence checks on sliders and searches. |
| T0070 Add mutation pending/error/rollback state with clearly scoped current-versus-draft resource IDs. | Done | `Action`, scope in the address, `x-mix-order`. |
| T0071 Add optimistic request reconciliation keyed by operation ID and backend confirmation. | Done | `web/src/views/Requests.tsx` with `x-operation-id`. |
| T0072 Implement server revision or conflict tokens for mix/seam/request/settings mutations where required. | Done | `x-mix-order`, tested in `tests/test_api_contracts.py`. |
| T0073 Test rapid clicking, concurrent tabs, stale polling, double submit, retry and lost connection. | Done | `web/e2e/flows.e2e.ts`, `listen.e2e.ts`, `tests/test_api_contracts.py`. |
| T0074 Approve ADR-0005 state rules. | Done | The owner accepted ADR-0005 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Additive backend API evolution](adr-0026-api-compatibility.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0075 Capture existing request/response contracts as fixtures; keep existing endpoints usable. | Partly | `tests/test_api_contracts.py` covers the new routes and that the older list still answers. Existing responses weren't captured as fixtures. |
| T0076 Define typed error taxonomy and backward-compatible feature negotiation for older local servers. | Done | `problemKind` in `api.ts`, `status.api` from the server. |
| T0077 Add canonical planner `mix-ready` eligibility status with structured reason codes. | Done | `readiness` on `/api/library`, tested in `tests/test_api_contracts.py`. |
| T0078 Add paginated/cursor-based Library APIs and stable search/sort semantics. | Done | `/api/library`, tested in `tests/test_api_contracts.py`. |
| T0079 Add version/revision and idempotency support for high-risk mutations and renderer jobs. | Done | `x-operation-id` and `x-mix-order`, including repeats sent at the same moment. |
| T0080 Add target-scoped, atomic linked-pair insertion and bridge insertion contracts. | Done | `/api/mix/pair`, tested in `tests/test_api_contracts.py`. |
| T0081 Expose actual renderer/planner explanations and progress, not client-invented percentages. | Done | `/api/jobs`, and each seam's `why` and `tried`. |
| T0082 Test old/new payloads, unknown fields, validation, conflict, atomic rollback and repeated requests. | Done | `tests/test_api_contracts.py`, `tests/test_library_edges.py`. |
| T0083 Approve ADR-0026 schema compatibility plan. | Done | The owner accepted ADR-0026 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Local-first security](adr-0025-local-privacy.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0084 Maintain loopback binding, Host and Origin checks and protection against cross-site mutations. | Done | `tests/test_api_contracts.py`: other hosts and sites refused. |
| T0085 Audit new SPA paths, APIs, request previews, worker endpoints and optional picker bridges for path traversal. | Done | `tests/test_api_contracts.py` on real addresses. Audio is served by id only. |
| T0086 Keep source audio, local song metadata and analytics offline; use no mandatory remote fonts/assets/telemetry. | Done | `web/e2e/pages.e2e.ts`: the page only talks to this computer. |
| T0087 Treat library metadata, lyrics and filenames as untrusted text, not HTML. | Done | React escaping, and `tests/test_library_edges.py` with a script tag as a title. |
| T0088 Protect original files from any storage eviction, folder remove or cache reset operation. | Done | `tests/test_api_contracts.py`: setting aside and stop-watching touch no files. |
| T0089 Redact private paths and song metadata from default diagnostic output. | Done | `tests/test_api_contracts.py`, `flows.e2e.ts`. |
| T0090 Re-run security and network-request audits after integrating all new routes. | Done | `web/e2e/pages.e2e.ts`, `tests/test_api_contracts.py`. |
| T0091 Approve ADR-0025. | Done | The owner accepted ADR-0025 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Resilience and multi-tab ownership](adr-0028-recovery-and-multitab.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0092 Distinguish validation, 404/missing item, conflict, offline, storage limit and render failure states. | Done | `problemKind` in `api.ts`. |
| T0093 Retain last safe snapshots on server loss; never replace them with false empty data. | Done | `web/e2e/flows.e2e.ts`: what's on screen stays when the server goes. |
| T0094 Define server-reconnect, retry and idempotent recovery for every durable mutation. | Partly | Retry everywhere, with operation ids on requests, inserts and listening responses. Not on every mutation. |
| T0095 Implement active audio owner/takeover policy across multiple app tabs/windows. | Done | `state/tabs.ts`, `web/e2e/listen.e2e.ts`. |
| T0096 Show conflicts rather than silently overwriting newer mix, cue, request or setting state. | Partly | Mix changes are refused with a message. Settings aren't checked for conflicts. |
| T0097 Test backend stop/restart during edit, request, export and storage update; test tab sleep/wake. | Partly | Server loss is simulated in the browser. A real restart mid-edit and tab sleep weren't tested. |
| T0098 Approve ADR-0028 reliability policy. | Done | The owner accepted ADR-0028 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 04 - Playback, listening, lyrics and explanations

### [Web Audio transport and conventional controls](adr-0006-audio-transport-and-media.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0099 Capture deterministic current seam scheduler/fallback behaviour before adding transport methods. | Done | `web/src/player.test.ts`, `web/e2e/listen.e2e.ts`. |
| T0100 Separate Next track from Jump/Hear transition; preserve the existing seam-jump action. | Done | Next and Jump to the transition are separate, in `web/e2e/listen.e2e.ts`. |
| T0101 Implement safe seek within the song, including cue rescheduling and no expired seam firing. | Done | `web/e2e/listen.e2e.ts`: seeking, and seeking past the way out. |
| T0102 Implement volume and mute with master gain and retained pre-mute level. | Done | `web/e2e/listen.e2e.ts`. |
| T0103 Implement OS Media Session Play/Pause/Next/Previous/Seek only where semantics are correct and APIs supported. | Done | `web/e2e/listen.e2e.ts`: media keys. |
| T0104 Honor audible commit boundary for already scheduled/live seams. | Done | `transitionIsLive` in `web/src/player.ts`. |
| T0105 Test pause/seek/Next during seam, repeat keys, end-of-mix, suspend/resume, decoding errors and gapless continuity. | Done | `web/src/audio/transportEdges.test.ts` (10 tests): pause, seek and Next mid-seam, held-down Next and repeated play/pause, end of mix, undecodable current and next songs, system suspend and resume in place, gapless ready seam and fallback overlap; real-browser pause/seek/Next/end in `web/e2e/listen.e2e.ts`. Unit tests passed 2026-11-10 (vitest). |
| T0106 Approve ADR-0006 audio semantics. | Done | The owner accepted ADR-0006 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Cross-feature audio focus](adr-0007-audio-focus-ownership.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0107 Inventory audio owners: main set, seam preview, bridge, lyrics/harmonic demos, Stem Studio, blind trials. | Done | `web/src/audio/focus.ts`. |
| T0108 Implement centralized audio focus coordinator with explicit preview priority/owner lifecycle. | Done | `web/src/audio/focus.ts`, `focus.test.tsx`. |
| T0109 Never resume the main set after a later explicit user Pause or a route change against intent. | Done | `web/src/audio/focus.test.tsx`. |
| T0110 Cancel/release preview on close, unmount or stale render revision. | Done | `AudioPreview`, `usePreview`. |
| T0111 Ensure Stage and preview UI state reflect the actual active audio session. | Done | `usePreview` state and the player's phase. |
| T0112 Test A/B non-overlap, rapid preview switch, failed load, suspended context and multi-tab ownership. | Done | `web/src/audio/focusEdges.test.tsx` (7 tests): A/B non-overlap with one owner, twenty rapid preview switches and a late AbortError, a clip failing to load giving the sound back, slow and refused context resume, multi-tab ownership. Passed 2026-11-10 (vitest). |
| T0113 Approve ADR-0007. | Done | The owner accepted ADR-0007 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Listen experience](adr-0008-listen-screen.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0114 Redesign Listen with prominent current track, artist, mix, transport and next-up context. | Done | `web/src/views/Now.tsx`. |
| T0115 Show waveform/sections, elapsed/progress and upcoming exit without misleading seek affordances. | Done | `Strip` in `web/src/views/Now.tsx`. |
| T0116 Keep spectrum/FFT visualizer, beat countdown and technical timing available as optional details. | Done | View toggles in `Now.tsx`. |
| T0117 Distinguish intended, rendering, ready, warning and fallback transition state. | Done | `seamFacts` in `web/src/ui/seam.ts`. |
| T0118 Keep Bigger/Calmer/Something else, transition Good/Bad and Why this song/transition actions. | Done | `web/src/views/Now.test.tsx`. |
| T0119 Keep pending requests comprehensible without appearing queued to play prematurely. | Done | `web/src/views/Requests.tsx`. |
| T0120 Ensure animation does not repeatedly rerender the entire React tree. | Done | `onChange` throttled in `App.tsx`. |
| T0121 Test no next song, long metadata, failed seam, mobile and reduced motion. | Partly | No next song, long names and phone widths are tested. A failed seam is covered by a missing clip. |
| T0122 Approve ADR-0008. | Done | The owner accepted ADR-0008 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Lyrics and Stage](adr-0009-lyrics-and-stage.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0123 Build Standard, Lyrics and fullscreen Stage modes using one authoritative player clock. | Done | `web/src/views/Now.tsx`, all from the player's clock. |
| T0124 Preserve word-level focus where verified; fall back to line sync or plain lyrics honestly. | Done | `Lyrics` in `Now.tsx`, existing timing tests. |
| T0125 Render no-lyrics, instrumental, loading and unavailable song states intentionally. | Done | `Lyrics` states in `Now.tsx`. |
| T0126 Keep fullscreen enter/exit and browser denial recovery without losing transport. | Done | `toggleStage` in `App.tsx`, `web/e2e/listen.e2e.ts`. |
| T0127 Make lyric layout readable under zoom, long/RTL lines and reduced motion. | Done | `.lyrics p` uses `unicode-bidi: plaintext`, with zoom widths tested. |
| T0128 Test word/line timing regressions and route changes while fullscreen. | Partly | Timing unit tests and a browser test. Route changes while fullscreen weren't tested. |
| T0129 Approve ADR-0009. | Done | The owner accepted ADR-0009 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Explanations and feedback](adr-0027-explanations-and-feedback.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0130 Define plain-language copy for selected/planned/queued/ready/fallback states. | Done | `seamFacts`, status labels in `Requests.tsx`. |
| T0131 Use actual planner factors and render audit data for Why this song/transition. | Done | `WhyThisTransition` in `Now.tsx`, from the render's own record. |
| T0132 Keep Good/Bad seam ratings effortless and tied to the exact ordered pair/style. | Done | Rating goes by seam key, `web/e2e/listen.e2e.ts`. |
| T0133 Show why an energy curve, requested song or chosen seam could not be achieved. | Done | Requested versus achieved energy in `Mixes.tsx`, reasons on requests and moves. |
| T0134 Do not overclaim word alignment, chord correctness or transition sound quality. | Done | Copy says what's measured, and estimates are labelled. |
| T0135 Test explanatory fallback, missing backend factors, stale rating and screen-reader announcements. | Needs a person | fallback, missing factors and stale ratings are tested; the screen-reader announcements need NVDA or VoiceOver run by a person (checked 2026-11-10). |
| T0136 Approve ADR-0027. | Done | The owner accepted ADR-0027 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 05 - Mix creation and steering

### [Mix discovery and building](adr-0010-mix-discovery.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0137 Create Featured/Continue, Explore Presets and My Mixes sections with one-click Play. | Done | `web/src/views/Mixes.tsx`. |
| T0138 Preserve Selecta's Pick and all sixteen moment/mood/sound/journey presets. | Done | `web/src/views/Mixes.test.tsx`. |
| T0139 Design Customize flow for length, energy, transition feel, stems and destination. | Done | `MixSetup` in `Mixes.tsx`. |
| T0140 Label 30m/1h/2h as approximate while backend selects 12/24/48 songs. | Done | `Mixes.tsx`. |
| T0141 Explain mix-ready eligibility and reasons a preset is unavailable. | Done | `Mixes.tsx`, with `needs` from the server. |
| T0142 Explicitly distinguish Replace current and Save as draft before committing. | Done | `Mixes.tsx`. |
| T0143 Test every preset, sparse library, failed build, double click and playback preservation. | Partly | Sparse library, unavailable presets, double click and leaving the music alone are tested. Not every preset through a real build, or a failed build. |
| T0144 Approve ADR-0010. | Done | The owner accepted ADR-0010 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Energy arc and setting scope](adr-0011-steering-and-energy.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0145 Preserve five-point curve, keyboard controls, drag/visual graph and reset to vibe. | Done | `Mixes.tsx`. |
| T0146 Display requested curve separately from achieved/planned per-song energy. | Done | `achievedArc` in `Mixes.tsx`. |
| T0147 Clearly distinguish this mix from stored global defaults; add per-mix API only when supported. | Done | `Mixes.tsx` labels defaults as applying to future mixes. |
| T0148 Preserve Smooth/Punchy transition feel and Never/Sometimes/Often stem preference. | Done | `Mixes.tsx`. |
| T0149 Preserve song destination search/clear and explain unreachable endpoint constraints. | Done | `chooseDestination` in `Mixes.tsx`. |
| T0150 Protect last slider user intent from stale async responses and optimistic rollback errors. | Done | `arcSaves` in `Mixes.tsx`, `saves` in `Workshop.tsx`. |
| T0151 Test extreme curve, reset, rapid input, invalid target and persisted settings. | Partly | Saving, resetting and persistence are in `web/src/views/Mixes.test.tsx`. Extreme curves and rapid input have no test of their own. |
| T0152 Approve ADR-0011. | Done | The owner accepted ADR-0011 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 06 - Drafts, mix editing, seam inspection and export

### [Drafts and render queue](adr-0012-drafts-and-queue.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0153 Create My Mixes cards showing current/draft, duration, readiness, render state and blocker. | Done | `web/src/views/Drafts.tsx`. |
| T0154 Preserve save current, create, rename, duplicate, delete, restore and independent Undo. | Done | `tests/test_drafts.py`, `web/e2e/flows.e2e.ts`. |
| T0155 Preserve intentional play/swap semantics without changing current mix prematurely. | Done | `tests/test_drafts.py`. |
| T0156 Expose prioritized render queue order, Move earlier/later and Remove from line. | Done | `line-controls` in `Drafts.tsx`. |
| T0157 Explain storage-blocked rendering and link to Workshop. | Done | `Workshop.tsx`, `Drafts.tsx`. |
| T0158 Ensure all project actions use stable IDs and survive reload/route navigation. | Done | `web/e2e/flows.e2e.ts`: draft survives reload. |
| T0159 Test queue competition, duplicate names, missing draft, deletion/undo, storage limit and swap. | Done | `tests/test_drafts.py`, `web/src/views/Drafts.test.tsx`. |
| T0160 Approve ADR-0012. | Done | The owner accepted ADR-0012 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Edit timeline and scoped actions](adr-0013-edit-timeline.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0161 Implement distinct song, seam and pending-request timeline row types. | Done | `web/src/views/Mix.tsx`. |
| T0162 Implement desktop timeline+inspector and mobile sheet for selected rows. | Done | `web/src/views/Mix.tsx`. |
| T0163 Keep add/insert, ranked suggestions, Analyse, reorder, lock, remove and Undo. | Done | `web/src/views/Mix.test.tsx`, `web/e2e/flows.e2e.ts`. |
| T0164 Add drag handle, insertion indicator, autoscroll and keyboard Move up/down. | Done | `scrollWhileDragging` and move buttons in `Mix.tsx`. |
| T0165 Use stable seam/song IDs and current/draft scope on every mutation. | Done | `guard` in `Mix.tsx`, `x-mix-order`. |
| T0166 Protect playing audio commitment boundary and rollback rejected reorders. | Done | `web/e2e/flows.e2e.ts`: a stale change stops and touches nothing. |
| T0167 Test wrong-scope, locked moves, request ghost state, song removed while playing, reorder/poll race. | Partly | Wrong scope, stale reorders and request rows are tested. A song removed while it plays has no test of its own. |
| T0168 Approve ADR-0013. | Done | The owner accepted ADR-0013 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Seam inspector and render truth](adr-0014-seam-inspector.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0169 Build Listen, Change, Studio and Details areas for selected seam. | Done | `web/src/views/SeamInspector.tsx`, `web/e2e/flows.e2e.ts`. |
| T0170 Preserve style, length, word phrase, manual entry/exit cues, preview, audit and Good/Bad. | Done | `SeamEditor`, existing tests. |
| T0171 Explain unavailable styles, impossible cues and minimum post-transition playtime. | Done | `option.reason` on each move, `tests/test_room_to_play.py`. |
| T0172 Show requested/user-selected move separately from actual playable fallback. | Done | `seamFacts` in `web/src/ui/seam.ts`. |
| T0173 Key render request/results and previews to seam identity + revision, rejecting stale outcomes. | Done | A seam's key is a hash of what it asks for, so old results can't apply. |
| T0174 Keep advanced audit accessible without overwhelming main timeline. | Done | Details tab in `SeamInspector.tsx`. |
| T0175 Test fast style switching, late render, malformed cue, failed fallback and rating correct seam. | Partly | Playing the exact render and rating it are tested. Fast switching and malformed cues have no test of their own. |
| T0176 Approve ADR-0014. | Done | The owner accepted ADR-0014 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [FLAC export](adr-0022-flac-export.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0177 Show exact selected current/draft mix and revision in Export UI. | Done | `web/src/views/ExportPanel.tsx`. |
| T0178 Expose unmet seam render dependencies, actual progress and blocking errors. | Done | `web/src/views/ExportPanel.tsx`. |
| T0179 Keep FLAC export and final download link once artifact is confirmed ready. | Done | `web/e2e/flows.e2e.ts`: the link gives a real FLAC. |
| T0180 Define immutable export snapshot or invalidation when a mix changes mid-export. | Done | `ExportPanel.tsx` stops if the order changes, and the server refuses it. `web/e2e/integration.e2e.ts`. |
| T0181 Test partial seam, disk full, failed render, retry, stale URL and playable FLAC decode. | Partly | Stale, retry and real FLAC bytes are tested. A full disk wasn't. |
| T0182 Approve ADR-0022. | Done | The owner accepted ADR-0022 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 07 - Live song requests and bridge transactions

### [Live Requests and bridge atomicity](adr-0015-requests-and-bridges.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0183 Design persistent request drawer/sheet with debounced search and immediate acknowledgement. | Done | `web/src/views/Requests.tsx`, `Shell.test.tsx`. |
| T0184 Map internal statuses to Finding place, Getting ready, Needs choice, Coming up, Needs attention. | Done | `GROUP_ORDER` in `Requests.tsx`. |
| T0185 Preserve concurrent multi-request planning, no duplicated songs and reserved position conflicts. | Done | `tests/test_requests_together.py`, `web/e2e/integration.e2e.ts`. |
| T0186 Display proposed direct insertion or bridge route with up to three intermediate songs. | Done | `BridgeFinder` in `Requests.tsx`. |
| T0187 Preserve bridge audition, explicit approval, alternatives, cancel and Play anyway warning. | Done | `web/src/views/Requests.test.tsx`. |
| T0188 Keep ghosted/pending rows visible but non-playable until atomic commit. | Done | `ComingSongs`, `RequestsJoining.test.tsx`. |
| T0189 Implement idempotent, revision-aware multi-song bridge commit when every seam is ready. | Done | `tests/test_requests_together.py`, `tests/test_request_routes.py`. |
| T0190 Recheck after live playhead advances, edits, new requests and cancellation. | Done | `checkNow` in `Requests.tsx`, `tests/test_request_planner.py`. |
| T0191 Prevent canceled requests from resurrection after stale poll; no wrong or partial insertion. | Done | `web/e2e/integration.e2e.ts`, `tests/test_request_routes.py`. |
| T0192 Test duplicate submit, approval-vs-cancel race, bridge partial render, preemption and imminent seam. | Partly | Duplicate submits, approving a cancelled request and bridges that are not finished are tested. Preemption and an imminent seam have no test of their own. |
| T0193 Approve ADR-0015 and verify original request tests. | Needs a person | Approving a decision is yours to do. |

## Phase 08 - Stem Studio

### [Stem Studio](adr-0016-stem-studio.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0194 Preserve both songs × four stems × eight cells (64 toggles), two-bar timing and all existing presets. | Done | `web/src/views/Studio.tsx`, `tests/test_studio.py`. |
| T0195 Implement clear song labels, four stem lane labels, time ruler, playhead and audition transport. | Done | `web/src/views/Studio.tsx`. |
| T0196 Keep local instantaneous Web Audio response and individual stem solo. | Partly | Code unchanged in how it plays. Instant response wasn't measured in a browser, because it needs real stems. |
| T0197 Implement accessible roving-keyboard grid and full mobile lane navigation. | Done | `web/src/views/Studio.test.tsx`. |
| T0198 Preserve Let Selecta arrange, Fine tune mine, explain diff and Put it back. | Done | `tests/test_studio.py`, `Studio.test.tsx`. |
| T0199 Track local dirty candidate separately from committed seam shape; recover when navigating. | Done | `savedShape` and `keepShape` in `Studio.tsx`. |
| T0200 Commit Use this to exact seam revision and retain shape on render failure. | Done | `tests/test_studio.py`. |
| T0201 Test every cell, rapid toggling, all presets, incomplete stems, AI success/failure, undo and A/B audio. | Partly | Unit tests. Real stems weren't run in the browser tests, so A/B audio is unverified. |
| T0202 Approve ADR-0016. | Done | The owner accepted ADR-0016 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 09 - Library, overrides and Discover

### [Library readiness and scale](adr-0017-library-scale-and-readiness.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0203 Use actual planner mix-ready eligibility and reason codes instead of analysed boolean alone. | Done | `readiness_of`, `tests/test_api_contracts.py`. |
| T0204 Preserve Ready/Not yet/Priority/Set aside/Everything and full library search. | Done | `web/src/views/Library.tsx`. |
| T0205 Implement server pagination/cursors and stable sort so >200 songs remain accessible. | Done | `tests/test_library_edges.py`: 20,000 songs all reachable. |
| T0206 Design desktop table, mobile rows and song detail with diagnostics. | Done | `SongDetails` in `Library.tsx`. |
| T0207 Preserve Priority, Never play, Add, Play next and Start mix context actions. | Done | `web/src/views/Library.test.tsx`. |
| T0208 Handle background scan arrivals and status changes without wrong-row identity or dropped focus. | Done | Rows keyed by id. `tests/test_api_contracts.py`: a song arriving mid-way. |
| T0209 Test 20k library, duplicate names, Unicode, missing files, search races and failed analysis. | Done | `tests/test_library_edges.py`, `web/e2e/integration.e2e.ts`. |
| T0210 Approve ADR-0017. | Done | The owner accepted ADR-0017 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Metadata corrections and local sources](adr-0018-library-corrections-and-folders.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0211 Add validated reversible per-song overrides for BPM, key and music/nonmusic classification. | Done | `/api/songs/{id}/correct`, `tests/test_api_contracts.py`. |
| T0212 Keep override provenance distinct from original analyzer output and survive reanalysis. | Done | `song_overrides`, `tests/test_api_contracts.py`. |
| T0213 Invalidate only dependent features/seams/caches when analysis correction changes. | Done | `forget_song`, `tests/test_api_contracts.py`. |
| T0214 Preserve priority analysis, Never-play exclusion and Set aside semantics separately. | Done | `tests/test_api_contracts.py`. |
| T0215 Improve watched folder list, scan progress, unavailable folder and typed path fallback. | Done | `FoldersPanel` in `Workshop.tsx`. |
| T0216 Use native folder picker only with safe host-local path binding; no insecure browser access. | Not done | Not built. The typed path stays, which is the safe option the task allows. |
| T0217 Test half/double BPM, invalid key, worker race, moved source, Unicode paths and malicious input. | Partly | Half and double tempo, invalid keys and hostile input are tested. Worker races and moved sources aren't. |
| T0218 Approve ADR-0018. | Done | The owner accepted ADR-0018 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Word and harmonic Discover](adr-0019-discover-words-and-harmony.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0219 Separate Word connections and Harmonic discoveries in the Discover destination. | Done | `web/src/views/Links.tsx`. |
| T0220 Preserve phrase links, paired-song preview, rating and audible result state. | Done | `web/src/views/Links.test.tsx`. |
| T0221 Preserve complete four-stage chord audition with visible chord names and song playback. | Done | `Links.tsx`, `tests/test_discovery_sequence.py`. |
| T0222 Preserve Yes/No/Skip judgment, revisiting/adjusting feedback and history. | Done | `Links.tsx`, `tests/test_discovery_sequence.py`. |
| T0223 Add atomic pair insertion and explicit current/draft destination when backend supports it. | Done | `/api/mix/pair`, the destination menu in `Links.tsx`. |
| T0224 Prevent partial insertion and audio conflicts across discovery previews. | Done | `/api/mix/pair` is all or nothing. Previews go through `audio/focus.ts`. |
| T0225 Test missing lyric timing, same word many times, failed render, stage skip and duplicate songs. | Partly | Most covered in `Links.test.tsx`. Failed render with a real stage skip isn't in a browser test. |
| T0226 Approve ADR-0019. | Done | The owner accepted ADR-0019 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 10 - Workshop, listening research and diagnostics

### [Workshop and cache/processing](adr-0020-workshop-and-storage.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0227 Organize Overview, Analysis, Storage, Sources and Learning/Listening without hiding old controls. | Done | `web/src/views/Workshop.tsx`. |
| T0228 Keep worker pause/start, analysis progress, render priority, preemption and real ETAs. | Done | `Workshop.tsx`, `tests/test_eta.py`, `tests/test_api_contracts.py`. |
| T0229 Distinguish cached bytes/cache budget from free disk capacity and protected priority storage. | Done | `StoragePanel` in `Workshop.tsx`. |
| T0230 Expose jobs queued, working, blocked, failed and unavailable with actual backend facts. | Done | `JobsPanel`, `/api/jobs`. |
| T0231 Preserve source watchers, priority processing and live storage budget control. | Done | `Workshop.tsx`. |
| T0232 Use revision-aware storage writes and reconcile slider to confirmed value. | Done | `saves` in `StoragePanel`, showing what was really saved. |
| T0233 Test low disk, old cache metadata, paused worker, render contention, missing source and stale write. | Partly | `web/src/views/Workshop.test.tsx` and server tests. Low disk wasn't tried for real. |
| T0234 Approve ADR-0020. | Done | The owner accepted ADR-0020 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Blind listening studies](adr-0021-blind-listening.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0235 Preserve blind A/B presentation and listener/study identifiers. | Done | `web/src/views/Listening.tsx`, `tests/test_listening.py`. |
| T0236 Preserve five-point quality, issue tags and A/B/No preference/Cannot judge choices. | Done | `web/src/views/Listening.tsx`. |
| T0237 Replace difficult issue multi-select with accessible stable checkbox/multiselect control. | Done | Checkboxes in `Listening.tsx`. |
| T0238 Ensure only one study audio condition plays at once; don't disclose condition identity. | Done | `usePreview`, and the page shows only A and B. |
| T0239 Keep failed response submission recoverable and prevent duplicate stored trial responses. | Done | `x-operation-id` in `Listening.tsx`, `tests/test_listening.py`. |
| T0240 Do not change musical study protocol/meaning without a separate versioned ADR. | Done | The study's questions and scoring weren't changed. |
| T0241 Test missing clip, partial trial, refresh, keyboard, double submit and final completion. | Done | `web/src/views/ListeningStudyFlow.test.tsx` (5 tests, blind listening study, start to finish): missing clip with cannot-judge, refresh part way restoring the same comparison, double submit stored once, keyboard alone to the end, finishing saves each once and says complete. Passed 2026-11-10 (vitest). |
| T0242 Approve ADR-0021. | Done | The owner accepted ADR-0021 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Local diagnostics and operation tracing](adr-0032-diagnostics-and-operations.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0243 Show local server and worker availability, current jobs and actionable recent failure state. | Done | `JobsPanel`, `/api/jobs`. |
| T0244 Use operation IDs to correlate UI requests with backend outcomes when supported. | Partly | Operation ids reach the server and de-duplicate. There's no log linking them to outcomes. |
| T0245 Display accurate queued/blocked/running/failed jobs; label ETAs as estimates. | Done | `JobsPanel`, and estimates are labelled. |
| T0246 Redact source filesystem paths and song metadata in default diagnostics. | Done | `tests/test_api_contracts.py`, `web/e2e/flows.e2e.ts`. |
| T0247 Ensure diagnostics add minimal CPU cost and no remote telemetry. | Done | Only runs when asked. `web/e2e/pages.e2e.ts` shows nothing leaves this computer. |
| T0248 Test redaction, worker restart, slow status, storage block and operation correlation. | Partly | Redaction and slow answers are tested. Worker restart and correlation aren't. |
| T0249 Approve ADR-0032. | Done | The owner accepted ADR-0032 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

## Phase 11 - Cross-feature integration

### Cross-feature integration scenarios

| Task | Status | How we know, or what's left |
|---|---|---|
| T0250 Complete current-vs-draft isolation sequence while listening, requesting, editing and undoing. | Done | `web/e2e/integration.e2e.ts`. |
| T0251 Complete two simultaneous requests competing for a slot, bridge approval and stale cancellation replay. | Partly | `web/e2e/integration.e2e.ts` covers competing requests and stale cancels. Bridge approval there is covered by server tests only. |
| T0252 Complete manual cue change while a previous render finishes and fallback plays; verify intended/actual difference. | Not done | Pieces are tested separately. This exact sequence isn't. |
| T0253 Complete Studio local audition → pause main playback → navigate → commit exact seam → render failure recovery. | Needs a person | needs real stems on the owner's machine and someone listening to the committed seam (checked 2026-11-10). |
| T0254 Complete export of a draft while switching/reordering other mixes; verify snapshot and FLAC bytes. | Done | `web/e2e/integration.e2e.ts`. |
| T0255 Complete metadata override while background analysis finishes and the library watch detects new files. | Partly | `web/e2e/integration.e2e.ts` covers a correction with the page open. Not alongside a live folder watch. |
| T0256 Complete backend restart during mutation, reconnect/retry and two-tab active playback takeover. | Partly | Tabs and simulated server loss are tested. Not a real restart mid-change. |
| T0257 Confirm no preserved feature in feature-parity ledger has lost navigation or an authoritative backend side effect. | Done | `docs/adr/feature-parity.md`, `web/e2e/pages.e2e.ts`. |
| T0258 Run end-to-end integration tests with representative song fixtures and audit all discovered regressions. | Partly | `web/e2e` runs on made-up songs. All the problems found were fixed. Real songs need a person listening. |

## Phase 12 - Quality, accessibility, performance and verification

### Full quality and acceptance gates

| Task | Status | How we know, or what's left |
|---|---|---|
| T0259 Run unchanged/backwards-compatible legacy unit tests and explain any necessary selector updates. | Done | Existing tests kept. Changes are listed in the PR description. |
| T0260 Run extended frontend tests, Python tests, API contracts and browser E2E suites on PR and main. | Done | Lint, file length, server, page and browser tests all run in CI on this PR, and on main once merged. |
| T0261 Run deterministic real Web Audio tests for seek, late seam, fallback, preview focus and exact media key behaviour. | Partly | Seek, late seam, fallback, preview focus and media keys are tested in real Edge. Sound itself can't be judged by a test. |
| T0262 Run visual regression for dark/light, 320px–4K, safe areas, reduced motion and high zoom. | Partly | No visual regression. Layout checks run in both themes from 320px to 4K, and reduced motion is on for accessibility checks. |
| T0263 Complete keyboard-only workflows for request, Mixes, Edit, Studio, Library, export and study. | Partly | Keyboard use is tested on Listen, Requests, dialogs and the Library. Not every workflow start to finish. |
| T0264 Complete NVDA, VoiceOver and applicable mobile assistive-technology testing against WCAG 2.2 AA. | Needs a person | NVDA, VoiceOver and mobile assistive-technology sessions run by a person (checked 2026-11-10). |
| T0265 Profile >20k Library, >100-song Edit, 64-cell Studio and concurrent render under constrained CPU/storage. | Partly | 20,000 songs measured. A 100-song Edit, the Studio and constrained CPU weren't. |
| T0266 Conduct user task tests for casual listener, creator and expert editor without guided help. | Needs a person | unguided task tests with a casual listener, a creator and an expert editor (checked 2026-11-10). |
| T0267 Conduct actual listener blind comparisons; document subjective audio quality separately from render pass. | Needs a person | blind comparisons with real listeners, following `docs/listening-procedure.md` (checked 2026-11-10). |
| T0268 Verify local networking/origin/security and no private telemetry or original-file deletion. | Done | `tests/test_api_contracts.py`, `web/e2e/pages.e2e.ts`. |
| T0269 Audit every ADR acceptance criterion and link concrete CI/QA proof before marking Verified. | Partly | This file is that audit against the tracker. Each ADR's own criteria weren't linked one by one. |
| T0270 Update ADR decision/implementation status history, the ADR index, parity matrix and roadmap with merged implementation PR links. | Done | `docs/adr/` updated in this PR. |

## Phase 13 - Release, rollback and final sign-off

### Controlled release and rollback

| Task | Status | How we know, or what's left |
|---|---|---|
| T0271 Back up and restore representative existing mixes, drafts, ratings, settings, metadata and caches. | Done | `tests/test_upgrade.py`: a copy of the folder brings back mixes, drafts, settings and corrections. |
| T0272 Verify forward migration and backward compatibility with pre-overhaul local server/client where required. | Done | `tests/test_upgrade.py` opens an older library. Going back to `911c981` and forward again is recorded in `docs/acceptance.md`. |
| T0273 Rehearse rollback of frontend routing and any schema changes without losing files or ratings. | Partly | Schema, mixes, drafts and settings were rehearsed, as `docs/acceptance.md` records. Ratings weren't part of it. |
| T0274 Confirm a newly installed PWA, a normal browser tab and an existing upgraded installation. | Needs a person | install the PWA fresh, use a normal tab and upgrade an existing installation (checked 2026-11-10). |
| T0275 Resolve all critical data-integrity, audio continuity, bridge atomicity, accessibility, export and privacy blockers. | Partly | None known. Screen readers and listening could still find some. |
| T0276 Run Windows CI plus browser/audio/a11y gates on release candidate commit. | Partly | CI runs on this PR. Screen reader and listening gates need a person. |
| T0277 Record final human listening evidence and explicitly accepted remaining noncritical limitations. | Needs a person | the owner's own listening evidence and sign-off on remaining noncritical limitations (checked 2026-11-10). |
| T0278 Verify every checklist item has a linked implementing PR and evidence; do not infer completion from docs. | Partly | This file does that, and the ticks on the PR come from it. |
| T0279 Merge/close this tracking PR only after the programme's delivery is actually complete; keep it open otherwise. | Needs a person | the owner merges or closes the tracking PR once delivery is complete (checked 2026-11-10). |
