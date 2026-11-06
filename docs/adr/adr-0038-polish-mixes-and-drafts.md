# ADR-0038: Mix browsing, creation defaults and unmistakable draft scope

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23))
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 3 — Core listening, mixes and requests
- **Extends:** [ADR-0010](adr-0010-mix-discovery.md), [ADR-0011](adr-0011-steering-and-energy.md), [ADR-0012](adr-0012-drafts-and-queue.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0052–P0060 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Mixes already offers a recommendation, grouped cards, duration choices, global customization and drafts. Multiple actions and mix replacement need a clearer visual hierarchy while preserving their different effects.

## Proposed decision and rationale

Give the recommended mix one dominant action; progressively disclose advanced defaults. Make Play now, Edit and Save as draft distinct, and show current/draft identity and replacement consequences at the decision point.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0052:** Refine the recommendation hero, duration choices and Customize hierarchy without hiding existing mix choices.
2. **P0053:** Standardize card typography, metadata, action order and unavailable-state explanations across all groups.
3. **P0054:** Differentiate Play now, Edit and Save as draft and put the effect on active playback beside replacement actions.
4. **P0055:** Keep current mix and saved drafts visually distinct, including paused, empty, rendering, ready, failed and unavailable states.
5. **P0056:** Make customization scope explicit: persistent defaults affect new mixes, not existing mixes.
6. **P0057:** Label requested versus achieved energy with a meaningful shared interpretation; audit normalization before claiming curves are directly comparable.
7. **P0058:** Polish destination search loading/no-results/failure/selection states and distinguish no ready match from request failure.
8. **P0059:** Standardize draft rename/copy/delete/prioritize/reorder feedback and distinguish rendering priority from playback order.
9. **P0060:** Verify switching and building while audio plays, failed builds, stale responses, undo and long mix names.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Removing draft or customization actions simplifies the screen by sacrificing capability. Repeated equal-weight buttons preserve capability but make consequences harder to scan.

## Acceptance and status update

Users can create, save and edit another mix without accidentally replacing playback or confusing persistent defaults with current-mix edits.

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
