# Selecta 2.0: what's done, task by task

Each of the 279 tasks in [#22](https://github.com/tochi-mba/selecta/pull/22), and what's true of it today. Done rows are the ones ticked on the PR.

**212 done, 44 partly, 3 not done, and 20 that need a person** (approvals, screen readers, listening, installing it).

Passing these checks doesn't mean it sounds good. That's for people to judge, using [the listening procedure](../listening-procedure.md).

## Phase 00 - Baseline, parity and implementation governance

### [Product contract and parity](adr-0001-product-contract-and-parity.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0001 Pin the pre-redesign main SHA and archive representative screenshots, API responses, settings and playback traces. | Partly | Baseline pinned at main `911c981`. Its API routes and read-response shapes are archived in `tests/fixtures/api_contracts_baseline.json` (checked by `tests/test_api_contract_fixtures.py`). Still missing: screenshots, settings and playback traces captured from a running `911c981` build (checked 2026-11-11). |
| T0002 Inventory every existing feature and expose each in the new Listen/Mixes/Library/Discover/Workshop structure. | Done | `docs/adr/feature-parity.md` lists every feature with where it now lives. `web/e2e/pages.e2e.ts` opens every page. |
| T0003 Record current user journeys for casual listening, live requesting, mix creation and expert seam editing. | Done | Written record in `docs/user-journeys.md`: casual listening, live requesting, mix creation and expert seam editing, 22 steps, each naming the browser test in `web/e2e/` (listen, flows, integration, mp-0283, mp-0288, mp-0290) that walks it. `tests/test_user_journeys.py` (2 tests) fails if a named test is renamed or removed. Passed 2026-11-11 (pytest, 2 passed). |
| T0004 Verify the existing acceptance ledger against actual code and flag historical limits rather than copying speculative claims. | Partly | `docs/acceptance.md` updated for this work, but not re-checked line by line. Many of its rows are measurements on the owner's real library (scan counts, analysis times, lyric coverage, request fits), which agents may not re-run; those need the owner to re-measure (checked 2026-11-11). |
| T0005 Agree with reviewers which features are in scope, non-goals and blocked-by-backend capabilities. | Needs a person | agree in-scope features, non-goals and backend-blocked capabilities with a named reviewer and record it. ADR-0001 itself was accepted in #37 on 2026-11-08, but no reviewer scope record exists (checked 2026-11-10). |
| T0006 Document hard invariants for no lost user data, no wrong-mix edits, no unauthorized bridge and no audio interruption. | Done | Invariants are written down in `docs/adr/feature-parity.md`. |
| T0007 Approve ADR-0001 or document any explicitly superseding decision. | Done | The owner accepted ADR-0001 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Baseline and test architecture](adr-0029-testing-and-quality.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0008 Run and record baseline Windows CI: Ruff, pytest with coverage >=70%, pnpm test and pnpm build. | Done | Pre-redesign baseline main `911c981` failed 5 stale tests, fixed here. Green `test` run 42899772224 on main `14b9709` (2026-11-10): Windows pytest shards with coverage, the `verify` gate `coverage report --fail-under=70`, ruff, `pnpm test`, and `pnpm build` (Web job and Windows Edge E2E jobs) all passed. Checked 2026-11-11 with `gh run view 42899772224`. |
| T0009 Inventory component and player tests; map every existing behavioural assertion to parity requirements. | Done | `docs/adr/test-parity-inventory.json` lists all 263 component and player tests from the pre-redesign baseline `911c981` (App, api, lib, player and every view test), each mapped to the `feature-parity.md` row its assertions protect, and kept verbatim, moved to another file, or replaced by a named current test (15 replaced, such as the global busy heuristic now covered by `ui/controls.test.tsx`). `tests/test_parity_inventory.py` (3 tests) fails if a row or test disappears. Passed 2026-11-11 (pytest, with `test_file_length.py`: 6 passed). |
| T0010 Create deterministic original/licensed fixture audio with valid/invalid beat grids, cue positions and fallback seams. | Done | `tests/audio_fixtures.py` builds original, seeded synth audio (no real or licensed music): a steady grid, a drifting grid, named invalid grids (too few, empty, spurious off-beats, missing beats), cue positions on known downbeats plus an off-grid time, and a 120/85 BPM pair that forces a fallback seam. `tests/test_audio_fixtures.py` (6 tests) proves determinism, exact grid fit, rejection or repair of each invalid grid, cues landing on bars, and the fallback rendering playable audio. Writing it found a bug in `regularize` (`src/selecta/analysis/beats.py`): a gap of 3+ beats was filled with doubled spacing; fixed. Passed 2026-11-11 (pytest with `tests/test_analysis.py`: 16 passed, 1 skipped). |
| T0011 Create metadata fixtures for empty library, one song, short library, duplicate title, unicode/RTL, wrong tempo and missing files. | Done | `tests/e2e_server.py` and `tests/test_library_edges.py`: empty, duplicates, Unicode and RTL, wrong tempo, missing files. |
| T0012 Create render/request/stem fixtures for pending, ready, failed, canceled, stale and storage-blocked operations. | Done | `web/src/test/operations.ts` holds render, request, stem and export fixtures for all six states (pending, ready, failed, canceled, stale, storage-blocked); `web/src/test/operations.test.ts` (7 tests, operation fixtures (T0012)) checks each one means what its name says. Passed 2026-11-10 (vitest). |
| T0013 Set up a browser E2E test harness and deterministic clock/network failure injection. | Partly | Playwright in `web/e2e` with network failure injection. No deterministic clock. |
| T0014 Set up accessible component tests, visual-regression baseline and real Web Audio browser smoke tests. | Needs a person | Needs a person: the owner approves a visual-regression baseline. Accessible component tests (`web/src/ui/controls.test.tsx`, `formControls.test.tsx`), axe checks (`web/e2e/pages.e2e.ts`) and real Web Audio smoke tests (`web/e2e/listen.e2e.ts`) exist; `web/e2e/visual.e2e.ts` captures review candidates at 4 sizes in both themes but they are deliberately not golden images until a person approves them (checked 2026-11-11). |
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
| T0023 Audit current styles and CSS scope collisions including `.handoff`. | Done | Audit written in `docs/engineering/css-ownership.md` ("Scope collisions"): `.handoff` classes are rendered only by `views/Now.tsx` and styled only in `style.css`, `styles/listening.css` (scoped by `.now`/`.stage`) and `styles/music-objects.css`; `.link-handoff` is a separate class. `web/src/styles/scope-collisions.test.ts` (4 tests) and `css-ownership.test.ts` keep it true. Passed 2026-11-11 (vitest, 20 tests with flow-fonts). |
| T0024 Codify dark/light colours and semantic surfaces/text/focus/status tokens without changing Selecta's existing identity. | Done | `web/src/styles/tokens.css`, dark and light. |
| T0025 Define type scales, spacing, radii, motion, elevation and stacking tokens. | Done | `web/src/styles/tokens.css`. |
| T0026 Implement scoped feature styles or CSS modules; remove accidental global cross-feature selectors. | Done | Feature styles are split into owned sheets loaded in a fixed order (`styles/listening.css`, `creation.css`, `operations.css`, `lucy.css`, documented in `docs/engineering/css-ownership.md`), scoped by page class. `web/src/styles/scope-collisions.test.ts` fails when a bare class is styled by two page sheets (only `.page` compounds and the `.draft-list.long` modifier are shared on purpose) or a page sheet restyles a bare element. Passed 2026-11-11 (vitest). Plain scoped stylesheets were chosen over CSS modules. |
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
| T0043 Audit form validation, meaningful errors, non-colour state and reduced motion. | Partly | Automatic checks cover the parts: `Field` and `formControls.tsx` join errors to their control (`web/src/ui/formControls.test.tsx`, `polish-components.test.tsx`), every work state has words as well as a colour (`web/src/state/workState.ts`), and reduced motion is tested (`useReducedMotion.test.tsx`, `web/e2e/motion-preference.e2e.ts`). Still missing: a page-by-page written audit of every form's validation and error wording (checked 2026-11-11). |
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
| T0068 Move API calls into typed client/services and centralize cache ownership and polling policy. | Partly | Most calls go through `api.ts`, and nine pages share one polling policy in `web/src/ui/useVisiblePoll.ts` (no background-tab reads, no pile-up). Left (checked 2026-11-11): `lucy/listening.ts`, `views/LocalBackup.tsx`, `player.ts` and `studio.ts` still call `fetch` directly; `views/Lucy.tsx`, `views/Requests.tsx`, `rooms/RoomPanel.tsx` and `devices/DevicesPanel.tsx` run their own `setInterval` polls; there is no single cache owner. |
| T0069 Add cancellation/sequence protection so stale queries cannot overwrite newer data. | Done | `mixChanges` in `App.tsx`, sequence checks on sliders and searches. |
| T0070 Add mutation pending/error/rollback state with clearly scoped current-versus-draft resource IDs. | Done | `Action`, scope in the address, `x-mix-order`. |
| T0071 Add optimistic request reconciliation keyed by operation ID and backend confirmation. | Done | `web/src/views/Requests.tsx` with `x-operation-id`. |
| T0072 Implement server revision or conflict tokens for mix/seam/request/settings mutations where required. | Done | `x-mix-order`, tested in `tests/test_api_contracts.py`. |
| T0073 Test rapid clicking, concurrent tabs, stale polling, double submit, retry and lost connection. | Done | `web/e2e/flows.e2e.ts`, `listen.e2e.ts`, `tests/test_api_contracts.py`. |
| T0074 Approve ADR-0005 state rules. | Done | The owner accepted ADR-0005 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [Additive backend API evolution](adr-0026-api-compatibility.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0075 Capture existing request/response contracts as fixtures; keep existing endpoints usable. | Done | `tests/fixtures/api_contracts_baseline.json` records all 73 routes of the pre-redesign server (main `911c981`, read from its `src/selecta/api.py`) and the response shape of 13 read routes (`/api/status`, `/api/storage`, `/api/songs`, `/api/songs/1`, `/api/mix`, `/api/drafts`, `/api/requests`, `/api/discoveries`, `/api/memory`, `/api/memory/ratings`, `/api/links`, `/api/vibes`, `/api/listening`). `tests/test_api_contract_fixtures.py` (15 tests: every old route still offered, each read still matching its recorded shape, and the shape check itself) fails on a removed route, removed field or changed type while allowing additions. Passed 2026-11-11 (pytest, 15 passed). |
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
| T0094 Define server-reconnect, retry and idempotent recovery for every durable mutation. | Partly | Retry everywhere, with operation ids on requests, inserts and listening responses; export operation ids survive a restart, and a retried mix edit after a restart is stopped by `x-mix-order` instead of applying twice (`tests/test_restart_mid_work.py`, 2026-11-11). Left: the operation-id memory in `src/selecta/api.py` is in memory only, and mutations without `x-mix-order` (storage limit, steering, corrections, drafts) have no idempotent replay after a restart. |
| T0095 Implement active audio owner/takeover policy across multiple app tabs/windows. | Done | `state/tabs.ts`, `web/e2e/listen.e2e.ts`. |
| T0096 Show conflicts rather than silently overwriting newer mix, cue, request or setting state. | Partly | Mix and seam edits are refused with a message when the mix changed (`x-mix-order`), and requests answer 409 with a reason when they have already joined, been cancelled or lost their place (`src/selecta/routes/song_requests.py`). Left (checked 2026-11-11): `POST /api/storage` and `POST /api/steer` carry no revision, so a second window's newer storage limit is overwritten silently. |
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
| T0135 Test explanatory fallback, missing backend factors, stale rating and screen-reader announcements. | Needs a person | Needs a person: someone runs NVDA or VoiceOver on Listen and confirms the transition notices and rating replies are announced once, politely. Automated part done 2026-11-11: `web/src/views/explanations.test.tsx` (5 tests, vitest, passed) covers the late-transition and failed-transition fallback wording, Why inventing no factors the server didn't send, a rating answering after the next transition never applying to it, and notices using a polite `role="status"` with no assertive region. |
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
| T0143 Test every preset, sparse library, failed build, double click and playback preservation. | Done | New `tests/test_s2_mix_presets.py`: all sixteen presets resolve, every preset builds only from its own songs with no repeats or is honestly not offered (parametrized over `VIBES`), every family journey card builds inside its family, a sparse library refuses the build and keeps the current mix, a failed build changes nothing and makes no empty draft (also for Save as draft, and 404 for an unknown preset), and a second click on a changed mix gets 409 `mix_changed` without replacing it. Playback preservation also in `web/src/views/Mixes.test.tsx` (`keeps the active mix until confirmation...`). Run 2026-11-11 under the slot lock with T0151/T0175 tests: 58 passed. |
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
| T0151 Test extreme curve, reset, rapid input, invalid target and persisted settings. | Done | New `tests/test_s2_steering.py`: flat, full and zigzag curves kept exactly and surviving an app restart, invalid curves (out of range, wrong length, fractions, booleans, text) refused with the saved one kept, reset to each mix's own arc persists, rapid writes end on the last, invalid destinations refused with the saved one kept, a destination that left the library stops the build with a reason, and the planner builds whole mixes on extreme curves. New `web/src/views/s2Steering.test.tsx`: extreme and invalid stop values clamp to 0-100 whole numbers, flattest and steepest curves save exactly, and rapid slider input sends one save with only the last shape. Run 2026-11-11: pytest 58 passed (with T0143/T0175), vitest 9 passed (with s2StemDeck). |
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
| T0167 Test wrong-scope, locked moves, request ghost state, song removed while playing, reorder/poll race. | Done | Song removed while playing: new `web/src/s2PlayerRemoval.test.ts` (keeps sounding with no restart; Next goes to the song that followed it; the end fade brings that song in) plus a fix in `web/src/player.ts` (`tick`, `next`, `fadeInto`: a removed playing song no longer makes Next jump to the top of the mix or skip the following song, and the seam listed there is not used). Wrong scope, request ghost rows and reorder/poll race: `web/src/views/Mix.test.tsx` (`keeps each mix scope's exact selection separate...`, `show up faded in the timeline...`, `stop and catch up if the mix has moved on`). Locked moves: `tests/test_mix.py::test_a_new_plan_keeps_locked_songs_where_they_are`, `tests/test_request_routes.py::test_playing_it_anyway_never_moves_a_locked_song`. Run 2026-11-11: vitest player 38 passed, Mix 59 passed; pytest 2 + 167 passed. Known limit: while a removed song finishes, the Now card shows the next song's title (display only). |
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
| T0175 Test fast style switching, late render, malformed cue, failed fallback and rating correct seam. | Done | Fast style switching and malformed cues: `tests/test_s2_seam_inspector.py` (`test_fast_style_switching_ends_on_the_last_choice_and_its_own_render`, `test_an_unknown_style_is_refused_and_the_saved_one_stays`, `test_a_malformed_cue_never_breaks_the_mix_or_its_render_request`), 58 passed 2026-11-11. Late render and failed fallback: `web/src/player.test.ts` (`does not start a seam after its cue`, `loads a completed render without waiting for the whole mix to refresh`, `ignores a failed fallback download after the listener seeks elsewhere`), 38 passed 2026-11-11. Rating the correct seam: `web/src/views/Mix.test.tsx` (`posts to that seam alone, and shows the saved rating again after a remount`, `keeps the latest choice visible when an older server response refreshes the inspector`), 59 passed 2026-11-11; `web/src/views/LinksRating.test.tsx` 25 passed with Links. |
| T0176 Approve ADR-0014. | Done | The owner accepted ADR-0014 on 2026-11-08 in [#37](https://github.com/tochi-mba/selecta/pull/37) (merge `100df40`); its **Decision status** line reads Accepted. Re-checked 2026-11-10 with `git show 100df40` and the ADR header. |

### [FLAC export](adr-0022-flac-export.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0177 Show exact selected current/draft mix and revision in Export UI. | Done | `web/src/views/ExportPanel.tsx`. |
| T0178 Expose unmet seam render dependencies, actual progress and blocking errors. | Done | `web/src/views/ExportPanel.tsx`. |
| T0179 Keep FLAC export and final download link once artifact is confirmed ready. | Done | `web/e2e/flows.e2e.ts`: the link gives a real FLAC. |
| T0180 Define immutable export snapshot or invalidation when a mix changes mid-export. | Done | `ExportPanel.tsx` stops if the order changes, and the server refuses it. `web/e2e/integration.e2e.ts`. |
| T0181 Test partial seam, disk full, failed render, retry, stale URL and playable FLAC decode. | Done | Partial seam and stale URL: `tests/test_s2_export_edges.py` (`test_a_partly_rendered_mix_waits_and_writes_no_file`, `test_a_ready_file_that_has_gone_is_shown_expired_and_its_link_is_refused`, `test_a_download_link_cannot_reach_outside_the_exports_folder`). Disk full before and mid-write, failed render and retry: `tests/test_flow_export_jobs.py` (`test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot`, `test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically`, `test_a_failed_transition_names_the_pair_and_the_job_says_failed`), `tests/test_export_retry.py`. Playable FLAC decode: `tests/test_export_validation.py::test_complete_export_is_decoded_frame_by_frame`. Run 2026-11-11 with the request tests: 167 passed. |
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
| T0192 Test duplicate submit, approval-vs-cancel race, bridge partial render, preemption and imminent seam. | Done | Duplicate submit and approval-vs-cancel: `tests/test_requests.py::test_requests_survive_restart_deduplicate_and_cancel_without_changing_mix`, `tests/test_request_routes.py::test_answering_a_cancelled_request_says_so`, `test_playing_it_anyway_twice_is_refused_kindly`. Bridge partial render: `test_a_bridge_does_not_join_until_every_transition_is_ready`. Preemption: `tests/test_drafts.py::test_what_is_about_to_be_heard_still_beats_a_request`, `test_a_request_seam_stops_for_what_is_about_to_be_heard`, `test_lesser_work_stops_for_a_request`. Imminent seam: `tests/test_requests.py::test_request_waits_past_protected_audio_and_checks_return_to_mix`, `tests/test_request_routes.py::test_with_no_time_left_it_is_left_to_fade`, `test_going_past_the_way_out_makes_another_further_on`. Run 2026-11-11: 167 passed. |
| T0193 Approve ADR-0015 and verify original request tests. | Done | ADR-0015 Decision status reads Accepted (owner, 2026-11-08, #37). Original request tests re-run 2026-11-11: `tests/test_requests.py`, `tests/test_request_routes.py`, `tests/test_requests_together.py`, `tests/test_request_planner.py` all pass (in a 167-passed run with the export tests). |

## Phase 08 - Stem Studio

### [Stem Studio](adr-0016-stem-studio.md)

| Task | Status | How we know, or what's left |
|---|---|---|
| T0194 Preserve both songs × four stems × eight cells (64 toggles), two-bar timing and all existing presets. | Done | `web/src/views/Studio.tsx`, `tests/test_studio.py`. |
| T0195 Implement clear song labels, four stem lane labels, time ruler, playhead and audition transport. | Done | `web/src/views/Studio.tsx`. |
| T0196 Keep local instantaneous Web Audio response and individual stem solo. | Done | New `web/src/s2StemDeck.test.ts`: a toggled cell sets that stem's gain at the current AudioContext time (8 ms edge) with no network call, and solo plays one stem alone then un-solo restores the grid (`web/src/studio.ts` StemDeck). UI path: `web/src/views/Studio.test.tsx` (`tapping a square is heard straight away and renders nothing`, `pressing a name plays only that part`). Vitest 2026-11-11: 9 passed with s2Steering. |
| T0197 Implement accessible roving-keyboard grid and full mobile lane navigation. | Done | `web/src/views/Studio.test.tsx`. |
| T0198 Preserve Let Selecta arrange, Fine tune mine, explain diff and Put it back. | Done | `tests/test_studio.py`, `Studio.test.tsx`. |
| T0199 Track local dirty candidate separately from committed seam shape; recover when navigating. | Done | `savedShape` and `keepShape` in `Studio.tsx`. |
| T0200 Commit Use this to exact seam revision and retain shape on render failure. | Done | `tests/test_studio.py`. |
| T0201 Test every cell, rapid toggling, all presets, incomplete stems, AI success/failure, undo and A/B audio. | Needs a person | Needs a person: listening to A/B audio of real stems in Seam Studio (switching shapes and solos on a real pair and confirming what is heard). Automated parts pass 2026-11-11: every cell and rapid toggling (`web/src/views/Studio.test.tsx`, `web/src/views/gp-0261-studio.test.tsx`, 36 passed), every ready-made shape (new `web/src/s2StemDeck.test.ts`), incomplete stems, AI success/failure and undo (`Studio.test.tsx`, `web/src/views/StudioSafety.test.tsx`). |
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
| T0216 Use native folder picker only with safe host-local path binding; no insecure browser access. | Superseded | Superseded by ADR-0134: the owner rejected native folder picker work (also docs/adr/README.md owner-directed scope); the typed host-local path stays, validated by `tests/test_s4_folder_input.py`. |
| T0217 Test half/double BPM, invalid key, worker race, moved source, Unicode paths and malicious input. | Done | Worker race and moved source: new `tests/test_s2_correction_races.py` (`test_corrections_and_a_racing_reanalysis_both_land_in_their_own_place` runs 40 corrections against a thread re-saving analysis; `test_a_correction_follows_its_recording_when_the_folder_moves` relinks a moved folder and keeps the correction). Half/double BPM, invalid key and hostile input: `tests/test_api_contracts.py` (`test_double_time_means_twice_the_beats_and_bars_that_still_line_up`, `test_half_time_means_half_the_beats_and_every_bar_still_exists`, `test_nonsense_is_refused_and_nothing_changes` incl. 13A, 8C and a script tag). Unicode and odd paths: `tests/test_library_edges.py`, `tests/test_s4_folder_input.py`, `tests/test_folder_relink.py`. Run 2026-11-11: 59 passed 1 skipped, plus 8 passed. |
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
| T0225 Test missing lyric timing, same word many times, failed render, stage skip and duplicate songs. | Done | Missing lyric timing, same word many times, duplicate songs: new `tests/test_s2_word_edges.py` (3 passed 2026-11-11). Failed render and stage skip: `web/src/views/Links.test.tsx` (`says so when a pair cannot be played, and you can still answer`, `lets you jump to any step`, `never plays an obsolete prepared audition after the user skips that pair`, `never calls a requested harmonic stage playing until the media element starts`); Links + LinksRating vitest 25 passed 2026-11-11. |
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
| T0233 Test low disk, old cache metadata, paused worker, render contention, missing source and stale write. | Done | New `tests/test_s2_workshop_edges.py`: low disk clamps the limit to what the drive holds, old or broken stem `window.json` and old `storage.json` are counted and pruned without failing, a priority song whose file is missing doesn't pin other stems, and a stale budget write never outlives the last one across a restart. New `web/src/views/s2WorkshopStorage.test.tsx`: a slow older write is serialised and can't overwrite the newer limit. Paused worker: `tests/test_api_contracts.py::test_a_pause_is_remembered_across_a_restart`, `tests/test_request_routes.py::test_a_new_song_respects_analysis_being_paused`. Render contention: `tests/test_mix_mixes.py::test_the_mix_goes_ahead_of_everything_but_what_is_about_to_be_heard`, `test_a_mix_seam_only_gives_way_to_what_is_about_to_be_heard`, `test_spare_time_work_gives_way_to_the_mix`. Missing source: `tests/test_stem_windows.py::test_a_song_that_has_moved_counts_as_not_split_and_breaks_nothing`. Run 2026-11-11: pytest 18 passed; vitest s2WorkshopStorage + Workshop 13 passed. |
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
| T0244 Use operation IDs to correlate UI requests with backend outcomes when supported. | Done | `src/selecta/api.py` echoes a page-made operation id (only the safe `kind-random` shape) on the response and lists it beside its status and repeat flag in `/api/diagnostics` `recent_operations`; `web/src/api.ts` puts it on `ApiError.operation`; `safeDiagnostics` in `web/src/views/WorkshopPanels.tsx` keeps it when copied. `tests/test_diagnostics_operations.py` (5) with `tests/test_operation_identity.py` and the `test_api_contracts.py` operation/diagnostics tests: 23 passed; `web/src/diagnosticsOperations.test.ts` with `Workshop.test.tsx` and `ListeningStudyFlow.test.tsx`: 22 passed, 2026-11-11. |
| T0245 Display accurate queued/blocked/running/failed jobs; label ETAs as estimates. | Done | `JobsPanel`, and estimates are labelled. |
| T0246 Redact source filesystem paths and song metadata in default diagnostics. | Done | `tests/test_api_contracts.py`, `web/e2e/flows.e2e.ts`. |
| T0247 Ensure diagnostics add minimal CPU cost and no remote telemetry. | Done | Only runs when asked. `web/e2e/pages.e2e.ts` shows nothing leaves this computer. |
| T0248 Test redaction, worker restart, slow status, storage block and operation correlation. | Done | Redaction: `test_an_operation_id_that_could_carry_a_path_is_neither_echoed_nor_listed`, `test_diagnostics_have_no_paths_or_song_names`, and the `safeDiagnostics` drop test. Worker restart: `test_diagnostics_and_jobs_follow_a_worker_that_stops_and_restarts`. Slow status: `a status read that never answers gives up after 20 seconds` in `web/src/diagnosticsOperations.test.ts`. Storage block: `test_jobs_say_when_the_storage_limit_blocks_work`. Correlation: `test_an_operation_id_links_the_request_to_its_outcome_and_its_replay`, `test_a_refused_operation_is_correlated_too`. 23 pytest and 22 vitest passed 2026-11-11. |
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
| T0262 Run visual regression for dark/light, 320px–4K, safe areas, reduced motion and high zoom. | Needs a person | Needs a person: approve the screenshot baselines. `web/e2e/visual.e2e.ts` captures review candidates in both themes at 320, 375, 1280 and 1440 px with reduced motion, and layout checks run up to 4K, but a regression comparison needs owner-approved golden images (plus safe-area and high-zoom shots) before it can fail on a change (checked 2026-11-11). |
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
| T0273 Rehearse rollback of frontend routing and any schema changes without losing files or ratings. | Done | Rehearsed 2026-11-11 with `tests/rollback_check.py` against pre-overhaul `911c981` (its `src` extracted with `git archive` into a scratch folder, made-up library only). The check now rates two seams Good and Bad through `/api/seams/{key}/rate` and reads them back via `/api/memory` and `seam-history`: this checkout, the older one and this one again all saw liked 1, disliked 1, the same mix, draft, settings, request and seam setting; this checkout again saw exactly what it saw first, including the export job file and the tempo correction. Known older limits it prints: no export jobs, and it ignores the tempo correction while it runs (as `docs/acceptance.md` records). Result "nothing lost", exit 0. Frontend routing: the server serves whichever `index.html` is deployed for every app address (`test_reloading_any_page_gets_the_app`, `test_anything_else_is_really_not_found`, passed 2026-11-11), so putting the older build back in `web/dist` keeps every bookmarked address opening. |
| T0274 Confirm a newly installed PWA, a normal browser tab and an existing upgraded installation. | Needs a person | install the PWA fresh, use a normal tab and upgrade an existing installation (checked 2026-11-10). |
| T0275 Resolve all critical data-integrity, audio continuity, bridge atomicity, accessibility, export and privacy blockers. | Needs a person | Needs a person: the screen-reader (T0264), listening (T0267, T0277) and installed-app (T0274) gates have to run before every blocker can be called resolved. No critical data, audio, bridge, export or privacy blocker is known in code (checked 2026-11-11). |
| T0276 Run Windows CI plus browser/audio/a11y gates on release candidate commit. | Needs a person | Needs a person: pick the release candidate commit and run Windows CI plus the browser, audio and accessibility gates on it, with the screen-reader and listening gates done by people (checked 2026-11-11). |
| T0277 Record final human listening evidence and explicitly accepted remaining noncritical limitations. | Needs a person | the owner's own listening evidence and sign-off on remaining noncritical limitations (checked 2026-11-10). |
| T0278 Verify every checklist item has a linked implementing PR and evidence; do not infer completion from docs. | Partly | This file does that, and the ticks on the PR come from it. |
| T0279 Merge/close this tracking PR only after the programme's delivery is actually complete; keep it open otherwise. | Needs a person | the owner merges or closes the tracking PR once delivery is complete (checked 2026-11-10). |
