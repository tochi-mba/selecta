# ADR-0060: Requests, bridge approval and atomic live insertion

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0015, ADR-0028, ADR-0042
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0060-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Users request songs, while the backend must plan placement and may propose bridge tracks. Status includes optimistic submissions, waiting, search, approval, preparation, ghost rows and ready insertion. Simplifying this without preserving atomicity and consent could cause unintended tracks or rough seams.

## Decision proposed

Organize Requests around song intent and next action, with a concise state vocabulary and expandable technical details. Bridge routes require explicit consent and remain atomic. Keep Play it anyway as a clearly labeled risky override.

## Experience and frontend architecture

- Search distinguishes available, duplicate, already-playing/queued and reserved bridge tracks. An optimistic request is visibly pending until confirmation and rolls back on failure. Reconcile polling with stable IDs and revisions.

- A bridge approval sheet shows the requested destination, ordered intermediate songs, prepared status and preview actions, and requires explicit approval or rejection. Partial routes remain unplayable. Canceled or superseded requests cannot reappear from late results.

- Ghost rows in Edit represent planned insertions, grouped by route and visually different from ready playable songs. Placement never uses a stale playhead or contested reservation without guard checks.

## Detailed implementation work (all Not started)

1. **S3-0060-01 - Not started.** Redesign Request search, results, active list and responsive entry point from Listen/player.
2. **S3-0060-02 - Not started.** Define canonical user-facing labels for waiting, finding place, needs approval, preparing, coming up, failure.
3. **S3-0060-03 - Not started.** Preserve optimistic create/confirm/rollback and duplicate prevention with idempotent retry.
4. **S3-0060-04 - Not started.** Create explicit bridge-route consent surface with audio previews and accessible order/relationship.
5. **S3-0060-05 - Not started.** Retain route alternatives, refusal, cancellation and Play it anyway with clear rough-transition warning.
6. **S3-0060-06 - Not started.** Render planned bridge ghost rows in editor without claiming readiness or allowing partial play.
7. **S3-0060-07 - Not started.** Protect cancellation/approval/placement against lost responses, stale poll and concurrent requests.
8. **S3-0060-08 - Not started.** Verify one audio owner across request previews and persistent playback.
9. **S3-0060-09 - Not started.** Add backend contract and E2E race tests for complete atomicity.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Two simultaneous requests compete for location; approval/cancel at same moment; one seam fails during route prep.
- Retry after lost acknowledgement, out-of-order polls and backend restart: no duplicate/canceled insertion.
- User seeks or skips while bridge is preparing; placement must remain safe relative to playhead.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Always force a requested song next: simple UX but violates musical quality. Approve all bridge routes automatically: convenient but breaks user consent. The explicit lifecycle is non-negotiable.

## Acceptance and evidence

The user always knows request state and can safely act; no unapproved, duplicate, canceled or partial route enters audible playback.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
