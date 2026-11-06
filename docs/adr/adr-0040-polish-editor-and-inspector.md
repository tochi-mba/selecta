# ADR-0040: Precise editing timeline and context-preserving transition inspector

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 4 — Editing and Stem Studio
- **Extends:** [ADR-0005](adr-0005-domain-state-mutations.md), [ADR-0013](adr-0013-edit-timeline.md), [ADR-0014](adr-0014-seam-inspector.md), [ADR-0022](adr-0022-flac-export.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0070–P0079 in [polish implementation checklist](polish-implementation-checklist.md).

> Documentation only. Merging this proposal neither accepts the decision nor starts implementation. All runtime tasks remain unchecked.

## Context and evidence boundary

Edit already has a current/draft switcher, song actions, seam rows and a responsive inspector. Dense repeated actions and requested-versus-rendered state need coherent visual treatment, not a rewrite of mutation guards.

## Proposed decision and rationale

Keep scope and selected transition apparent. Use a stable track/transition rhythm, group secondary actions and retain context when the inspector becomes a sheet. Show intent, preparation and actual playable outcome separately.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0070:** Keep mix name, current/draft status, selection and save/undo context visible throughout editing.
2. **P0071:** Standardize song-row and transition-connector rhythm, alignment, readiness and now-playing/selected treatments.
3. **P0072:** Group secondary song and mix actions while preserving insertion, reorder, remove, hold and existing expert operations.
4. **P0073:** Provide keyboard alternatives and visible results for reordering; preserve selection after insert/remove/undo.
5. **P0074:** Keep the selected song pair and position understandable in desktop inspector and narrow-screen sheet layouts.
6. **P0075:** Present requested move, queued/rendering state, fallback and actual playable result without conflating them.
7. **P0076:** Polish cue, length and unavailable-move controls with reasons, units, error recovery and stable focus.
8. **P0077:** Prevent stale preview results or capability responses from presenting the wrong pair; explicitly surface failed loading.
9. **P0078:** Verify current/draft switching, deletion in another tab, stale edits, renderer completion races and undo scope.
10. **P0079:** Review 100-song timelines with long metadata and open inspectors while playback and rendering continue.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A full DAW timeline would substantially expand interaction and rendering scope. Hiding details outright would weaken expert editing; refine the existing arrangement and inspector model.

## Acceptance and status update

Every edit has an unmistakable target, selection remains stable, and what will actually play is distinguishable from what the user requested.

Decision status remains Proposed until explicitly accepted or rejected. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. This documentation PR cannot satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only proposal; no runtime verification claimed |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
