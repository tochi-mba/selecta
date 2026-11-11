# ADR-0064: Workspace status, analysis, watched folders, storage and diagnostics

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-11; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0020, ADR-0032, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The existing Workshop area combines analysis, storage, watched folders, learning and diagnostics. Its generic label and many operational indicators make it harder to find settings and distinguish working from blocked states.

## Decision proposed

Rename the visible destination Workspace while preserving /workshop/* URLs and all operations. Build a status-first overview with dedicated Analysis, Sources, Storage, Learning and Diagnostics subviews. Separate real progress, stalled jobs, storage protection and privacy boundaries.

## Experience and frontend architecture

- Overview answers 'how much is mix-ready, what is running, what is blocked, what needs action'. Preserve current job scheduling priority and estimates; display estimates with caveats and never invent percentages.

- Sources retains folder watchers, scan-on-change, adding/removing watches and missing-drive status without deleting song records. Storage differentiates source audio from generated cache, configured budget and available disk space; save controls show the last confirmed value.

- Diagnostics presents human-readable reasons before raw JSON and prevents accidental disclosure of private file paths/song identity. Learning preserves study feedback and measurements while making limitations understandable.

## Detailed implementation work

1. **S3-0064-01 - Implemented.** Build Workspace overview with canonical ready/working/blocked summaries and next actions. **Evidence:** web/src/views/WorkshopPanels.tsx NeedsYou and the Overview health summary; web/src/views/ciWorkspaceHealth.test.tsx 'says the library can be mixed, with the real ready count, when nothing blocks it' and 'says mixing is blocked by too few ready songs, and puts that fix first above the rest'; web/src/views/sfFlowWorkspace.test.tsx 'puts every known fault, with its fix, above the metrics and the job list'; web/src/views/Workshop.test.tsx 'say what’s really happening, including what’s failed' (passed 2026-11-11).
2. **S3-0064-02 - Implemented.** Reorganize Analysis with start/pause/resume, queue/job prioritization and recoverable failures. **Evidence:** web/src/views/s3-0064-workspace.test.tsx 'Analysis starts the rest and pauses it again, saying it is safe to pause (S3-0064-02)' and 'a running analysis offers Pause and stops through its own route (S3-0064-02)'; web/src/views/ex-0128-job-truth.test.tsx 'queued, paused and failed each have their own words and status kind'; tests/test_ex_0128_operations_parity.py test_scan_watch_pause_budget_and_diagnostics_answer (passed 2026-11-11).
3. **S3-0064-03 - Implemented.** Redesign Sources around watched-folder identity, availability, add/remove/watch state and explicit privacy. **Evidence:** web/src/views/s3-0064-workspace.test.tsx 'Sources says the audio stays on the PC and exactly what the lyric lookup sends (S3-0064-03)'; web/src/views/Workshop.test.tsx 'show folders, and whether each can be found'; tests/test_api_contracts.py test_folders_say_whether_they_can_be_found and test_stopping_watching_leaves_every_music_file_byte_for_byte (passed 2026-11-11).
4. **S3-0064-04 - Implemented.** Design Storage around actual cache usage, budget, free-space warnings and protected output data. **Evidence:** web/src/views/polishWorkshopShowcase.test.tsx 'names budget, cache, free disk and untouched music separately'; web/src/views/ufWorkspace.test.tsx 'names the cache, the protected priority stems and the untouched originals separately'; web/src/views/Workshop.test.tsx 'explains what’s used in plain words' and 'explains when protected priority stems exceed the selected limit' (passed 2026-11-11).
5. **S3-0064-05 - Implemented.** Implement debounced, confirmed storage slider writes with rollback and clear background cleanup implications. **Evidence:** web/src/views/Workshop.test.tsx 'moves the moment it’s dragged, before the server has answered' and 'show the slider what was really saved'; web/src/views/s2WorkshopStorage.test.tsx 'serialises writes and shows only the newest confirmed limit'; web/src/views/polishWorkshopShowcase.test.tsx 'a refused save falls back to the last confirmed limit and says why' and 'a slow older save never replaces a newer choice'; web/src/views/sfFlowWorkspace.test.tsx 'previews, and Keep cancels without sending anything', 'removes only after a yes, and reports the real amount from the server' and 'a failed removal says nothing was removed, and the limit goes back' (passed 2026-11-11).
6. **S3-0064-06 - Implemented.** Preserve Learning and blind-study entry points; distinguish system scores from verified subjective quality. **Evidence:** web/src/views/s3-0064-workspace.test.tsx 'Learning keeps the blind study entry point and separates automatic checks from a person’s ear (S3-0064-06)' (passed 2026-11-11).
7. **S3-0064-07 - Implemented.** Expose Diagnostics securely with privacy-safe copy/export and advanced explanation. **Evidence:** web/src/views/Workshop.test.tsx 'show diagnostics with nothing personal in them, ready to copy'; web/src/diagnosticsOperations.test.ts 'copied diagnostics drop anything that is not a plain operation id, and every unknown field'; tests/test_diagnostics_operations.py test_an_operation_id_that_could_carry_a_path_is_neither_echoed_nor_listed; tests/test_api_contracts.py test_diagnostics_have_no_paths_or_song_names (passed 2026-11-11).
8. **S3-0064-08 - Implemented.** Test offline/reconnect, worker failure, cache pressure, drive removal and queued job status. **Evidence:** offline and reconnect: web/src/views/ex-0128-job-truth.test.tsx 'a malformed or failed refresh keeps the last answer but says it may be out of date' and web/src/views/Workshop.test.tsx 'say when they can’t find out, rather than saying nothing’s happening'; worker failure: tests/test_diagnostics_operations.py test_diagnostics_and_jobs_follow_a_worker_that_stops_and_restarts; cache pressure: tests/test_diagnostics_operations.py test_jobs_say_when_the_storage_limit_blocks_work and web/src/views/ex-0128-job-truth.test.tsx 'a storage block says Blocked, never Paused, and links to the fix'; drive removal: web/src/views/Workshop.test.tsx 'show folders, and whether each can be found'; queued status: web/src/views/ex-0128-job-truth.test.tsx 'queued, paused and failed each have their own words and status kind' (passed 2026-11-11).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Paused processing versus waiting jobs; backend restart and wrong ETA.
- Storage budget slider rapidly changed, older response arrives last, cleanup fails and disk full.
- Source folder disappears then returns, watch disabled and scan-trigger race; source files remain untouched.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A settings-only page would hide operational analysis. A developer-style dashboard could overwhelm listeners. Use a status-first Workspace with graduated detail.

## Acceptance and evidence

Maintenance tasks are findable, truthful and safe; old Workshop functionality and links remain functional.

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
