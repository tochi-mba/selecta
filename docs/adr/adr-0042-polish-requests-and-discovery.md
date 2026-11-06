# ADR-0042: Understandable requests, explicit bridge consent and auditionable discovery

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23))
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 3 — Core listening, mixes and requests (Discover integration also lands in phase 5)
- **Extends:** [ADR-0015](adr-0015-requests-and-bridges.md), [ADR-0019](adr-0019-discover-words-and-harmony.md), [ADR-0027](adr-0027-explanations-and-feedback.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0089–P0099 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Requests exposes placement and bridge workflows, and Discover offers word pairs and staged harmonic auditions. These must share clear status language while retaining atomic insertion, feedback history and distinct preview audio ownership.

## Proposed decision and rationale

Present request progress as a truthful sequence and bridge consent as an explicit song sequence. Make discovery candidates, prepared audio and reviewed results distinct, and make insertion destination unambiguous.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0089:** Standardize requested/finding placement/preparing/scheduled/played/cancelled/failed labels across Requests, Listen and Edit.
2. **P0090:** Show planned insertion location when known and separate waiting, unavailable placement and actual failure.
3. **P0091:** Display bridge song sequence and added-track count before explicit approval; preserve all-or-nothing joining.
4. **P0092:** Polish request search, duplicate prevention, cancellation, retry, stale placement and no-match states.
5. **P0093:** Design word-pair cards around the connection and audio result with coherent rating and failed-render recovery.
6. **P0094:** Distinguish harmonic initial loading from no candidates, and show current audition stage and preparation failure.
7. **P0095:** Make audition playback rejection visible and recoverable; preserve one-audio-owner behaviour and return from previews.
8. **P0096:** Keep candidate/reviewed/prepared states distinct and preserve Yes/No/Skip, revisiting and feedback history.
9. **P0097:** Show current versus named-draft insertion destinations and preserve atomic pair insertion.
10. **P0098:** Verify competing requests, bridge rejection, moving playhead, stale cancellation and duplicate-song races.
11. **P0099:** Verify discovery background refresh, unavailable cues, rapid stage switches and destination changes without losing context.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A generic queue badge hides blocked preparation and bridge decisions. Automatically accepting bridges reduces clicks but violates user intent; preserve explicit consent and show its consequences.

## Acceptance and status update

Users understand what is pending, what they have actually heard, and exactly which songs and destination their approval affects.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
