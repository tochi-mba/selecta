# ADR-0046: Visual regression, performance, listening and polish release gates

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23)); 1 of 12 tasks ticked (P0141, rollback check including ratings, 2026-11-11); P0132 baseline spec written, baselines not yet generated; P0133, P0135, P0137, P0139, P0140 and P0143 need a person. See the [evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 7 - Integrated verification and release
- **Extends:** [ADR-0001](adr-0001-product-contract-and-parity.md), [ADR-0029](adr-0029-testing-and-quality.md), [ADR-0030](adr-0030-migration-and-release.md); does not silently supersede their behavioural contracts.
- **Dependencies:** Phases 0–6, reviewed evidence and all applicable existing behavioural gates.
- **Checklist:** P0132–P0143 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

The existing ledger records layout tests but no visual regression baseline, and incomplete 100-song Edit/Studio/constrained-CPU profiling and user testing. This programme must not equate documentation, passing axe or render checks with finished design.

## Proposed decision and rationale

Release polish incrementally with behavioural parity, deterministic visual comparisons, realistic performance and manual task/audio checks. Track every remaining issue and distinguish Implemented from Verified.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0132:** Build deterministic visual baselines for every inventory surface/state in both themes and representative widths; control clocks/audio animation and document masks.
2. **P0133:** Review screenshot differences rather than blindly refreshing baselines; include loading, empty, error and recovery states.
3. **P0134:** Run existing applicable frontend/backend/browser/file-length checks without weakening behavioural assertions to accommodate new layouts.
4. **P0135:** Measure realistic large-Library, 100-song Edit and Studio interactions during background rendering on recorded hardware.
5. **P0136:** Set and report responsiveness budgets, using INP <=200ms and CLS <=0.1 as reference targets with methodology; distinguish local lab results from field percentiles.
6. **P0137:** Check no audio interruption or unintended overlap during navigation, preview, edits, requests, recovery and multi-tab takeover using actual audio evidence.
7. **P0138:** Run integrated disconnect/reconnect, stale-response, failed-render, failed-save, missing-source and export-recovery scenarios.
8. **P0139:** Conduct unguided tasks with casual listeners, creators and expert editors; record task success, errors and confusion without inventing results.
9. **P0140:** Resolve P0/P1 blockers and review all P2 visual/detail findings against the state inventory; document any explicitly accepted limitation.
10. **P0141:** Verify incremental rollback preserves music, mixes, drafts, ratings, settings and metadata; no schema or engine change is implicitly authorized by this polish plan.
11. **P0142:** Update each relevant ADR, checklist, evidence record and inherited parity/test mapping with implementing PR and verification links.
12. **P0143:** Publish a release-candidate review with screenshots, CI, accessibility, task and audible evidence; leave unperformed checks unchecked and obtain explicit release disposition.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A single final screenshot review misses failures and race conditions. Re-running all tests after every cosmetic adjustment wastes effort; use focused checks per change and full integrated gates for release candidates.

## Acceptance and status update

Every applicable state is reviewed, required automated and human evidence exists, and no unresolved integrity, accessibility, audio or recovery blocker is disguised as polish completion.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-11 | Accepted | In progress (1/12) | P0141 ticked: `tests/rollback_check.py` against `main` reports nothing lost, ratings included; P0132 spec `web/e2e/polish-p0132-baselines.e2e.ts` written |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
