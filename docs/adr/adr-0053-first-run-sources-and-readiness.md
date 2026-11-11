# ADR-0053: Guided onboarding, secure folder selection and time to first mix

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0018, ADR-0025, ADR-0037
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

First run currently begins with filesystem path entry. Users must understand both library scanning and deeper mix readiness, and the privacy statement must accurately disclose LRCLIB metadata lookup. Browser directory handles are not interchangeable with paths the local Python server can read.

## Decision proposed

Replace first run with three task-oriented stages: Connect music, Prepare library, Start listening. Use a native local picker only if its security and server-path contract are actually available; preserve a validated manual path fallback. Explain local audio and lyric-metadata boundaries accurately.

## Experience and frontend architecture

- Each stage reflects an observed backend state, not a fake demo sequence. Progress differentiates files found, analyzed songs and genuinely mix-ready songs; do not bypass the minimum-ready-song rule. Let users reach useful Library/Workspace actions during long analysis.

- Directory picker feasibility is platform-gated; Window.showDirectoryPicker() yields a sandboxed browser handle and cannot be assumed to return a server-readable absolute path. Validate safe paths, permissions and source identity server-side and preserve existing watcher controls.

- A returning user with temporarily unreachable server must see reconnect, not a destructive first-run wizard. Failed setup never erases an already imported library.

## Detailed implementation work

1. **S3-0053-01 - Implemented.** Prototype novice setup with a clear privacy explanation and a short, readable staged interface. **Evidence:** web/src/views/Setup.tsx; web/e2e/finishing.e2e.ts 'a first run says what leaves this PC before anything is sent'; web/src/App.test.tsx 'asks where the music is before anything else' (passed 2026-11-10).
2. **S3-0053-02 - Implemented.** Evaluate installed-app/native folder selection and implement only if server path acquisition is secure; retain paste-path validation. **Evidence:** evaluated in docs/adr/selecta-3-privacy.md section 'Choosing a folder' (a browser handle is not a server path, so no picker); paste-path validation in src/selecta/library/folder_check.py; tests/test_selecta3_changes.py test_folder_preflight_keeps_existing_library_unchanged; tests/test_api_contracts.py test_folders_say_whether_they_can_be_found; web/e2e/finishing.e2e.ts 'a folder that can’t be used says why and what to try, nothing is read, and another can be tried straight away' (passed 2026-11-10).
3. **S3-0053-03 - Implemented.** Specify source-path failure states: non-existent, inaccessible, duplicate, symlink, disconnected drive and unsupported file. **Evidence:** src/selecta/library/folder_check.py kinds (missing, not a folder, unreadable, already added, inside added, no audio; symlinks resolved); tests/test_selecta3_changes.py test_folder_preflight_keeps_existing_library_unchanged; tests/test_scan.py test_an_unplugged_drive_has_not_changed and test_other_kinds_of_file_are_ignored; tests/test_folder_relink.py test_a_symbolic_link_target_is_refused (passed 2026-11-10).
4. **S3-0053-04 - Implemented.** Provide real scan and readiness progress with stage-specific explanation of analysis, lyrics and optional stems. **Evidence:** web/e2e/finishing.e2e.ts 'the first run says which stage it’s at, from what the server says, and each can go wrong on its own' (passed 2026-11-10).
5. **S3-0053-05 - Implemented.** Enable correct first playable mix as soon as backend readiness permits; do not pretend unready tracks are ready. **Evidence:** web/src/views/Setup.test.tsx 'offers the first mix as soon as enough songs are ready while analysis continues' and 'does not promise a playable mix before the real readiness threshold' (passed 2026-11-10).
6. **S3-0053-06 - Implemented.** Support canceled/retried/interrupted scan, server restart, background watcher and adding further folders later. **Evidence:** tests/test_selecta3_changes.py test_stopping_scan_before_listing_does_not_write_partial_music; tests/test_scan.py test_a_new_song_is_noticed_and_brought_in, test_folders_scanned_on_purpose_are_remembered and test_an_empty_folder_never_wipes_the_library; tests/test_recovery.py test_recovery_preserves_extra_columns_and_refuses_overwrite (passed 2026-11-10).
7. **S3-0053-07 - Implemented.** Separate new-user onboarding from offline/partial state of an existing user. **Evidence:** web/src/App.test.tsx 'asks where the music is before anything else' (new user) and 'says so rather than showing an empty mix in silence' (existing user); web/src/shell/Shell.test.tsx 'says so across the top, and what’s on screen stays' (passed 2026-11-10).
8. **S3-0053-08 - Needs a person.** Conduct unguided first-run tasks and record actual completion and confusion evidence. **Status:** Needs a person: unguided first-run sessions with real participants, recording completion and confusion.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Permission denial, empty folder, duplicate folder, nested folder, removable drive loss and changing watched-folder permissions.
- Five or fewer ready songs versus threshold crossing; first Play with analysis still running.
- Backend unreachable after previous successful setup; verify no duplicate import or unwanted data reset.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Mandating a browser picker would be aesthetically simple but technically incorrect and potentially insecure. The fallback keeps setup functional on supported platforms.

## Acceptance and evidence

Unassisted users can add music, understand privacy, observe truthful preparation and start a valid mix without losing pre-existing library state.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 1 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
