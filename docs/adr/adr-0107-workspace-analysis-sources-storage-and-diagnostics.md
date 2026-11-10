# ADR-0107: Workspace operations, background analysis, watched sources, storage and diagnostics

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (8/10 implemented, 2 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 9 Operations
- **Extends, does not automatically supersede:** ADR-0020, ADR-0064, ADR-0072, ADR-0086
- **Source surfaces to reconcile:** `web/src/views/Workshop.tsx`; `web/src/views/WorkshopPanels.tsx`; `src/selecta/routes/system.py`
- **Tasks:** S4-0107-01 through S4-0107-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Workspace houses important operational capabilities but ordinary listening should not feel like administering a worker queue. The interface must prioritize blockers and explain processing accurately.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Reorder Workspace around Needs attention → Ongoing work → Library health → Exports → Settings, with detailed Analysis, Sources, Storage, Learning and Diagnostics surfaces kept intact.

## Experience, frontend and interaction specification

- One directly actionable recovery link per blocker; routine healthy jobs remain quiet.
- Analysis progress distinguishes queued, analyzing, paused, deliberately deprioritized and failed.
- Cache usage and budget show regenerated data versus persistent source audio; settings must not imply original files are removed.
- Copy diagnostics should redact sensitive local paths per verified backend contract.

## Detailed implementation work

1. **S4-0107-01 - Redesign Workspace overview with attention hierarchy.** Acceptance: Actual blockers distinguish from harmless background activity. Required verification: Storage full, no-ready-songs, offline fixtures. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/Workshop.tsx and WorkshopPanels.tsx order ready, running, stuck, needs you; Workshop.test.tsx 'say what's really happening, including what's failed', 'say when the storage limit has stopped things'. Needs a person: storage-full/offline screenshot review.
2. **S4-0107-02 - Preserve analysis start/pause/progress and deprioritization.** Acceptance: Processing state is accurate while user listens. Required verification: Paused/playing/restart/poll cases. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: WorkshopPanels.tsx paused analysis state and Carry on; Workshop.test.tsx 'says what Selecta does with nothing else to do, and how far it has got'; web/src/state/jobs.test.ts 'counts actual failures and a paused queue'. Needs a person: independent review.
3. **S4-0107-03 - Preserve folder source watch/unwatch and recovery.** Acceptance: Missing drive shown separately from stopped watch. Required verification: Permission, disconnect, rescan and original-file tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Workshop.test.tsx 'show folders, and whether each can be found'; tests/test_folder_relink.py; tests/test_api_contracts.py 'folders_say_whether_they_can_be_found'. Needs a person: real permission/disconnect check.
4. **S4-0107-04 - Rebuild storage budget/meter and meaning labels.** Acceptance: Cache is not confused with durable data or originals. Required verification: Slider min/max/save failed/rapid changes. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Workshop.test.tsx 'explains what's used in plain words', 'show the slider what was really saved', 'explains when protected priority stems exceed the selected limit'. Needs a person: independent review.
5. **S4-0107-05 - Preserve background render jobs, priorities and queue.** Acceptance: Job accepted distinct from complete; queue actions correct. Required verification: Failure, cancel and duplicate mutation tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_drafts.py render-line priority tests; tests/test_operation_identity.py; web/src/views/ExportJobs.tsx accepted vs complete. Needs a person: independent review.
6. **S4-0107-06 - Clarify learning feedback and locate blind study.** Acceptance: Ratings and formal A/B trials remain separate. Required verification: Task findability and study context tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Workshop.tsx keeps the Listening study on its own route apart from ratings; Workshop.test.tsx 'each link to their own address'. Needs a person: task findability check.
7. **S4-0107-07 - Preserve diagnostics operations with privacy-safe copying.** Acceptance: Copied data contains only declared safe fields. Required verification: Actual payload inspection and path-redaction tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_api_contracts.py 'diagnostics_have_no_paths_or_song_names'; Workshop.test.tsx 'show diagnostics with nothing personal in them, ready to copy'. Needs a person: actual payload inspection by a person.
8. **S4-0107-08 - Expose global critical health attention without header clutter.** Acceptance: Blockers visible outside Workspace with direct route. Required verification: Mobile More and accessible indicator tests. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/shell/Shell.tsx health-attention link to /workshop with a count; no unit test of the indicator yet. Needs a person: mobile More and accessible indicator review.
9. **S4-0107-09 - Harden offline/recovery and old-server capability detection.** Acceptance: Failure to fetch not represented as zero cache usage. Required verification: Backend restart, unsupported API tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Workshop.test.tsx 'say when they can't find out, rather than saying nothing's happening'; jobs.test.ts 'never crashes the app for an incomplete status from a different server version'; flows.e2e.ts 'it says so, keeps what's on screen, and recovers by itself'. Needs a person: backend restart check.
10. **S4-0107-10 - Measure quiet background polling impact on UI/audio.** Acceptance: No excessive refreshes or animation stutter. Required verification: Performance trace during analysis and render. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/ui/useVisiblePoll.test.tsx keeps polling off hidden pages; no performance trace. Needs a person: performance trace during analysis and render.

## Required negative cases and regression strategy

- Storage reports stale values after save; show authoritative confirmed budget.
- A watched folder is missing temporarily; don't promise original source was deleted.
- Background task continues when panel closed, and returned success is not necessarily task success.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Consolidating operation overview reduces noise, but deep diagnostics stay accessible for experts.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0107 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (8/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
