# ADR-0267 — Contextual Library selection-mode presentation

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/8); In progress 0/8; Implemented 0/8.
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta final polish FP, 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority/phase:** P0 / Library browsing hierarchy.
- **Owner:** Unassigned.
- **Existing primary owners:** ADR-0226, ADR-0227, ADR-0232, ADR-0258; historical states unchanged.
- **Source touchpoints:** `web/src/views/Library.tsx`; `web/src/styles/operations.css`; `src/selecta/routes/library.py`; `web/src/views/Library.test.tsx`.

## Context and evidence boundary

The current Library has exact stable-ID multi-selection, an existing guarded /library/batch endpoint and a clear selection count. Its bulk action area is mounted whenever loaded rows exist even with zero selected. This can draw attention away from routine listening and browsing. GP-0258 owns backend batch safety; this decision covers only disclosure placement.

This source-derived gap is a hypothesis, not independently reproduced UI, accessibility, audio or research proof. Already implemented capabilities must not be counted as missing.

## Novel delta and proposed decision

**Additive acceptance:** A measured zero-selection **presentation and focus** contract, not a proposal to implement missing batch actions or to change transaction semantics.

**Decision:** Keep a discoverable selection affordance in ordinary browsing, but reveal the multi-action toolbar only when at least one recording is intentionally selected. Return calmly to browse at zero selected, without losing scope, exact ID safety or keyboard access.

**Alternatives:** Keep current presentation if research disproves the problem; refine existing components only, not a broad redesign.

## Implementation checklist — 0/8 Implemented, 0/8 independently Verified

1. **FP-0267-01 — Measure current empty-selection clutter.** **Acceptance:** Capture toolbar content and visual competition with no selected rows on list and cards for novice and power tasks. **Required verification:** Existing screenshot fixtures and timed before baseline **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **FP-0267-02 — Make selection entry discoverable.** **Acceptance:** A clearly named selection action or checkbox remains obvious at zero selected without exposing all disabled batch buttons. **Required verification:** 5-second discovery and keyboard entry task **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **FP-0267-03 — Reveal tools only for a real selection.** **Acceptance:** The full action rail is absent at zero, appears for a verified nonzero selected-ID count, and returns to compact mode when cleared. **Required verification:** UI tests for selection counts 0/1/200 **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **FP-0267-04 — Communicate loaded-only scope.** **Acceptance:** Tool labels state exactly how many loaded results are selected (limit 200); never imply whole filtered query was selected. **Required verification:** Paged-result/20k screen-reader and visual text test **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **FP-0267-05 — Provide safe clear and focus return.** **Acceptance:** Clear selection is reachable; disappearing toolbar does not strand keyboard focus or affect any music records. **Required verification:** Focus-return and clear-selection E2E **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **FP-0267-06 — Invalidate stale selection atomically.** **Acceptance:** Change of query/filter/sort or relevant result identity clears toolbar and does not attach old IDs to new rows. **Required verification:** Concurrent search and URL navigation race tests **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **FP-0267-07 — Retain batch safeguards and errors.** **Acceptance:** Existing server confirmation, stable IDs, never-touch-original-audio rule and true per-item error/reversal semantics remain intact. **Required verification:** Batch endpoint tests cross-linked to GP-0258 **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **FP-0267-08 — Validate benefit without action loss.** **Acceptance:** Uncoached browsing is less visually noisy and selecting + changing multiple tracks is no less successful. **Required verification:** Novice and expert study, light/dark screenshots, signed review **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Invariants, negatives and evidence

**Area-specific:** zero/one/200 selections, 20k tracks, filter/sort/query changes, paged rows, duplicated titles, stale replies, failed mutation, disabled state, keyboard/AT/touch, card vs list.

**Shared negatives:** light/dark/system, 320–2560px, short landscape, 400% zoom, forced-colours, Still/reduced motion, long/RTL/Unicode or duplicate song metadata, loading/empty/offline/stale/failed states, keyboard, touch, NVDA, real music when relevant.

**Safety:** Original local audio unchanged; one audio owner/intentional Pause; exact song, seam and draft/current revision; scoped Undo; explicit atomic bridge consent; eight Studio lanes and 8–64 cells; truthful Library, LRCLIB disclosures and statuses; neutral A/B studies; frozen-revision decodable FLAC. No new SaaS, cloud music, telemetry, native launcher, unauthorized media or backend rewrite.

**Independent proof:** Matched browse/batch task time and comprehension with state and exact-ID tests. Reviewer name/date/OS/browser/device, exact implementation source SHA, outcome denominators, failing cases and rollback evidence mandatory. Muted synthetic E2E and screenshot candidates are not independent verification.

## Status transitions and references

Proposed → Accepted/Rejected/Superseded requires explicit dated owner rationale; Not started → In progress → Implemented requires exact source/test PR and SHA; Independently Verified requires separately witnessed named evidence. Merging this documentation ADR does **not** change any task status in this or an older programme.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Release gates](selecta-final-polish-release-gates.md).
