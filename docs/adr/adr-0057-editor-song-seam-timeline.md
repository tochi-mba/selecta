# ADR-0057: Safe timeline editor, insertion, reorder and stable identity

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 — Creation workspaces
- **Extends existing decisions:** ADR-0013, ADR-0015, ADR-0040
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0057-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The current editor interleaves song rows, seam rows and insertion gaps. It already supports playing from a position, moving, locking, deleting, recommendations, render and Undo. Small insertion targets, crowded row controls, native drag behavior on touch and changing seam indices make this a prime candidate for structural redesign.

## Decision proposed

Create a focused three-region editor: mix-scoped header, fluid timeline and context inspector. Preserve the exact song and seam data model but make every action explicit, reversible and stable under concurrent edits. Large mixes must remain usable on keyboard and touch.

## Experience and frontend architecture

- The editor header announces current versus draft scope, revision and readiness. Timeline song and seam rows have different hierarchy, a deliberate drag handle, touch-friendly insert gap, selected state and menus for low-frequency actions. Use stable song occurrences and pair identities rather than indexes alone.

- Clicking a row selects/inspects it; explicit Play controls trigger audio. Move Up/Down and other non-drag options remain visible to assistive technology. Adding songs binds the operation to an insertion anchor plus guarded revision, not a stale array position.

- A 100-song mix is a mandatory performance and keyboard scenario. Profile before adopting virtualization because it can break focus, scrolling and drag accessibility. On conflict, revalidate or reject with a clear recovery path rather than applying to a wrong pair.

## Detailed implementation work (all Not started)

1. **S3-0057-01 — Not started.** Define editor layout, sticky scoped header, selected song/seam visual state and descriptive row hierarchy.
2. **S3-0057-02 — Not started.** Redesign insertion targets with realistic pointer/touch target dimensions and explicit position labels.
3. **S3-0057-03 — Not started.** Provide pointer drag and equivalent single-pointer/non-drag plus keyboard reordering with announced results.
4. **S3-0057-04 — Not started.** Rebuild song picker around recommendations, analysis eligibility, searching and source-independent identities.
5. **S3-0057-05 — Not started.** Preserve lock, remove, insert, play-from-here, render, retry, jump-to-problem and scoped Undo.
6. **S3-0057-06 — Not started.** Connect inspector selection to stable pair identity and prevent stale selection from editing a new pair.
7. **S3-0057-07 — Not started.** Handle request ghost rows and pending bridges without presenting them as playable timeline items.
8. **S3-0057-08 — Not started.** Profile and optimize 100-song timeline without remounting audio or losing focus/scroll position.
9. **S3-0057-09 — Not started.** Add conflict, second-tab, background render, deleted-row and draft/current isolation tests.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Reorder during a request insertion, then Undo in a different draft; reject or correctly reconcile stale x-mix-order.
- Duplicate song occurrences and same-title tracks must retain stable instance identity.
- Keyboard and touch insert/reorder without HTML drag; 100-song scroll and active-preview transitions.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A graphical DAW-style horizontal timeline would look sophisticated but needlessly reengineer a sequential playlist and dramatically worsen touch/accessibility. A refined vertical song/seam timeline preserves the established mental model.

## Acceptance and evidence

All existing edit actions are reachable, recoverable and scoped, including under concurrent updates and 100-track load.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
