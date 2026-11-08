# ADR-0052: Truthful asynchronous state, optimistic mutations and recovery

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0005, ADR-0028, ADR-0036
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0052-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The app fetches rendering, analysis, requests, playback and library state asynchronously. Stale results, failed network calls and optimistic UI can easily make planned actions look completed or incorrectly target current versus draft state.

## Decision proposed

Create domain-specific typed view models and a common state contract. Separate idle, loading, refreshing, optimistic-pending, confirmed, failed, offline and retrying; distinguish planned, queued, rendering, playable and fallback audio outcomes.

## Experience and frontend architecture

- The UI can keep existing content visible during background refresh with a conspicuous stale indicator. Optimistic updates remain provisional until a canonical response confirms them; rollback must preserve newer user actions. Request identity and mix revision guard mutations.

- All expensive jobs expose actual stages and real backend counts; fabricated percentages and endless spinners are forbidden. An offline state is not the same as an empty result. Retry must be idempotent where operations are safe, otherwise the client reconciles before sending again.

- Components consume centrally normalized readiness and error models. Every individual state includes its allowable actions and announcement policy; disabled actions explain blockers when useful.

## Detailed implementation work (all Not started)

1. **S3-0052-01 - Not started.** Inventory initial, populated, empty, partial, refreshing, saving, offline, failed, recovered and unavailable states by route and operation.
2. **S3-0052-02 - Not started.** Define typed result discriminants and canonical mapping for analysis, song readiness, seams, requests, drafts and export.
3. **S3-0052-03 - Not started.** Implement request cancellation/ignore-stale policies keyed by resource identity and revision.
4. **S3-0052-04 - Not started.** Standardize optimistic transaction IDs, rollback, idempotency and server reconciliation.
5. **S3-0052-05 - Not started.** Build content-shaped skeletons plus explicit delayed/stalled/retry states that preserve geometry.
6. **S3-0052-06 - Not started.** Provide actionable error boundaries and reconnect behavior without claiming success prematurely.
7. **S3-0052-07 - Not started.** Specify accessible status announcements that do not produce incessant screen-reader chatter.
8. **S3-0052-08 - Not started.** Create tests for server disconnect/restart, partial response, out-of-order messages, double click and missing payload fields.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Simulate responses resolving out of order, stale retries, lost acknowledgements and newer state followed by older polling.
- Assert no fabricated empty state, ready state or success message after failed mutation.
- Compare optimistic and canonical final state under two simultaneous clients and tab switching.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Global loading spinner and generic error toast would reduce implementation but conceal true lifecycle. A full API rewrite is unnecessary; a typed projection over existing contracts is safer.

## Acceptance and evidence

Every server-driven component has an explicit state machine and recovery path; failures and stale responses do not produce false readiness or wrong-resource writes.

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
