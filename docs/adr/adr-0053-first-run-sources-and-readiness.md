# ADR-0053: Guided onboarding, secure folder selection and time to first mix

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0018, ADR-0025, ADR-0037
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0053-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

First run currently begins with filesystem path entry. Users must understand both library scanning and deeper mix readiness, and the privacy statement must accurately disclose LRCLIB metadata lookup. Browser directory handles are not interchangeable with paths the local Python server can read.

## Decision proposed

Replace first run with three task-oriented stages: Connect music, Prepare library, Start listening. Use a native local picker only if its security and server-path contract are actually available; preserve a validated manual path fallback. Explain local audio and lyric-metadata boundaries accurately.

## Experience and frontend architecture

- Each stage reflects an observed backend state, not a fake demo sequence. Progress differentiates files found, analyzed songs and genuinely mix-ready songs; do not bypass the minimum-ready-song rule. Let users reach useful Library/Workspace actions during long analysis.

- Directory picker feasibility is platform-gated; Window.showDirectoryPicker() yields a sandboxed browser handle and cannot be assumed to return a server-readable absolute path. Validate safe paths, permissions and source identity server-side and preserve existing watcher controls.

- A returning user with temporarily unreachable server must see reconnect, not a destructive first-run wizard. Failed setup never erases an already imported library.

## Detailed implementation work (all Not started)

1. **S3-0053-01 - Not started.** Prototype novice setup with a clear privacy explanation and a short, readable staged interface.
2. **S3-0053-02 - Not started.** Evaluate installed-app/native folder selection and implement only if server path acquisition is secure; retain paste-path validation.
3. **S3-0053-03 - Not started.** Specify source-path failure states: non-existent, inaccessible, duplicate, symlink, disconnected drive and unsupported file.
4. **S3-0053-04 - Not started.** Provide real scan and readiness progress with stage-specific explanation of analysis, lyrics and optional stems.
5. **S3-0053-05 - Not started.** Enable correct first playable mix as soon as backend readiness permits; do not pretend unready tracks are ready.
6. **S3-0053-06 - Not started.** Support canceled/retried/interrupted scan, server restart, background watcher and adding further folders later.
7. **S3-0053-07 - Not started.** Separate new-user onboarding from offline/partial state of an existing user.
8. **S3-0053-08 - Not started.** Conduct unguided first-run tasks and record actual completion and confusion evidence.

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

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
