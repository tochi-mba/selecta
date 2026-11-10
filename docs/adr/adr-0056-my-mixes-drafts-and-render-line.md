# ADR-0056: My Mixes workspace, safe drafts, restoration and render priority

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0012, ADR-0038
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Drafts already support autosave, duplicate, rename, delete/restore, queue priorities and playing a saved draft. These are creative projects with a different lifecycle from the currently playing mix; their visual identity should not be collapsed.

## Decision proposed

Establish My Mixes as the permanent home for a distinguished current set, saved drafts and the render line. Reduce per-row control clutter while retaining every action. Separate saved draft data from render/play readiness.

## Experience and frontend architecture

- A current-mix card clearly indicates active playback; draft cards show persistent identity, song count, approximate runtime, save/readiness status and the primary Edit operation. Secondary menus include Rename, Duplicate, Delete, Prioritize and other existing actions.

- Playing a draft must explicitly communicate the active-mix swap. Undo and restoration use stable draft IDs and correct scope, including after reorder or navigation. The render line is described as an audio-preparation queue, not a playback queue.

- Background saves are reported honestly. A saved but unrendered mix cannot be called fully playable merely because edits persisted. Sorting or compact layout must not mutate scheduler priority accidentally.

## Detailed implementation work

1. **S3-0056-01 - Implemented.** Design prominent current-mix summary separate from all draft project cards. **Evidence:** web/src/views/CurrentMix.test.tsx 'tracks the exact returned song order without adding an audio action'; web/src/views/Drafts.test.tsx 'plays, and opens for editing, from the list' (passed 2026-11-10).
2. **S3-0056-02 - Implemented.** Move secondary draft actions into accessible menus with labels and non-hover entry. **Evidence:** Menu with named items in web/src/views/Drafts.tsx; web/src/views/Drafts.test.tsx 'confirms before deleting, preserves the draft on cancel and supports Undo' and 'copies a draft'; web/src/ui/controls.test.tsx 'opens, moves with the arrow keys, and closes with Escape, back on its button' (passed 2026-11-10).
3. **S3-0056-03 - Implemented.** Define draft saved, saving, failed-save, render pending, ready and missing-track states. **Evidence:** web/src/views/Drafts.test.tsx 'says where each draft has got to', 'is honest about seams that could not be made', 'says when a song has left the library' and 'keeps the delete confirmation and error visible when the server rejects the deletion' (passed 2026-11-10).
4. **S3-0056-04 - Implemented.** Preserve create, copy, rename, delete, undo restore, play swap, render priority/order and draft-first editing. **Evidence:** web/src/views/Drafts.test.tsx 'invites you to start one when there are none, and starts it in one press', 'copies a draft', 'saves on Enter and says what name it ended up with', 'confirms before deleting, preserves the draft on cancel and supports Undo' and 'prioritizing puts it in line and says when it will start'; web/src/App.test.tsx 'playing one goes to Listen, and keeps what was playing in the drafts'; web/e2e/flows.e2e.ts 'drafts: make one, name it, fill it, and it stays apart from the current mix' (passed 2026-11-10).
5. **S3-0056-05 - Implemented.** Improve queue position explanation and distinguish processing order from music order. **Evidence:** render-line copy in web/src/views/Drafts.tsx ('doesn’t change what’s playing or the order of songs in any mix'); web/src/views/Drafts.test.tsx 'prioritizing puts it in line and says when it will start', 'can move through the line, but not past the ends' and 'quotes how long a draft would take before it is prioritized' (passed 2026-11-10).
6. **S3-0056-06 - Implemented.** Provide scoped Undo after navigation, including multi-operation draft changes. **Evidence:** web/src/shell/Shell.test.tsx 'undoes the mix it was about, even after moving to another page'; web/e2e/integration.e2e.ts 'editing a draft while the current mix plays: neither touches the other, and Undo knows which is which' (passed 2026-11-10).
7. **S3-0056-07 - Implemented.** Add task-oriented empty states and long/duplicate-name handling. **Evidence:** web/src/views/Drafts.test.tsx 'invites you to start one when there are none, and starts it in one press', 'saves on Enter and says what name it ended up with' and 'renders a bounded first page and reveals more without losing exact identities' (passed 2026-11-10).
8. **S3-0056-08 - Implemented.** Validate reload, browser history, concurrent requests and draft deletion during open edit. **Evidence:** web/src/App.test.tsx 'opens from the list without touching the current mix, and stays open after a reload'; web/e2e/flows.e2e.ts 'a draft that’s been deleted is explained, and never quietly swapped for another mix'; web/src/views/Drafts.test.tsx 'serializes competing render-line changes in the order the listener made them' (passed 2026-11-10).

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
| 2026-11-10 | Accepted | In progress (8/8) | Task-by-task evidence on each item; 0 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
