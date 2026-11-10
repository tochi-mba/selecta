# ADR-0057: Safe timeline editor, insertion, reorder and stable identity

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 9 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 1 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 - Creation workspaces
- **Extends existing decisions:** ADR-0013, ADR-0015, ADR-0040
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The current editor interleaves song rows, seam rows and insertion gaps. It already supports playing from a position, moving, locking, deleting, recommendations, render and Undo. Small insertion targets, crowded row controls, native drag behavior on touch and changing seam indices make this a prime candidate for structural redesign.

## Decision proposed

Create a focused three-region editor: mix-scoped header, fluid timeline and context inspector. Preserve the exact song and seam data model but make every action explicit, reversible and stable under concurrent edits. Large mixes must remain usable on keyboard and touch.

## Experience and frontend architecture

- The editor header announces current versus draft scope, revision and readiness. Timeline song and seam rows have different hierarchy, a deliberate drag handle, touch-friendly insert gap, selected state and menus for low-frequency actions. Use stable song occurrences and pair identities rather than indexes alone.

- Clicking a row selects/inspects it; explicit Play controls trigger audio. Move Up/Down and other non-drag options remain visible to assistive technology. Adding songs binds the operation to an insertion anchor plus guarded revision, not a stale array position.

- A 100-song mix is a mandatory performance and keyboard scenario. Profile before adopting virtualization because it can break focus, scrolling and drag accessibility. On conflict, revalidate or reject with a clear recovery path rather than applying to a wrong pair.

## Detailed implementation work

1. **S3-0057-01 - Implemented.** Define editor layout, sticky scoped header, selected song/seam visual state and descriptive row hierarchy. **Evidence:** web/src/views/EditorHeader.tsx and web/src/views/Mix.tsx; web/src/views/Mix.test.tsx 'is plainly a draft, and says what’s playing isn’t affected' and 'opens beside the timeline, for the two songs it’s between'; tests/test_selecta3_changes.py test_desktop_inspector_column_allows_the_panel_to_stick_while_scrolling (passed 2026-11-10).
2. **S3-0057-02 - Implemented.** Redesign insertion targets with realistic pointer/touch target dimensions and explicit position labels. **Evidence:** insertion buttons in web/src/views/EditorRows.tsx ('Add a song after X', 'as number N'); web/e2e/s3-editor-targets.e2e.ts 'insertion targets are at least 24px and say where the song goes, at 375' and 'at 1440' (passed 2026-11-10).
3. **S3-0057-03 - Implemented.** Provide pointer drag and equivalent single-pointer/non-drag plus keyboard reordering with announced results. **Evidence:** web/e2e/finishing.e2e.ts 'reordering with the keyboard moves the song, and focus stays on it'; web/e2e/flows.e2e.ts 'editing: move with the buttons, undo it, and remove a song'; web/src/views/Mix.test.tsx 'ignores outside text drops instead of treating blank text as song zero' (passed 2026-11-10).
4. **S3-0057-04 - Implemented.** Rebuild song picker around recommendations, analysis eligibility, searching and source-independent identities. **Evidence:** web/src/views/Adder.tsx; web/src/views/Mix.test.tsx 'shows recommendations first, then searches in order of what fits', 'puts a song that isn’t ready in the analysis line and says where it is' and 'shows the place in line it’s given' (passed 2026-11-10).
5. **S3-0057-05 - Implemented.** Preserve lock, remove, insert, play-from-here, render, retry, jump-to-problem and scoped Undo. **Evidence:** web/src/views/Mix.test.tsx 'sends every change to the draft' (lock), 'plays through the draft, from the top or from any song', 'sends one request and every badge changes straight away' (render) and 'opens the first transition that failed, on Change, and names that pair' (jump to problem); web/e2e/flows.e2e.ts 'editing: move with the buttons, undo it, and remove a song' (passed 2026-11-10).
6. **S3-0057-06 - Implemented.** Connect inspector selection to stable pair identity and prevent stale selection from editing a new pair. **Evidence:** web/src/views/Mix.test.tsx 'plays the exact render, and the same stays selected when others move', 'keeps each mix scope’s exact selection separate when the mounted editor switches scope' and 'never confuses two different drafts with identical songs and transition keys' (passed 2026-11-10).
7. **S3-0057-07 - Implemented.** Handle request ghost rows and pending bridges without presenting them as playable timeline items. **Evidence:** web/src/views/Mix.test.tsx 'show up faded in the timeline at the place they’re going', 'take over from the transition they’ll replace, which comes back if they’re cancelled' and 'aren’t shown on a draft, since requests only join what’s playing' (passed 2026-11-10).
8. **S3-0057-08 - In progress.** Profile and optimize 100-song timeline without remounting audio or losing focus/scroll position. **Status:** In progress: long mixes switch to the compact .timeline.long layout in web/src/views/Mix.tsx, but no 100-song profile has been recorded.
9. **S3-0057-09 - Implemented.** Add conflict, second-tab, background render, deleted-row and draft/current isolation tests. **Evidence:** web/e2e/flows.e2e.ts 'a change to a mix that’s moved on stops, says so, and touches nothing' and 'a draft that’s been deleted is explained, and never quietly swapped for another mix'; web/e2e/integration.e2e.ts 'editing a draft while the current mix plays: neither touches the other, and Undo knows which is which'; web/e2e/listen.e2e.ts 'only one tab plays at a time'; web/src/views/Mix.test.tsx 'stop and catch up if the mix has moved on' (passed 2026-11-10).

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
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (8/9) | Task-by-task evidence on each item; 0 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
