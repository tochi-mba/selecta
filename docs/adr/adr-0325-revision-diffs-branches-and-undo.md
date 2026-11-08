# ADR-0325 — Immutable proposal diffs, alternate branches, restore and revision navigation

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Revision. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0219, ADR-0228, ADR-0232, ADR-0237, ADR-0255; statuses and scope unchanged.
- **Source touchpoints:** `web/src/views/Mix.tsx`; `web/src/views/EditorStory.tsx`; `src/selecta/db.py`.

## Context and source evidence boundary

A chat message can refer to an older proposal, and the user may want two alternatives. Existing mix Undo is a different operation from restoring a proposal version. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Compute server-authoritative added/removed/moved/retained and changed seam/constraint diffs between immutable revisions. Provide restore-as-new-revision, branch, compare and safe historical navigation without ever rewriting committed drafts.

## UI/UX, interaction and truth contract

Current proposal pointer remains visible; old cards clearly historical and cannot silently commit; mobile compare remains readable without side-by-side horizontal overflow.

**Negative cases:** Same recording twice, moved song counted as remove+add, revision restored after library changes, two branches approved in different tabs, undo vs draft Undo ambiguity.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-325-01 — Define diff identity algorithm.** **Acceptance:** Use occurrence IDs, directed pair keys and constraints rather than title/position guesses. **Required verification:** Duplicate/move diff property tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-325-02 — Persist immutability and ancestry.** **Acceptance:** Every revision has parent/branch identity, no mutation of historical hash. **Required verification:** Persistence and migration tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-325-03 — Show concise change summary.** **Acceptance:** Added/moved/replaced/preserved and warnings are exact real counts. **Required verification:** Snapshot/UI semantics test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-325-04 — Support detailed comparison.** **Acceptance:** User inspects exact track/transition/constraint before and after. **Required verification:** Desktop/mobile compare task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-325-05 — Restore old revision safely.** **Acceptance:** Restore makes a new revision and revalidates changed source facts. **Required verification:** Old-cache/removed-song tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-325-06 — Branch musical variants.** **Acceptance:** Original remains accessible and independently approvable. **Required verification:** Branch concurrency test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-325-07 — Prevent historical-card commit.** **Acceptance:** Approval from old card is blocked or made explicit by restore/review. **Required verification:** Stale approval E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-325-08 — Distinguish two undo systems.** **Acceptance:** Proposal history actions never call scoped current/draft Undo accidentally. **Required verification:** Cross-route Undo and AT study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Proposed; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
