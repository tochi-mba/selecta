# ADR-0056: My Mixes workspace, safe drafts, restoration and render priority

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 — Core journeys
- **Extends existing decisions:** ADR-0012, ADR-0038
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0056-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Drafts already support autosave, duplicate, rename, delete/restore, queue priorities and playing a saved draft. These are creative projects with a different lifecycle from the currently playing mix; their visual identity should not be collapsed.

## Decision proposed

Establish My Mixes as the permanent home for a distinguished current set, saved drafts and the render line. Reduce per-row control clutter while retaining every action. Separate saved draft data from render/play readiness.

## Experience and frontend architecture

- A current-mix card clearly indicates active playback; draft cards show persistent identity, song count, approximate runtime, save/readiness status and the primary Edit operation. Secondary menus include Rename, Duplicate, Delete, Prioritize and other existing actions.

- Playing a draft must explicitly communicate the active-mix swap. Undo and restoration use stable draft IDs and correct scope, including after reorder or navigation. The render line is described as an audio-preparation queue, not a playback queue.

- Background saves are reported honestly. A saved but unrendered mix cannot be called fully playable merely because edits persisted. Sorting or compact layout must not mutate scheduler priority accidentally.

## Detailed implementation work (all Not started)

1. **S3-0056-01 — Not started.** Design prominent current-mix summary separate from all draft project cards.
2. **S3-0056-02 — Not started.** Move secondary draft actions into accessible menus with labels and non-hover entry.
3. **S3-0056-03 — Not started.** Define draft saved, saving, failed-save, render pending, ready and missing-track states.
4. **S3-0056-04 — Not started.** Preserve create, copy, rename, delete, undo restore, play swap, render priority/order and draft-first editing.
5. **S3-0056-05 — Not started.** Improve queue position explanation and distinguish processing order from music order.
6. **S3-0056-06 — Not started.** Provide scoped Undo after navigation, including multi-operation draft changes.
7. **S3-0056-07 — Not started.** Add task-oriented empty states and long/duplicate-name handling.
8. **S3-0056-08 — Not started.** Validate reload, browser history, concurrent requests and draft deletion during open edit.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Create draft while current plays; reorder draft and receive current request; verify strict isolation.
- Delete/restore while another operation is pending; no wrong-id restoration or lost content.
- Queue priority under storage block or backend restart, repeated activation, save error and slow polling.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep drafts under Mixes browse: less navigation change, but hides ongoing work. Expose all actions inline: accessible in principle but visually overloaded. This destination makes ownership explicit.

## Acceptance and evidence

The user can find, distinguish, edit, prioritize, play, restore and manage projects without confusing them with current playback or analysis jobs.

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
