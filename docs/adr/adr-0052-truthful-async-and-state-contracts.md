# ADR-0052: Truthful asynchronous state, optimistic mutations and recovery

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0005, ADR-0028, ADR-0036
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The app fetches rendering, analysis, requests, playback and library state asynchronously. Stale results, failed network calls and optimistic UI can easily make planned actions look completed or incorrectly target current versus draft state.

## Decision proposed

Create domain-specific typed view models and a common state contract. Separate idle, loading, refreshing, optimistic-pending, confirmed, failed, offline and retrying; distinguish planned, queued, rendering, playable and fallback audio outcomes.

## Experience and frontend architecture

- The UI can keep existing content visible during background refresh with a conspicuous stale indicator. Optimistic updates remain provisional until a canonical response confirms them; rollback must preserve newer user actions. Request identity and mix revision guard mutations.

- All expensive jobs expose actual stages and real backend counts; fabricated percentages and endless spinners are forbidden. An offline state is not the same as an empty result. Retry must be idempotent where operations are safe, otherwise the client reconciles before sending again.

- Components consume centrally normalized readiness and error models. Every individual state includes its allowable actions and announcement policy; disabled actions explain blockers when useful.

## Detailed implementation work

1. **S3-0052-01 - Implemented.** Inventory initial, populated, empty, partial, refreshing, saving, offline, failed, recovered and unavailable states by route and operation. **Evidence:** docs/adr/selecta-3-baseline.md 'States by surface' (first load, empty, partial, refreshing, failed, server gone, recovered per surface); web/src/shell/mpSurfaceInventory.test.ts 'every entry names an owner that exists, a known fixture and an honest state denominator' (passed 2026-11-10).
2. **S3-0052-02 - Implemented.** Define typed result discriminants and canonical mapping for analysis, song readiness, seams, requests, drafts and export. **Evidence:** web/src/state/readiness.ts, web/src/state/jobs.ts and web/src/ui/seam.ts; web/src/state/readiness.test.ts 'does not call a cached but cut-off seam ready for a continuous mix' and 'shows failures before pending queue or rendering states'; web/src/state/jobs.test.ts 'never crashes the app for an incomplete status from a different server version' (passed 2026-11-10).
3. **S3-0052-03 - Implemented.** Implement request cancellation/ignore-stale policies keyed by resource identity and revision. **Evidence:** web/src/state/async.ts; web/src/state/async.test.tsx 'ignores an old response that completes after a newer request' and 'never shows the previous key after switching, even before effects finish'; web/src/views/Library.test.tsx 'only the newest search counts, however the answers arrive'; web/src/views/Mixes.test.tsx 'ignores an older answer that arrives after the newer search, and can be cleared' (passed 2026-11-10).
4. **S3-0052-04 - Implemented.** Standardize optimistic transaction IDs, rollback, idempotency and server reconciliation. **Evidence:** x-operation-id and x-mix-order guards; tests/test_operation_identity.py test_operation_id_deduplicates_only_the_exact_command; web/src/views/Requests.test.tsx 'a request appears the moment it’s picked, before the server answers', 'a pick that fails only takes itself back' and 'a slow poll can’t bring back something just cancelled'; web/src/views/Drafts.test.tsx 'does not let an older, delayed refresh undo a confirmed render-line change' (passed 2026-11-10).
5. **S3-0052-05 - Implemented.** Build content-shaped skeletons plus explicit delayed/stalled/retry states that preserve geometry. **Evidence:** web/src/ui/Skeleton.tsx; web/e2e/finishing.e2e.ts 'pages hold their shape while they load, even when every answer is slow' (passed 2026-11-10).
6. **S3-0052-06 - Implemented.** Provide actionable error boundaries and reconnect behavior without claiming success prematurely. **Evidence:** web/e2e/flows.e2e.ts 'it says so, keeps what’s on screen, and recovers by itself' and 'a change that couldn’t be sent says so, and nothing pretends it happened'; web/src/shell/Shell.test.tsx 'says so across the top, and what’s on screen stays' (passed 2026-11-10).
7. **S3-0052-07 - Implemented.** Specify accessible status announcements that do not produce incessant screen-reader chatter. **Evidence:** web/e2e/finishing.e2e.ts 'playing doesn’t flood a screen reader: the song is said once, and the clock never is'; web/src/ui/controls.test.tsx 'problems are announced as problems' (passed 2026-11-10).
8. **S3-0052-08 - Implemented.** Create tests for server disconnect/restart, partial response, out-of-order messages, double click and missing payload fields. **Evidence:** web/e2e/flows.e2e.ts 'it says so, keeps what’s on screen, and recovers by itself'; web/src/state/jobs.test.ts 'never crashes the app for an incomplete status from a different server version'; web/src/views/Mixes.test.tsx 'does not misreport zero mix-ready songs when an older server omits that count'; web/src/state/async.test.tsx 'ignores an old response that completes after a newer request'; web/src/ui/controls.test.tsx 'can’t be pressed twice while it’s going' (passed 2026-11-10).

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
| 2026-11-10 | Accepted | In progress (8/8) | Task-by-task evidence on each item; 0 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
