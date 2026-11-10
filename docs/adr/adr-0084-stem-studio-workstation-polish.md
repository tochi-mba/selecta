# ADR-0084: Refine Stem Studio's expert controls without reducing capability

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 Implemented (automated), 1 In progress, 0 need a person only (2026-11-10 reconciliation); 0/9 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 3 - creator journeys
- **Extends:** ADR-0059, ADR-0067, ADR-0069. No inherited task is automatically complete.
- **Dependencies:** ADR-0083 inspector semantics; ADRs 0079–0080.
- **Checklist:** S31-0084-01 through S31-0084-09 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/Studio.tsx`, `web/src/studio.ts`, `web/src/ui/primitives.tsx`, `web/src/styles/creation.css`, `web/src/audio/focus.ts`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Keep all two-song/four-lane/64-cell creative capabilities while making pair context, lane labelling, audition ownership, dirty/saved/applied states and accessible grid navigation more legible.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0084-01 - Review session identity and the A/B song context.** Acceptance: User can always tell which songs/pair and revision are being changed. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Studio.test.tsx` ("shows which numbered pair is being shaped") passed. **Needs a person:** A/B context check with a person.
2. **S31-0084-02 - Improve lane and square visual/readable semantics.** Acceptance: Voice, drums, bass and melody cells are distinguishable without colour alone. **Status (2026-11-10):** In progress, not Verified. **Evidence:** `Studio.test.tsx` ("shows a square for every part of both songs, named for a screen reader") passed. **Needs a person:** visual check that lanes differ without colour.
3. **S31-0084-03 - Verify keyboard grid movement and entry/exit.** Acceptance: One grid Tab stop, arrow/Home/End navigation, Space toggle and a reliable way out. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` ("is one tab stop, moves with the arrow keys, and Space turns a square on or off", Home/End); `web/e2e/finishing.e2e.ts` (full Studio grid at the smallest size) passed. **Needs a person:** screen-reader grid walkthrough.
4. **S31-0084-04 - Review solo, audition, shape preset and AI actions.** Acceptance: Each control describes its audio effect and has predictable active/busy/unavailable feedback. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` solo, play/stop, ready-made shapes and Selecta arrange cases passed. **Needs a person:** audible check of each control's effect.
5. **S31-0084-05 - Separate dirty, retained, saved, applying and rendered states.** Acceptance: No wording implies locally retained edits have already been committed or heard. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` ("nothing it does is final until Apply"); `web/src/views/StudioSafety.test.tsx` ("says plainly when the working copy differs from what is applied and rendered") passed. **Needs a person:** owner review for Verified.
6. **S31-0084-06 - Review missing stem, separation wait, stale pair and partial failure states.** Acceptance: Unavailable lanes say why; viable work is preserved and next recovery step is clear. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` stems-wait and can't-arrange cases; `web/src/views/StudioSafety.test.tsx` ("a stem that could not load is named, disabled and cannot be toggled or soloed", "a failed Apply keeps the working copy", "an Apply into a pair that changed sends nothing and keeps the working copy") passed on 2026-11-10 evening. **Needs a person:** review of each unavailable-lane message.
7. **S31-0084-07 - Review narrow layouts, horizontal pan and large-zoom access.** Acceptance: Grid remains operable and controls/focus are not covered by sheets or keyboard. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("the full Studio grid works at the smallest size") passed. **Needs a person:** large-zoom and real narrow-device check.
8. **S31-0084-08 - Verify preview/main audio takeover and return behaviour.** Acceptance: No overlapping audio, stale preview or unintended resume after navigation/close. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` ("closing lets go of the audio", "stops the owned Studio preview ... when the tab becomes hidden") passed. **Needs a person:** audible takeover/return check.
9. **S31-0084-09 - Confirm guarded Apply and restoration after concurrent edit.** Acceptance: A changed/deleted/reordered pair cannot receive stale Studio edits; recovery is traceable. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Studio.test.tsx` ("a mix that moved on refuses the shape"); `StudioSafety.test.tsx` ("an Apply into a pair that changed sends nothing") passed. **Needs a person:** owner review for Verified.

## Required adverse cases and evidence

- Saved in browser is not the same as applied to the mix or rendered to audio.
- Preview must not trigger unplanned main-player resume.
- Keyboard interaction cannot trap focus in the 64-cell grid.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

A wider expert grid may scroll horizontally on a phone as an inherently two-dimensional interface, but every action must remain keyboard/touch accessible.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now also has limited frontend/test changes in other workstreams. This ADR remains Not started; implementation is tracked by task ID in the evidence ledger and no task is Verified.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Selected UI/Edge/test or visual-review infrastructure on draft PR #25; no human acceptance or task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 8 Implemented (automated), 1 In progress, 0 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/9 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
