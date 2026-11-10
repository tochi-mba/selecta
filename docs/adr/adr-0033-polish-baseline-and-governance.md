# ADR-0033: Polish baseline, complete state inventory and evidence governance

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress: 5/10 tasks Implemented with evidence on 2026-11-10 (P0001, P0002, P0003, P0006, P0008); P0004 and P0010 need a person; P0005, P0007 and P0009 open. See [the polish evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 0 - Baseline and scope
- **Extends:** [ADR-0001](adr-0001-product-contract-and-parity.md), [ADR-0029](adr-0029-testing-and-quality.md), [ADR-0030](adr-0030-migration-and-release.md); does not silently supersede their behavioural contracts.
- **Dependencies:** None. Capture the baseline before changes.
- **Checklist:** P0001–P0010 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

The previous programme has shipped substantial code, while its checklist and evidence still contain open and partially verified work. This review inspected source and documentation at fe785ec; browser preview attachment failed. No pixel-level or audible verification was performed.

## Proposed decision and rationale

Create a separate polish programme with stable P-prefixed tasks, a captured baseline and per-task evidence. Preserve the historical T-prefixed checklist. Reconcile outstanding work explicitly rather than restarting it or treating old completion marks as current visual proof.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0001:** Pin the full baseline commit and record supported browser, OS, installed-app and device assumptions; distinguish source inspection from rendered and audible evidence.
2. **P0002:** Inventory every route, subview, overlay and shared component, including first launch, missing routes, missing drafts, multi-tab takeover and reconnect.
3. **P0003:** Record applicable initial/loading/populated/empty/partial/refreshing/saving/success/failed/offline/unavailable/recovery states for each surface; explain every not-applicable entry.
4. **P0004:** Capture deterministic baseline screenshots in dark and light themes with long, missing, duplicate and mixed-direction metadata; keep private song data out of published fixtures.
5. **P0005:** Map existing feature-parity rows and unfinished T tasks to new P tasks; retain original task IDs and evidence, and identify inherited work without double-counting completion.
6. **P0006:** Write casual-listener, creator and expert-editor task scripts, including desired outcomes and observable errors.
7. **P0007:** Classify findings as P0 integrity/access blockers, P1 task/recovery problems or P2 consistency/detail defects; give each a location, impact and acceptance check.
8. **P0008:** Record decision acceptance separately from implementation progress; keep this planning PR and every runtime task Not started until implementation work exists.
9. **P0009:** Create an evidence entry for each task when work begins, including implementation PR, commit, test/capture and remaining manual checks; partial tasks remain unchecked.
10. **P0010:** Confirm this programme preserves source music, drafts, ratings, current/draft isolation, audio ownership, bridge consent, FLAC correctness and localhost boundaries.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Reusing the old tracker would obscure which work is new and which is inherited. A fresh rewrite would discard working behaviour. An additive, traceable polish programme costs some documentation effort but keeps scope and evidence honest.

## Acceptance and status update

A reviewer can locate every existing capability and meaningful state in the inventory, trace inherited work, and distinguish planned work from verified behaviour.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-10 | Accepted | In progress (5/10) | Reconciled against current code; P0001, P0002, P0003, P0006, P0008 ticked with tests run that day; independent verification still pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
