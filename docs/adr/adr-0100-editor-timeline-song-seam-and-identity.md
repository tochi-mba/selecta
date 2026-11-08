# ADR-0100: Timeline editor, precise insertion/reorder, persistent scope and problem navigation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 5 Creator
- **Extends, does not automatically supersede:** ADR-0013, ADR-0057, ADR-0083
- **Source surfaces to reconcile:** `web/src/views/Mix.tsx`; `web/src/views/EditorRows.tsx`; `web/src/views/SeamInspector.tsx`
- **Tasks:** S4-0100-01 through S4-0100-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

The editor is the highest-density operational surface. It must remain powerful while reducing repeated controls and avoiding positional-index identity errors under reorder and live request insertion.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Compose a three-region editor (scope/actions, song-transition timeline, optional inspector) with a persistent current/draft identity. Preserve drag, keyboard and explicit move controls, exact-position insert, remove, lock, preview, undo and rendering.

## Experience, frontend and interaction specification

- Rows emphasize position, title, artist and contextual musical metadata; connector rows identify each seam and actual status.
- Whole-mix commands grouped separately from row-level actions.
- Insertion gaps remain accessible without repeated large Add buttons after each row.
- Inspector selection is keyed by stable song/seam identity rather than array index.

## Detailed implementation work - all Not started

1. **S4-0100-01 - Implement persistent current/draft scope header and clear actions.** Acceptance: Editing a draft never silently mutates what plays. Required verification: Play A/edit B live scenario. **Implementation: Not started; Verified: No.**
2. **S4-0100-02 - Redesign song and seam rows with clear hierarchy.** Acceptance: Long, duplicate, RTL song names remain identifiable. Required verification: 2, 20 and 100-song screenshots. **Implementation: Not started; Verified: No.**
3. **S4-0100-03 - Preserve pointer/touch/keyboard reorder and move controls.** Acceptance: Every method yields identical order with visible focus. Required verification: First/middle/last/locked and touch-scroll tests. **Implementation: Not started; Verified: No.**
4. **S4-0100-04 - Preserve exact-position insertion, removal, locking and Undo.** Acceptance: No impossible or inaccessible insertion gap. Required verification: Empty/one-song/edge-gap scenarios. **Implementation: Not started; Verified: No.**
5. **S4-0100-05 - Keep selection attached to stable object through mutation.** Acceptance: After reorder focus stays with same track; invalid pair explained. Required verification: Concurrent request insertion/delete pair tests. **Implementation: Not started; Verified: No.**
6. **S4-0100-06 - Create compact status/problem navigation.** Acceptance: Jumps to actual failed/missing/unrendered seam and restores focus. Required verification: 100-song fixture and keyboard problem jump. **Implementation: Not started; Verified: No.**
7. **S4-0100-07 - Define consistent whole-mix action grouping.** Acceptance: Save copy, export, new, clear and preview remain discoverable. Required verification: Action parity and keyboard menu audit. **Implementation: Not started; Verified: No.**
8. **S4-0100-08 - Handle stale revision and conflicting operations truthfully.** Acceptance: No wrong-scope edit or old response overriding newest mix. Required verification: Two tabs, delayed reorder, request join race tests. **Implementation: Not started; Verified: No.**
9. **S4-0100-09 - Preserve scroll/context and responsiveness with long lists.** Acceptance: Input remains responsive without inappropriate virtualized focus loss. Required verification: 100-song, zoom and measured perf tests. **Implementation: Not started; Verified: No.**
10. **S4-0100-10 - Standardize empty/one-song/missing-audio/failure/undo states.** Acceptance: No fake transitions or misleading success state. Required verification: Error and recovery E2E. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Selected seam disappears when song order changes; do not silently inspect a different pair.
- A request inserts between user reorder and server response.
- Drag handle must not prevent natural vertical mobile scroll and has non-drag alternative.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Some control actions move into an accessible menu to reduce density, but discoverability must be validated.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0100 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
