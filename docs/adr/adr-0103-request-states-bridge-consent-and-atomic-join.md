# ADR-0103: Requests drawer, bridge alternatives, explicit consent and atomic joining

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 7 Discovery
- **Extends, does not automatically supersede:** ADR-0015, ADR-0060, ADR-0085
- **Source surfaces to reconcile:** `web/src/views/Requests.tsx`; `web/src/views/RequestsJoining.test.tsx`; `src/selecta/routes/requests.py`
- **Tasks:** S4-0103-01 through S4-0103-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A request being received, searched, approved, prepared and inserted are different states; the system may choose extra bridge songs and must not insert unapproved extras or partial routes.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use four understandable visible groups—Waiting, Needs your choice, Preparing, Coming up—while retaining all detailed backend states. Present proposed multi-song bridges as entire routes with explicit consent and atomic insertion.

## Experience, frontend and interaction specification

- Top of drawer centers song search; action-required requests appear before passive work.
- No fabricated ETA or guarantee of strict FIFO if planner cannot assure it.
- Bridge proposal shows requested destination, all extra songs, why route is needed, preview state and Accept/Decline.
- Play it anyway remains available with understandable rough-transition warning and exact semantics.

## Detailed implementation work — all Not started

1. **S4-0103-01 — Rebuild request search and matching results with song identity.** Acceptance: No wrong duplicate-title selection or inaccessible result. Required verification: Rapid search, Unicode, duplicate ID and keyboard tests. **Implementation: Not started; Verified: No.**
2. **S4-0103-02 — Map all backend request states to truthful user-facing groups.** Acceptance: Waiting/approval/preparing/ready are not conflated. Required verification: State transition matrix including stalled/offline. **Implementation: Not started; Verified: No.**
3. **S4-0103-03 — Prioritize decisions needing human action within drawer.** Acceptance: Pending approvals cannot be buried in long list. Required verification: 50+ requests scrolling and focus tests. **Implementation: Not started; Verified: No.**
4. **S4-0103-04 — Design entire bridge path and extra-song consent.** Acceptance: Every inserted extra track is explicitly approved. Required verification: Proposed/declined/approved route E2E. **Implementation: Not started; Verified: No.**
5. **S4-0103-05 — Preserve alternate bridge finder and preview.** Acceptance: Selection controls don't imply a path is already inserted. Required verification: Unavailable preview, missing bridge and selection race tests. **Implementation: Not started; Verified: No.**
6. **S4-0103-06 — Preserve Play it anyway as deliberate override.** Acceptance: Warning clear and backend override behaves as before. Required verification: Rough transition and failure tests. **Implementation: Not started; Verified: No.**
7. **S4-0103-07 — Represent uncommitted requests as provisional editor rows.** Acceptance: Ghost rows never claim they already play or render. Required verification: Timeline request join/reorder tests. **Implementation: Not started; Verified: No.**
8. **S4-0103-08 — Guarantee atomic insertion and operation idempotency.** Acceptance: Whole approved route inserts once or not at all. Required verification: Partial render fail/retry/two-tab duplicate tests. **Implementation: Not started; Verified: No.**
9. **S4-0103-09 — Harden cancel/approval and late polling reconciliation.** Acceptance: Cancelled request cannot reappear due to older result. Required verification: Cancellation vs join and out-of-order poll tests. **Implementation: Not started; Verified: No.**
10. **S4-0103-10 — Explain request dependencies and no-mix waiting.** Acceptance: Request order never falsely promised when music routing varies. Required verification: Multi-request/dependency/empty-mix scenarios. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- One of several bridge transitions fails; insert none of the route.
- User cancels while backend joined; UI distinguishes already-inserted state.
- Server accepts approval but response times out; retry must be idempotent.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Simpler visible status categories require preserving detailed drill-down so advanced users can diagnose a stuck request.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0103 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
