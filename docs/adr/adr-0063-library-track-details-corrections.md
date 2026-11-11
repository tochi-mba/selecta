# ADR-0063: Library detail inspector, canonical readiness and protected corrections

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-11; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0018, ADR-0017, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Track details expose measured and corrected tempo/key, half/double tempo controls, analysis priority, exclusion and readiness. Background reanalysis can update measurements while preserving manual overrides; multiple sources of readiness risk inconsistent action enablement.

## Decision proposed

Create one authoritative track-detail presentation and readiness projection. Separate measured values from effective user corrections and keep all correction data stable across rescans, background analysis and UI migration.

## Experience and frontend architecture

- A responsive details panel provides identity, readiness, measured metadata, effective override and track-management actions, with low-level diagnostics deferred to an Advanced section. Show original and effective BPM/key separately.

- The readiness badge and enabled actions share a canonical selection function; BPM alone never implies mix readiness. Corrections are validated, revision-aware and revertible. 'Never play' and 'Set aside' indicate playback policy, not deletion or file moves.

- Refreshing song metadata must never silently overwrite manual correction or incorrectly invalidate unrelated draft work. Explain which derived transition data may need rerender after correction.

## Detailed implementation work

1. **S3-0063-01 - Implemented.** Specify canonical track readiness from existing API fields and map each user-facing reason. **Evidence:** web/src/state/readiness.ts trackReadiness (one computation, used by Library, SongDetails, Mix, Drafts, Requests and the palette) with the reasons named in docs/adr/selecta-3-glossary.md 'States, and where each comes from'; web/src/state/readiness.test.ts 'shows failures before pending queue or rendering states' and 'never offers excluded music for manual mixing or analysis even with an old tempo'; web/src/views/Library.test.tsx 'gives the reason in the song’s details' and 'distinguishes analysed songs from mix-ready songs without promising rendered transitions' (passed 2026-11-10).
2. **S3-0063-02 - Implemented.** Build responsive song inspector with measured/effective BPM and key provenance. **Evidence:** web/src/views/LibraryLx.test.tsx 'a correction, the measurement and an unknown are labelled apart'; web/e2e/lx-library.e2e.ts 'LX-0348-01 the sheet leads with the exact recording, whole long titles included' and 'LX-0348-05 LX-0348-07 the song sheet corrects with focus on errors, and closing returns to the exact row, scroll and address' (passed 2026-11-11).
3. **S3-0063-03 - Implemented.** Retain Double, Half, manual tempo, key override, reset, exclusions, priority and classification operations. **Evidence:** web/src/views/Library.test.tsx 'double and half fill in what was measured', 'saves what was typed, and says what’ll be made again', 'can go back to what was measured', 'music and not music can be switched, without touching the file' and 'lets the listener prioritize a song and shows the priority list'; tests/test_api_contracts.py test_it_can_be_put_back, test_one_part_can_be_changed_without_losing_the_other and test_setting_aside_is_reversible_and_touches_no_file; tests/test_library_lx.py test_never_play_and_set_aside_are_different_states_that_both_reverse (passed 2026-11-10).
4. **S3-0063-04 - Implemented.** Validate inputs, preserve edit focus and never turn a stale measurement into a successful correction. **Evidence:** web/src/views/SongDetails.tsx moves focus to the error and keeps what was typed; web/src/views/Library.test.tsx 'shows what’s wrong with a value that isn’t allowed, and keeps it there' (no success notice on a refused save); tests/test_api_contracts.py test_nonsense_is_refused_and_nothing_changes, test_a_correction_leaves_what_was_measured_alone and test_a_song_that_is_not_there_says_so (passed 2026-11-10).
5. **S3-0063-05 - Implemented.** Protect user overrides during concurrent reanalysis, watcher updates and duplicate-title results. **Evidence:** tests/test_library_edges.py test_a_correction_survives_reanalysis_a_folder_update_and_a_same_named_song; tests/test_api_contracts.py test_analysing_the_song_again_can_not_lose_it; tests/test_library_lx.py test_another_tab_changing_a_song_after_selection_refuses_the_whole_batch and test_a_batch_with_one_stale_entry_changes_nothing (passed 2026-11-10).
6. **S3-0063-06 - Implemented.** Keep library and mix availability actions consistent with a single readiness computation. **Evidence:** web/src/state/readiness.ts is the single readiness computation imported by Library, SongDetails, Mix, CurrentMix, Drafts and Requests; web/src/views/Library.test.tsx 'preserves the same song actions, readiness reason and list while switching layouts'; web/src/views/LibraryLx.test.tsx 'a partly scanned library offers no playable action and explains readiness' and 'a missing file says where to look, and offers nothing that would play it'; web/src/state/readiness.test.ts 'never offers excluded music for manual mixing or analysis even with an old tempo' (passed 2026-11-10).
7. **S3-0063-07 - Implemented.** Describe reversible overrides and possible downstream rerender effects. **Evidence:** web/src/views/Library.test.tsx 'saves what was typed, and says what’ll be made again' and 'can go back to what was measured'; web/src/views/LibraryLx.test.tsx 'a correction, the measurement and an unknown are labelled apart'; tests/test_api_contracts.py test_only_transitions_with_that_song_are_made_again and test_correcting_nothing_about_the_sound_makes_nothing_again (passed 2026-11-10).
8. **S3-0063-08 - Implemented.** Verify persistence, correct song identity, long metadata and missing-field fallbacks. **Evidence:** tests/test_library_edges.py test_any_name_comes_back_exactly_as_it_is_and_can_be_searched_for, test_songs_with_the_same_name_are_kept_apart and test_songs_missing_things_still_turn_up_in_every_order; tests/test_api_contracts.py test_every_song_list_shows_a_correction; web/src/views/Library.test.tsx 'makes duplicate recording IDs visible in both rows and song details' and 'resolves a linked song by exact ID outside the current filter and page'; web/src/views/LibraryLx.test.tsx 'an unmeasured key is named, not a bare dash' and 'names the artist when only the title is shared, and the ID when title and artist are' (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Half/double BPM then background reanalysis; corrected value stays effective and rederived content updates.
- Invalid key/BPM, no beat grid, stale panel, duplicate name and missing source file.
- Set aside versus Never play, priority edits under server loss and restoration of original value.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Show only corrected values: clean but hides provenance. Use local-only UI overrides: quick but loses canonical state. Preserve authoritative server correction semantics.

## Acceptance and evidence

Users can see and safely change exactly the metadata used for the intended song, with truthful mix readiness and preserved correction persistence.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 0 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
