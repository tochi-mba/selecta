# ADR-0086: Polish Library, Workspace, studies and operational status

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 Implemented (automated), 2 In progress, 1 need a person only (2026-11-10 reconciliation); 0/11 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 4 - library and discovery
- **Extends:** ADR-0062, ADR-0063, ADR-0064, ADR-0066, ADR-0072. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0080; request/discovery semantics from ADR-0085.
- **Checklist:** S31-0086-01 through S31-0086-11 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/{Library,SongDetails,Workshop,WorkshopPanels,Listening,ExportJobs}.tsx`, `web/src/state/readiness.ts`, `src/selecta/routes/{library,system}.py` (contract review). Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Use a scannable library and an operations overview that answers 'is Selecta working, what is it doing, and what needs me?' Preserve manual overrides, study integrity, source privacy and precise readiness.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0086-01 - Review Library search, sort, filters, density and URL/history state.** Acceptance: Results match query, Back restores selected filter, and deep links remain valid. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Library.test.tsx` ("keeps what you were looking for in the address", deep-link cases); `router.test.tsx` ("remembers filters in the address") passed. **Needs a person:** owner review for Verified.
2. **S31-0086-02 - Rebalance library row title, artist, readiness and action hierarchy.** Acceptance: Scanning reveals song identity and blockers before secondary maintenance controls. **Status (2026-11-10):** In progress, not Verified. **Evidence:** `Library.test.tsx` ("preserves the same song actions, readiness reason and list while switching layouts") passed. **Needs a person:** visual scan review of row hierarchy.
3. **S31-0086-03 - Review large-result pagination and background refresh behaviour.** Acceptance: Show counts/loaded subset, preserve focus and prior results during refresh or failure. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Library.test.tsx` ("shows how many there are, and fetches more without losing its place", focus on Show more, middle-page reload) passed. **Needs a person:** large-result profile on real hardware.
4. **S31-0086-04 - Review track detail and manual tempo/key/exclusion controls.** Acceptance: Controls explain effective versus detected values; corrections persist after analysis. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Library.test.tsx` correction cases; `tests/test_api_contracts.py` (`test_a_correction_leaves_what_was_measured_alone`) passed. **Needs a person:** owner review for Verified.
5. **S31-0086-05 - Audit readiness language across Library, Explore and Workspace.** Acceptance: Same song has the same true readiness and same explanation on every surface. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/state/readiness.test.ts`; `Library.test.tsx` ("distinguishes analysed songs from mix-ready songs"); `Mixes.test.tsx` mix-ready threshold passed. **Needs a person:** owner review for Verified.
6. **S31-0086-06 - Review Workspace overview attention, background jobs and storage.** Acceptance: Users know what's working, what is paused, and what specific action is needed. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Workshop.test.tsx` ("say what's really happening, including what's failed", storage limit) passed. **Needs a person:** owner review for Verified.
7. **S31-0086-07 - Review watched-folder, scan-stop, drive loss and storage-limit recovery.** Acceptance: Cancelling or losing a drive never appears to destroy original music or its records. **Status (2026-11-10):** In progress, not Verified. **Evidence:** `Workshop.test.tsx` ("show folders, and whether each can be found") passed. **Needs a person:** real drive loss and scan-stop check.
8. **S31-0086-08 - Review operational diagnostics and local privacy explanations.** Acceptance: Only safe fields shown; metadata lookup disclosure names LRCLIB data accurately. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `Workshop.test.tsx` ("show diagnostics with nothing personal in them"); `web/src/localPrivacyCopy.test.ts` passed. **Needs a person:** owner review for Verified.
9. **S31-0086-09 - Review listening-study setup, progress, A/B answers and completion.** Acceptance: Blinding holds, trials are attributed correctly and user can continue after a failed submission. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/views/Listening.test.tsx` ("keeps a failed save on its current trial"); `tests/test_listening.py` passed. **Needs a person:** blinding review with a participant.
10. **S31-0086-10 - Validate narrow/high-zoom, missing/duplicate/RTL song data.** Acceptance: Every main library and Workspace action is readable and navigable at supported sizes. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` (long, right-to-left and duplicate names at the smallest size); `Library.test.tsx` duplicate IDs passed. **Needs a person:** 200/400% zoom check.
11. **S31-0086-11 - Measure real 20k-track Library scale and constrained hardware response.** Acceptance: Capture input latency, scroll smoothness, memory growth and background-render interference. **Status (2026-11-10):** Not Verified. **Evidence:** Harness exists (`tests/scale_server.py`). **Needs a person:** measure a real 20k library on constrained hardware.

## Required adverse cases and evidence

- Never conflate an unknown analysis value with a definite failure or ready state.
- User corrections must survive background reanalysis.
- Diagnostics must not expose local paths/song metadata through copied logs by default.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

Compact row actions may move behind an accessible menu, but crucial readiness and the next useful action remain visible.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now also has limited frontend/test changes in other workstreams. This ADR remains Not started; implementation is tracked by task ID in the evidence ledger and no task is Verified.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Partial UI/test or request/Library work on draft PR #25, with no task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 8 Implemented (automated), 2 In progress, 1 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/11 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
