# ADR-0269 - Cross-route action hierarchy and advanced disclosure placement

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 0/8 Implemented; 0/8 In progress; 8/8 Not started.
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta final polish (FP), 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority/phase:** P1 / Cross-route attention.
- **Owner:** Unassigned.
- **Related owners:** ADR-0204, ADR-0208, ADR-0216, ADR-0219, ADR-0249, ADR-0256, ADR-0259; their historical statuses remain unchanged.
- **Existing source touchpoints:** `web/src/shell/Shell.tsx`; `web/src/views/Now.tsx`; `web/src/views/MixSetup.tsx`; `web/src/views/SeamInspector.tsx`; `web/src/views/Workshop.tsx`; `web/src/ui/controls.tsx`.

## Context and source-evidence boundary

Individual pages already implement primary actions, menus, dialogs, details and a command palette. Most local design decisions are owned by older ADRs, but there is no reviewed cross-route registry assigning existing actions to foreground, contextual or advanced tiers in each operating state.

A planning or source observation is not proof of a user problem. Cross-check exact existing SF/GP tasks and implementation first; no missing-feature inference.

## New delta versus earlier ADRs

A single cross-route *decision and review artifact* to prevent inconsistent placement when individual pages are polished; do not invent additional navigation or hide professional features behind shortcuts.

## Proposed decision and alternatives

For each route/state record one dominant task or an explicitly justified primary pair, contextual next actions, and labeled advanced disclosure. Preserve ordinary non-shortcut access to every expert action and clear consequences for destructive/consented operations.

**Alternative:** Keep existing layout if direct research disproves the problem; do not reimplement existing navigation, accessibility primitives or current features.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **FP-0269-01 - Enumerate route-state actions.** **Acceptance:** List the exact existing command, state availability, frequency, cost/risk and current location for every primary surface. **Required verification:** Route-state-action register linked to current JSX and menus **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **FP-0269-02 - Assign three contextual tiers.** **Acceptance:** Classify actions as primary, contextual or advanced with written exceptions for emergency/error/destructive controls. **Required verification:** Signed tier rubric with rationale and links to older ADRs **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **FP-0269-03 - Set one clearly dominant next action.** **Acceptance:** Each ordinary screen/state has an obvious primary next step, except justified equally important actions. **Required verification:** Five-second scan and keyboard task evidence **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **FP-0269-04 - Keep advanced actions discoverable.** **Acceptance:** Every professional action is accessible via clear named disclosure or direct UI; no hover/shortcut-only dependency. **Required verification:** Novice and experienced control-discovery study **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **FP-0269-05 - Use consequence-specific labels.** **Acceptance:** Play/Preview, Shape, Save draft, Apply, Approve bridge and Export communicate distinct actual effects and scopes. **Required verification:** Action-copy inventory and truth assertions **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **FP-0269-06 - Preserve route, focus, audio and revision.** **Acceptance:** Disclosure cannot silently change current/draft scope, selected seam, player, request or pending edit state. **Required verification:** Navigation/focus/player concurrency regressions **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **FP-0269-07 - Define responsive action order.** **Acceptance:** At 320px and shallow landscape, core actions remain visible while lower tiers wrap/disclose without trapping focus. **Required verification:** Responsive paired-theme and zoom checks **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **FP-0269-08 - Independently approve no-loss simplification.** **Acceptance:** Measure primary-task recognition and expert action discovery, rejecting any design that makes a supported workflow unfindable. **Required verification:** Reviewer-signed task outcome and full feature parity report **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Safety, negatives and evidence requirements

**Area-specific negatives:** first run; zero-ready library; no mix; active playback; selected seam; dirty draft; Studio audition; pending request; export error; palette disabled; mobile nav; focus after disclosure close.

**Common cases:** Light/Dark/System, 320–2560px and 400% zoom, short landscape, forced-colours, reduced motion, duplicate/long/RTL/Unicode metadata, loading/stale/offline/failed/cancel, keyboard/touch/NVDA and real audio where relevant.

**Preservation:** Original audio unchanged; one player and intentional Pause; exact song and seam occurrence, current/draft revisions and scoped Undo; consented atomic bridges; eight-lane 8–64-cell Studio; true Library readiness and LRCLIB disclosure; unbiased studies; frozen-revision decodable FLAC. No SaaS or telemetry.

**Proof:** Cross-route action map and uncoached novice/DJ discoverability tests with keyboard and touch parity. Record independent reviewer name/date, exact implementing source/test SHA, platform, task counts, observed failures and rollback. CI screenshots alone never confer Verified.

## Status governance

**Decision** Proposed → Accepted/Rejected/Superseded only with dated owner approval and reason. **Implementation** Not started → In progress → Implemented requires linked source PR/SHA. **Verified** No → Yes requires separate named human/audio/AT/visual evidence. This docs-only PR does not count as an implementing PR, and does not update any previous programme ledger.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Verification](selecta-final-polish-verification-matrix.md).
