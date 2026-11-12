# ADR-0106: Song Details, measured-versus-corrected metadata, classification and safe source management

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (10/10 implemented, 0 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 8 Library
- **Extends, does not automatically supersede:** ADR-0018, ADR-0063, ADR-0086
- **Source surfaces to reconcile:** `web/src/views/SongDetails.tsx`; `web/src/views/WorkshopPanels.tsx`; `src/selecta/routes/library.py`
- **Tasks:** S4-0106-01 through S4-0106-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Correcting musical metadata affects downstream mixing, while excluding/prioritizing files must never mutate original audio. Readiness and corrections must preserve measured values and truthfully identify rerender implications.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Divide Song Details into Overview, Musical analysis, Corrections, Selecta behaviour and Advanced. Preserve every existing BPM/Camelot correction, reset, priority, Never play and classification operation under safe validation and revision reconciliation.

## Experience, frontend and interaction specification

- Clearly separate measured BPM/key from manual override and explain what the override affects.
- Form values remain after failed save; reset is explicit and correctly scoped.
- Readiness details include specific blockers and actionable analysis steps.
- Watched folder Source operations remain separated from source-file deletion; never suggest stopping watch deletes originals.

## Detailed implementation work

1. **S4-0106-01 - Redesign Song Details section hierarchy and accessibility.** Acceptance: Relevant identity/readiness easy before technical metadata. Required verification: Readiness variants and NVDA reading order. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/SongDetails.tsx; Library.test.tsx 'gives the reason in the song's details'. Needs a person: NVDA reading-order review.
2. **S4-0106-02 - Preserve measured, override and effective BPM/key distinction.** Acceptance: UI never mislabels manual value as measured. Required verification: Half/double/blank/reset and server validation tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Library.test.tsx 'double and half fill in what was measured', 'can go back to what was measured'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read Library.test.tsx: double and half fill from the measured value, reset returns to measured, and the label says measured or yours; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
3. **S4-0106-03 - Harden correction constraints and input errors.** Acceptance: Out-of-range and malformed Camelot values retain draft input. Required verification: Boundary, locale decimal and invalid text tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'shows what's wrong with a value that isn't allowed, and keeps it there'. Needs a person: locale-decimal review.
4. **S4-0106-04 - Expose downstream analysis/transition effects without overclaiming.** Acceptance: User knows edits may trigger rerender without fake guarantee. Required verification: Dependent render invalidation contract tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Library.test.tsx 'saves what was typed, and says what'll be made again'; integration.e2e.ts 'a correction made while the page is open shows up, and only touches its own transitions'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read Library.test.tsx (the save says what will be made again, no promise of when) and integration.e2e.ts 'a correction made while the page is open shows up, and only touches its own transitions'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
5. **S4-0106-05 - Preserve prioritize/exclude/never/play/music classification.** Acceptance: Actions remain scoped to exact song ID. Required verification: Duplicate-name and conflicting updates tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Library.test.tsx 'music and not music can be switched, without touching the file', 'shows exact current flags before confirming a batch edit'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read Library.test.tsx: music flags and batch edits act on the exact song IDs shown before confirming; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
6. **S4-0106-06 - Design analysed/partial/failed/unsuitable readiness explanation.** Acceptance: No false ready from missing beat or key fields. Required verification: Readiness state decision table tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: readiness.test.ts; test_library_edges.py 'a_song_analysis_gave_up_on_says_so_rather_than_looking_ready'; Library.test.tsx 'distinguishes analysed songs from mix-ready songs'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read readiness.test.ts decision table and test_library_edges.py: missing beat or key fields never read as ready; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
7. **S4-0106-07 - Preserve Library context after closing Song Details.** Acceptance: Search page and focused song restored where valid. Required verification: Back/Forward and deletion focus tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/ui/controls.tsx Dialog returns focus by data-focus-key; Library.tsx keeps search and page in the URL; web/e2e/flows.e2e.ts 'dialogs give focus back'. Needs a person: Back/Forward and deletion focus review.
8. **S4-0106-08 - Represent watched, missing and disconnected sources separately.** Acceptance: Unavailable drive is not interpreted as deleted audio. Required verification: Disconnect/reconnect/path change fixtures. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: test_library_edges.py 'a_song_whose_file_has_moved_says_so'; tests/test_folder_relink.py; web/src/views/Workshop.test.tsx 'show folders, and whether each can be found'. Needs a person: real drive disconnect and reconnect.
9. **S4-0106-09 - Verify folder removal semantics and local-file safety.** Acceptance: Stop watch never deletes user music. Required verification: Filesystem snapshot backend contract tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: src/selecta/routes/system.py stop_watching only edits the preference; tests/test_api_contracts.py 'stopping_watching_touches_nothing_else' and new 'stopping_watching_leaves_every_music_file_byte_for_byte'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read stop_watching in src/selecta/routes/system.py (only rewrites the library_folders preference) and test_api_contracts.py, which checks every music file byte for byte after stopping; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
10. **S4-0106-10 - Maintain local-first privacy in diagnostics/copy actions.** Acceptance: No accidental private paths in sharing surfaces. Required verification: Redaction, permissions and text injection tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: tests/test_api_contracts.py 'diagnostics_have_no_paths_or_song_names'; Workshop.test.tsx 'show diagnostics with nothing personal in them'; flows.e2e.ts 'diagnostics hold nothing private'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: privacy review of test_api_contracts.py 'diagnostics_have_no_paths_or_song_names', Workshop.test.tsx and flows.e2e.ts 'diagnostics hold nothing private'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.

## Required negative cases and regression strategy

- Same song in multiple folders, duplicate file metadata, same title different ID.
- A correction is accepted server-side while response fails; retry cannot corrupt history.
- Playlist eligibility should be reported from canonical backend readiness, not visual inference.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Advanced analysis metrics move behind disclosure but remain fully inspectable.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0106 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | Implemented (10/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
