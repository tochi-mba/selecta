# ADR-0083: Make drafts, timeline editing, transition intent and export unambiguous

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 12 Implemented (automated), 0 In progress, 0 need a person only (2026-11-10 reconciliation; updated 2026-11-11); 0/12 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 3 - creator journeys
- **Extends:** ADR-0056, ADR-0057, ADR-0058, ADR-0065. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0080; audio trust in ADR-0082.
- **Checklist:** S31-0083-01 through S31-0083-12 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/{MyMixes,Drafts,Mix,EditorRows,EditorHeader,SeamInspector,ExportPanel,ExportJobs}.tsx`, `web/src/views/mixScope.ts`, `src/selecta/routes/{edit,exports}.py` (contract review). Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Differentiate current and draft scopes at every destructive or playback action. Make songs and transition seams readable as one timeline, preserve exact requested versus rendered transition state and make export revision/ownership explicit.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0083-01 - Review My Mixes current/draft/render-line hierarchy.** Acceptance: Users distinguish what plays, what is saved, what is queued and what will render next. **Status (2026-11-11):** Implemented (automated), not Verified. **Evidence:** `web/src/views/s31-0083-01-my-mixes-hierarchy.test.tsx`: the current mix says Playing now, Paused or Current mix; every draft says Saved and none claims to play; the render line is numbered (1st, 2nd in line), says the current mix goes first and that it doesn't change what's playing; the 1st in line says Rendering now once the current mix is done; what plays comes first on the page (passed 2026-11-11). **Needs a person:** users distinguish playing, saved, queued and next render.
2. **S31-0083-02 - Test new, rename, copy, delete, restore and reorder drafts.** Acceptance: Each action has clear scope, durable feedback, failure recovery and correct Undo identity. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Drafts.test.tsx` (confirm delete, Undo, copy, rename, serialized render line); `Mix.test.tsx` ("renames in place", "deleting ... can be undone") passed. **Needs a person:** owner review for Verified.
3. **S31-0083-03 - Review creator timeline hierarchy at 2, 20 and 100 songs.** Acceptance: Track identity, seam status and contextual actions stay scannable under long metadata. **Status (2026-11-11):** Implemented (automated), not Verified. **Evidence:** `web/src/views/s31-0083-03-timeline-scale.test.tsx`: at 2, 20 and 100 songs with long, RTL, CJK and duplicate names, one row per song and per transition; each song row keeps its number, full title (title attribute, dir=auto), artist, own occurrence and actions named for that song; each transition keeps a worded status and failures say why; duplicates stay distinct in a 100-song list (passed 2026-11-11). **Needs a person:** scan review at 2, 20 and 100 songs.
4. **S31-0083-04 - Provide predictable non-drag reorder and insertion affordances.** Acceptance: Pointer/touch/keyboard alternatives clearly indicate destination and resulting order. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("reordering with the keyboard moves the song, and focus stays on it") passed. **Needs a person:** touch reorder on a real device.
5. **S31-0083-05 - Review draft versus current editor headers and action copy.** Acceptance: User knows what changes immediately affect playback and what remains a separate project. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Mix.test.tsx` ("is plainly a draft, and says what's playing isn't affected", "has no buttons that would change the current mix") passed. **Needs a person:** owner review for Verified; comprehension check.
6. **S31-0083-06 - Audit Inspector Listen/Change/Studio/Details consistency.** Acceptance: Tab semantics, pair context, focus and requested-versus-rendered outcome stay stable. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("a transition's tabs work from the keyboard, and it stays clear which pair they're about"); `Mix.test.tsx` inspector cases passed. **Needs a person:** screen-reader check of Inspector tabs.
7. **S31-0083-07 - Review transition cue, style, bar count and fallback presentation.** Acceptance: User choice is not visually overwritten by a different actually rendered move. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Mix.test.tsx` ("keeps the move you asked for pressed, and names what really plays separately"); `web/src/ui/MusicObjects.test.tsx` passed. **Needs a person:** owner review for Verified.
8. **S31-0083-08 - Verify preview/rating/render failure and stale-request recovery.** Acceptance: A late render cannot trump newer intent; audio preview preserves proper owner. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Mix.test.tsx` ("keeps the latest choice visible when an older server response refreshes the inspector"); `web/e2e/finishing.e2e.ts` ("two quick seam changes on a slow server") passed. **Needs a person:** real render and preview stale-order check.
9. **S31-0083-09 - Review export scope, prerequisites and exact snapshot identity.** Acceptance: Before confirm, user knows selected mix/revision and why export may be unavailable. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Mix.test.tsx` ("shows the exact ordered source songs before creating a file", "says exactly which mix"); `UpNext.test.tsx` SF-0231-01 passed. **Needs a person:** owner review for Verified.
10. **S31-0083-10 - Review persistent export stages, errors, retries and download recovery.** Acceptance: Closing panel or modifying mix does not lose job; final output corresponds to captured revision. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/integration.e2e.ts` ("editing a draft during export keeps the job pinned to its original revision"); `tests/test_export_retry.py`, `tests/test_export_validation.py` passed. **Needs a person:** owner review for Verified.
11. **S31-0083-11 - Test cross-mix concurrent edits, requests and Undo.** Acceptance: Mutation/Undo only affects intended current/draft revision despite stale responses. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/integration.e2e.ts` ("editing a draft while the current mix plays ... Undo knows which is which"); `Shell.test.tsx` Undo identity passed. **Needs a person:** owner review for Verified.
12. **S31-0083-12 - Verify actual FLAC decoding and authored track order.** Acceptance: Downloaded file format, duration, transition identity and source scope match intended snapshot. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("a saved file has the songs of the mix at the moment it was saved, in that order") passed. **Needs a person:** listen to a downloaded FLAC and confirm transition identity.

## Required adverse cases and evidence

- Wrong-mix writes, stale Undo and invalid FLAC are P0 blockers.
- Do not hide unavailable actions without explaining prerequisites.
- Export cannot silently switch to a revised track order mid-job.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

More deliberate confirmation and scope language can add one interaction to risky operations but should not burden reversible low-risk edits.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now includes limited frontend and component-test changes on selected workstreams. None of the tasks is Implemented or Verified; follow the evidence ledger for exact In-progress IDs.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Selected UI/Edge/test or visual-review infrastructure on draft PR #25; no human acceptance or task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 10 Implemented (automated), 2 In progress, 0 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/12 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
