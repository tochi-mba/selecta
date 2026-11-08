# ADR-0041: Readable Stem Studio grid, audition ownership and explicit commit state

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23))
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 4 - Editing and Stem Studio
- **Extends:** [ADR-0007](adr-0007-audio-focus-ownership.md), [ADR-0016](adr-0016-stem-studio.md), [ADR-0024](adr-0024-responsive-workspaces.md), [ADR-0028](adr-0028-recovery-and-multitab.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0080–P0088 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Studio has lane toggles, solo audition, automatic arrangement, local restoration and a commit action labelled Use this. Grid keyboard handling already exists; the polish must preserve it and make focus, playback and unsaved work distinguishable.

## Proposed decision and rationale

Treat Studio as a focused creative workspace with stable lane/bar labels, distinct cell/focus/playhead states and explicit audition/commit lifecycle. Keep unsaved work recoverable and main-player ownership understandable.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0080:** Define song, lane and bar-label hierarchy and stable labels during scrolling or lane navigation.
2. **P0081:** Differentiate enabled cells, keyboard focus, solo lanes, selection and playhead without colour alone.
3. **P0082:** Polish stem-preparing/loading/ready/unavailable/failed states with truthful estimates and retry paths.
4. **P0083:** Explain preview audio ownership and verify main-player pause/resume behaviour on play, stop, navigation and failure.
5. **P0084:** Separate preview, arrange, fine-tune, restore, reset and commit actions visually and verbally.
6. **P0085:** Show dirty/saving/saved/failed/restored state; name the exact transition affected by commit.
7. **P0086:** Preserve local work after failed saving and define close/reopen/reset behaviour without silent data loss.
8. **P0087:** Verify every grid cell and solo control with keyboard and touch at narrow widths; do not shrink below usable targets.
9. **P0088:** Exercise real-stem audition through navigation, exact-pair commit and render-failure recovery; record audible evidence separately from UI tests.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Simply shrinking the grid on narrow screens preserves pixels but not usability. A complete sequencer redesign adds unnecessary scope; adapt the existing grid with stable labels and reachable controls.

## Acceptance and status update

Users can identify every lane/cell, know which audio owns playback, and distinguish local experiments from committed transition changes.

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
