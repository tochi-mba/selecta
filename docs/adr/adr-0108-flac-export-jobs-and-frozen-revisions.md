# ADR-0108: Export audio, revision-pinned FLAC jobs, durable progress and verified downloads

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 9 Operations
- **Extends, does not automatically supersede:** ADR-0022, ADR-0065, ADR-0083
- **Source surfaces to reconcile:** `web/src/views/ExportPanel.tsx`; `web/src/views/ExportJobs.tsx`; `src/selecta/routes/exports.py`
- **Tasks:** S4-0108-01 through S4-0108-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Save as draft, Export audio and Download FLAC represent different outcomes; export may continue after modal closure and must render the frozen starting revision, not whatever mix currently exists.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use Export audio consistently for producing files, Save for editable projects, and Download only after a file is actually ready. Display mix identity, snapshot version, stage, progress and immutable job association across Activity and Workspace.

## Experience, frontend and interaction specification

- Pre-submit confirmation identifies mix/draft scope, song count, first/last song, format and frozen revision.
- Job stages distinguish transition preparation, encoding and ready-to-download; 'export started' not 'file ready'.
- Closing modal or changing draft never reassigns/cancels authoritative job.
- Only FLAC offered until verified backend encoding support exists for other formats.

## Detailed implementation work — all Not started

1. **S4-0108-01 — Standardize Save/Export/Download terminology across routes.** Acceptance: User cannot confuse editable project and completed file. Required verification: Copy audit plus unassisted task comprehension. **Implementation: Not started; Verified: No.**
2. **S4-0108-02 — Redesign pre-export scope/snapshot confirmation.** Acceptance: Exact source and revision visible before submission. Required verification: Current/draft same-name and edited-after-start cases. **Implementation: Not started; Verified: No.**
3. **S4-0108-03 — Preserve revision-pinned export backend job.** Acceptance: Mix edits after submission do not affect FLAC bytes. Required verification: Frozen snapshot and server contract tests. **Implementation: Not started; Verified: No.**
4. **S4-0108-04 — Design queued/rendering/encoding/ready/failed/cancelled/expired stages.** Acceptance: No invented readiness or percent on incomplete backend data. Required verification: Job state fixture screenshots. **Implementation: Not started; Verified: No.**
5. **S4-0108-05 — Preserve export while dialog closes, route changes or browser reloads.** Acceptance: Authoritative job remains retrievable independent of UI. Required verification: Reload/draft switch/Stage navigation tests. **Implementation: Not started; Verified: No.**
6. **S4-0108-06 — Harden cancel/retry/duplicate export and idempotency.** Acceptance: Interrupted mutation does not create duplicate job unnoticed. Required verification: Server timeout, twice-submit and cancel race tests. **Implementation: Not started; Verified: No.**
7. **S4-0108-07 — Make correct download discoverable and failure recoverable.** Acceptance: No missing/expired file shown as downloadable. Required verification: Expired URL, storage full and unauthorized route tests. **Implementation: Not started; Verified: No.**
8. **S4-0108-08 — Verify actual FLAC file identity and decode correctness.** Acceptance: Decodable output matches song order, duration and frozen transitions. Required verification: Decode file, compare sample format/timing/revision. **Implementation: Not started; Verified: No.**
9. **S4-0108-09 — Clarify transitions prepared or falling back at export start.** Acceptance: Export status accurately reports technical readiness. Required verification: Missing seam, fallback and rerender fixture tests. **Implementation: Not started; Verified: No.**
10. **S4-0108-10 — Record real listening acceptance separately from encoder success.** Acceptance: Successful encode not evidence of musically good handoff. Required verification: Audible review with representative transition set. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Two exports for same named mix remain distinguishable via job ID/revision.
- Server responds after user changed drafts: never attach old job to new draft.
- HTTP 200 download is insufficient proof; decode and inspect output.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Detailed frozen-version disclosure adds one decision step but protects user trust and artifact correctness.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0108 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
