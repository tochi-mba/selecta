# ADR-0064: Workspace status, analysis, watched folders, storage and diagnostics

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 — Discovery and operations
- **Extends existing decisions:** ADR-0020, ADR-0032, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0064-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The existing Workshop area combines analysis, storage, watched folders, learning and diagnostics. Its generic label and many operational indicators make it harder to find settings and distinguish working from blocked states.

## Decision proposed

Rename the visible destination Workspace while preserving /workshop/* URLs and all operations. Build a status-first overview with dedicated Analysis, Sources, Storage, Learning and Diagnostics subviews. Separate real progress, stalled jobs, storage protection and privacy boundaries.

## Experience and frontend architecture

- Overview answers 'how much is mix-ready, what is running, what is blocked, what needs action'. Preserve current job scheduling priority and estimates; display estimates with caveats and never invent percentages.

- Sources retains folder watchers, scan-on-change, adding/removing watches and missing-drive status without deleting song records. Storage differentiates source audio from generated cache, configured budget and available disk space; save controls show the last confirmed value.

- Diagnostics presents human-readable reasons before raw JSON and prevents accidental disclosure of private file paths/song identity. Learning preserves study feedback and measurements while making limitations understandable.

## Detailed implementation work (all Not started)

1. **S3-0064-01 — Not started.** Build Workspace overview with canonical ready/working/blocked summaries and next actions.
2. **S3-0064-02 — Not started.** Reorganize Analysis with start/pause/resume, queue/job prioritization and recoverable failures.
3. **S3-0064-03 — Not started.** Redesign Sources around watched-folder identity, availability, add/remove/watch state and explicit privacy.
4. **S3-0064-04 — Not started.** Design Storage around actual cache usage, budget, free-space warnings and protected output data.
5. **S3-0064-05 — Not started.** Implement debounced, confirmed storage slider writes with rollback and clear background cleanup implications.
6. **S3-0064-06 — Not started.** Preserve Learning and blind-study entry points; distinguish system scores from verified subjective quality.
7. **S3-0064-07 — Not started.** Expose Diagnostics securely with privacy-safe copy/export and advanced explanation.
8. **S3-0064-08 — Not started.** Test offline/reconnect, worker failure, cache pressure, drive removal and queued job status.

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
