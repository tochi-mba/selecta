# ADR-0060: Requests, bridge approval and atomic live insertion

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 9 of 9 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0015, ADR-0028, ADR-0042
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Users request songs, while the backend must plan placement and may propose bridge tracks. Status includes optimistic submissions, waiting, search, approval, preparation, ghost rows and ready insertion. Simplifying this without preserving atomicity and consent could cause unintended tracks or rough seams.

## Decision proposed

Organize Requests around song intent and next action, with a concise state vocabulary and expandable technical details. Bridge routes require explicit consent and remain atomic. Keep Play it anyway as a clearly labeled risky override.

## Experience and frontend architecture

- Search distinguishes available, duplicate, already-playing/queued and reserved bridge tracks. An optimistic request is visibly pending until confirmation and rolls back on failure. Reconcile polling with stable IDs and revisions.

- A bridge approval sheet shows the requested destination, ordered intermediate songs, prepared status and preview actions, and requires explicit approval or rejection. Partial routes remain unplayable. Canceled or superseded requests cannot reappear from late results.

- Ghost rows in Edit represent planned insertions, grouped by route and visually different from ready playable songs. Placement never uses a stale playhead or contested reservation without guard checks.

## Detailed implementation work

1. **S3-0060-01 - Implemented.** Redesign Request search, results, active list and responsive entry point from Listen/player. **Evidence:** web/src/views/Requests.tsx; web/src/shell/Shell.test.tsx 'open from anywhere, and close again' and 'open with R'; web/src/views/Requests.test.tsx 'searches and adds, keeping the results open for more'; web/e2e/finishing.e2e.ts 'the keyboard alone can request a song, cancel it, and get back to where it was' (passed 2026-11-10).
2. **S3-0060-02 - Implemented.** Define canonical user-facing labels for waiting, finding place, needs approval, preparing, coming up, failure. **Evidence:** docs/adr/selecta-3-glossary.md request states; web/src/views/Requests.test.tsx 'says where it will go and how long it will take', 'says when it has to be analysed first', 'is plain about a song it can’t place, rather than saying it’s still analysing' and 'never uses words like handover or cues' (passed 2026-11-10).
3. **S3-0060-03 - Implemented.** Preserve optimistic create/confirm/rollback and duplicate prevention with idempotent retry. **Evidence:** web/src/views/Requests.test.tsx 'a request appears the moment it’s picked, before the server answers', 'takes it back and says so if saving fails' and 'won’t let a song be asked for twice, or one already in the mix'; tests/test_operation_identity.py test_operation_id_deduplicates_only_the_exact_command (passed 2026-11-10).
4. **S3-0060-04 - Implemented.** Create explicit bridge-route consent surface with audio previews and accessible order/relationship. **Evidence:** web/src/views/Requests.test.tsx 'names the extra song and asks', 'every transition can be heard first' and 'saying yes shows at once, and doesn’t need the mix to be playing' (passed 2026-11-10).
5. **S3-0060-05 - Implemented.** Retain route alternatives, refusal, cancellation and Play it anyway with clear rough-transition warning. **Evidence:** web/src/views/Requests.test.tsx 'saying no stops asking and says what happens now', 'needs no confirming and doesn’t touch the mix' (cancel), 'is offered when nothing fits, and goes straight in' and 'puts the request back if it can’t be added' (Play it anyway) (passed 2026-11-10).
6. **S3-0060-06 - Implemented.** Render planned bridge ghost rows in editor without claiming readiness or allowing partial play. **Evidence:** web/src/views/Mix.test.tsx 'show up faded in the timeline at the place they’re going' and 'take over from the transition they’ll replace, which comes back if they’re cancelled' (passed 2026-11-10).
7. **S3-0060-07 - Implemented.** Protect cancellation/approval/placement against lost responses, stale poll and concurrent requests. **Evidence:** web/src/views/Requests.test.tsx 'a slow poll can’t bring back something just cancelled', 'two picks close together both stay, whichever answer comes back first', 'allows only one bridge decision while its server response is pending' and 'sends a changed mind after the first answer, so what they last said is what stands'; web/e2e/integration.e2e.ts 'a cancelled request that’s answered late doesn’t come back' (passed 2026-11-10).
8. **S3-0060-08 - Implemented.** Verify one audio owner across request previews and persistent playback. **Evidence:** web/src/views/Requests.test.tsx 'one that’s ready plays straight away and pauses the mix' and 'stops when pressed again'; web/src/audio/focus.test.tsx 'two can’t play at once' and 'a new preview stops the old one, and the mix waits for the last of them' (passed 2026-11-10).
9. **S3-0060-09 - Implemented.** Add backend contract and E2E race tests for complete atomicity. **Evidence:** web/e2e/integration.e2e.ts 'two requests at once: no song goes in twice and no two share a spot' and 'a cancelled request that’s answered late doesn’t come back'; tests/test_requests_together.py, tests/test_request_routes.py and tests/test_requests.py (whole files) (passed 2026-11-10).

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
| 2026-11-10 | Accepted | In progress (9/9) | Task-by-task evidence on each item; 0 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
