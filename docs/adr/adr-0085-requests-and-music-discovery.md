# ADR-0085: Clarify Requests, consented bridges and discovery auditions

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 10 Implemented (automated), 0 In progress, 0 need a person only (2026-11-10 reconciliation); 0/10 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 4 - library and discovery
- **Extends:** ADR-0060, ADR-0061, ADR-0069. No inherited task is automatically complete.
- **Dependencies:** ADRs 0080, 0082 and 0083.
- **Checklist:** S31-0085-01 through S31-0085-10 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/{Requests,Links}.tsx`, `web/src/views/Adder.tsx`, `web/src/state/async.ts`, `src/selecta/routes/{song_requests,discover}.py` (contract review). Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Keep asynchronous request scheduling and advanced discoveries transparent. Distinguish suggestion, audition, review, render, consent, queued and playable states. Never imply an unapproved bridge or harmonic match is a finished mix.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0085-01 - Review request search and duplicate/pre-existing choices.** Acceptance: Users understand requested versus already planned/playing songs and can cancel safely. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Requests.test.tsx` ("won't let a song be asked for twice, or one already in the mix", cancel cases) passed. **Needs a person:** owner review for Verified.
2. **S31-0085-02 - Clarify waiting, preparing, ready, inserted, failed and cancelled states.** Acceptance: Status and detail agree with server truth, including late updates and refresh. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Requests.test.tsx`, `RequestsJoining.test.tsx` state cases; `tests/test_request_routes.py`, `tests/test_requests.py` passed. **Needs a person:** owner review for Verified.
3. **S31-0085-03 - Review bridge proposal consent and alternatives.** Acceptance: Before approval, all songs, transitions, reason and whole-route effects are explicit. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `RequestsJoining.test.tsx` ("says they all come together", "shows the best first, how it gets there, and why"); `Requests.test.tsx` ("names the extra song and asks") passed. **Needs a person:** whole-route consent comprehension check.
4. **S31-0085-04 - Verify bridge atomicity and retry/rejection paths.** Acceptance: Nothing joins until all parts are ready and approved; no partial route plays. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `RequestsJoining.test.tsx` ("none of it can play until then"); `Requests.test.tsx` single bridge decision; `tests/test_requests_together.py` passed. **Needs a person:** owner review for Verified.
5. **S31-0085-05 - Test competing requests, cancellation and late poll recovery.** Acceptance: No duplicate song, same-slot assignment, cancelled resurface or misleading success. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/integration.e2e.ts` ("two requests at once", "a cancelled request that's answered late doesn't come back"); `Requests.test.tsx` slow poll passed. **Needs a person:** owner review for Verified.
6. **S31-0085-06 - Review Word connections candidate, preview and rating flow.** Acceptance: User distinguishes discovered phrase from rendered transition and can add the intended pair only. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Links.test.tsx` word-connection cases ("goes in as one thing", "can go in a draft instead") passed. **Needs a person:** comprehension check of phrase versus rendered transition.
7. **S31-0085-07 - Review four-stage harmonic listen and verdict flow.** Acceptance: A/B context, stages, verdict and retry are understandable and no result is claimed beyond the actual audition. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Links.test.tsx` ("plays what it detected in one press", "never calls a requested harmonic stage playing until the media element starts") passed. **Needs a person:** audible audition review.
8. **S31-0085-08 - Verify cross-page and preview audio ownership.** Acceptance: Audition never overlaps main player or silently changes playback intent. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Links.test.tsx` ("pauses the mix when it starts playing", "stopping really stops") passed. **Needs a person:** audible cross-page ownership check.
9. **S31-0085-09 - Review empty/no-match/failed-render and unreadable metadata states.** Acceptance: Clear zero-result, stale-data and partial-readiness explanations without hiding controls. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Requests.test.tsx` ("says when nothing matches"); `Links.test.tsx` ("can't load isn't the same as nothing there") passed. **Needs a person:** owner review for Verified.
10. **S31-0085-10 - Test keyboard/touch accessibility for request drawer and discovery actions.** Acceptance: Search, approval, skip, stop, review and pair insertion work without pointer-only gestures. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("the keyboard alone can request a song, cancel it, and get back to where it was") passed. **Needs a person:** touch check on a real device.

## Required adverse cases and evidence

- No partially inserted bridge, duplicated song or revoked request resurfacing.
- Four-stage harmonic audition outcomes must not be mislabelled proof.
- Asynchronous requests can arrive in unexpected order.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

More explanation at bridge approval is justified by the irreversible live-playback consequences; common one-song requests must remain lightweight.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now also has limited frontend/test changes in other workstreams. This ADR remains Not started; implementation is tracked by task ID in the evidence ledger and no task is Verified.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Partial UI/test or request/Library work on draft PR #25, with no task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 10 Implemented (automated), 0 In progress, 0 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/10 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
