# ADR-0099: My Mixes current-vs-draft clarity, safe activation and render queue

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 5 Creator
- **Extends, does not automatically supersede:** ADR-0012, ADR-0056, ADR-0083
- **Source surfaces to reconcile:** `web/src/views/Drafts.tsx`; `web/src/views/MyMixes.tsx`; `web/src/views/Mix.tsx`
- **Tasks:** S4-0099-01 through S4-0099-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Playing, saved, being edited, render-ready and queued are different states. Draft activation and current-mix mutations must be unambiguous, especially with asynchronous work.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Make the current mix a separate featured region, drafts a discoverable project collection and the render line a distinct operational queue. Preserve drafts, copying, rename, delete, reorder, play/activate, preview and safe Undo.

## Experience, frontend and interaction specification

- Current mix card names play status, song count, revision/ready state and Play/Edit/Save copy.
- Draft cards clearly show Saved vs Rendered vs Playing; edit is not current-mix activation.
- Queue displays work order rather than pretending to be playlist.
- Activation warns of current audio effect using the shared replacement policy and exact preservation contract.

## Detailed implementation work — all Not started

1. **S4-0099-01 — Redesign current mix overview and actions.** Acceptance: User can identify actual playing mix and its readiness. Required verification: Active/paused/empty card screenshots. **Implementation: Not started; Verified: No.**
2. **S4-0099-02 — Redesign saved-draft list with stable identity and status.** Acceptance: Same-name drafts remain disambiguated and editable. Required verification: Duplicate title and multi-draft fixture. **Implementation: Not started; Verified: No.**
3. **S4-0099-03 — Preserve create, copy, rename, delete and Undo contracts.** Acceptance: No lost work or wrong draft operations. Required verification: CRUD and sequence tests. **Implementation: Not started; Verified: No.**
4. **S4-0099-04 — Clarify Edit versus Play/Make current behaviour.** Acceptance: Draft editing does not affect live player; activation does only as contracted. Required verification: Play A/edit B task script. **Implementation: Not started; Verified: No.**
5. **S4-0099-05 — Redesign activation consequence and recovery flow.** Acceptance: Failed activation preserves prior current mix and audio. Required verification: Server error, pause/play and multi-tab activation tests. **Implementation: Not started; Verified: No.**
6. **S4-0099-06 — Separate rendering queue and progress from saved collection.** Acceptance: Queued, working and finished have truthful distinctions. Required verification: Reorder/remove queue and background completion tests. **Implementation: Not started; Verified: No.**
7. **S4-0099-07 — Ensure draft render readiness is detailed, not binary.** Acceptance: 8/11 prepared is distinct from saved status. Required verification: Partial/failed seam fixtures. **Implementation: Not started; Verified: No.**
8. **S4-0099-08 — Preserve user position through draft mutation and navigation.** Acceptance: Selection/focus not redirected to another card. Required verification: Rename/delete/reorder focus tests. **Implementation: Not started; Verified: No.**
9. **S4-0099-09 — Support long lists, search or sort where supported.** Acceptance: No phantom backend capabilities or lost deep link. Required verification: Long draft dataset and URL restoration. **Implementation: Not started; Verified: No.**
10. **S4-0099-10 — Review destructive confirmation and scope-aware Undo.** Acceptance: Deleting a draft cannot undo current-mix action. Required verification: Multiple deletion and intervening edit tests. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Draft deleted in other tab; open editor must show missing-draft state.
- A draft contains unavailable source songs; status is not green 'Ready'.
- Activating a draft while export of another draft runs cannot reassign its snapshot.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Separating cards and queue takes more space but makes distinct domain states intelligible.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0099 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

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
