# ADR-0102: Stem Studio eight-lane arrangement, accessible time grid and recovery-safe Apply

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 6 Expert
- **Extends, does not automatically supersede:** ADR-0016, ADR-0059, ADR-0084
- **Source surfaces to reconcile:** `web/src/views/Studio.tsx`; `web/src/styles/creation.css`; `web/src/audio/focus.ts`
- **Tasks:** S4-0102-01 through S4-0102-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Studio combines an eight-lane, variable-length stem grid, preview transport, AI assistance, recovery and apply/render stages. A visual rewrite could easily erase working intent or make expert controls mouse-only.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Recompose Studio as a compact musical workstation with persistent pair context, usable time ruler, sticky lane identities, two-track separation, consistent audition controls and explicit Working/Applied/Rendered semantics.

## Experience, frontend and interaction specification

- Group Voice, Drums, Bass, Melody under outgoing and incoming songs; do not invent new stem colours that overwhelm brand.
- 64-cell and smaller grids use horizontal overflow or overview, not tiny touch targets.
- Working copy may be local-only; applying requires exact current seam and revision validation.
- AI-assisted arrangement may suggest changes but a late response cannot override newer human edits.

## Detailed implementation work - all Not started

1. **S4-0102-01 - Redesign Studio pair header, ruler and eight-lane grid hierarchy.** Acceptance: Track/stem/time identities are always understandable. Required verification: 8/16/32/64-cell screenshot and screen reader tests. **Implementation: Not started; Verified: No.**
2. **S4-0102-02 - Preserve mouse, touch, Space, arrow, Home/End and Ctrl+Home/End grid actions.** Acceptance: All grid operations act on correct cell with visible focus. Required verification: ARIA grid keyboard and touch-scroll suite. **Implementation: Not started; Verified: No.**
3. **S4-0102-03 - Make labels and time orientation sticky where appropriate.** Acceptance: Horizontal scroll never hides which stem or song is edited. Required verification: Narrow viewport, zoom, scroll tests. **Implementation: Not started; Verified: No.**
4. **S4-0102-04 - Preserve solo/mute and missing-stem disabling truthfully.** Acceptance: Missing media cannot be toggled as if auditionable. Required verification: Partial/missing/corrupt stem fixtures. **Implementation: Not started; Verified: No.**
5. **S4-0102-05 - Unify preview transport and audio-focus lifecycle.** Acceptance: Closing, failing, switching preview cannot overlap main mix. Required verification: Studio→Inspector→Listen audio-owner races. **Implementation: Not started; Verified: No.**
6. **S4-0102-06 - Clarify dirty, recovered, applied and rendered states.** Acceptance: User knows if work has reached the mix or audio file. Required verification: Apply pending/complete/failure screenshot + data assertions. **Implementation: Not started; Verified: No.**
7. **S4-0102-07 - Preserve validated local working-copy recovery.** Acceptance: Malformed, wrong cell count or wrong pair data not misapplied. Required verification: Storage blocked, invalid JSON, 64-to-8 migration tests. **Implementation: Not started; Verified: No.**
8. **S4-0102-08 - Preserve human/AI arrangements and undo Put it back.** Acceptance: Late generated suggestions cannot erase more recent manual edit. Required verification: AI response ordering, rapid toggles and retry. **Implementation: Not started; Verified: No.**
9. **S4-0102-09 - Harden Apply against stale pair, draft and revision.** Acceptance: Failed Apply retains local work and does not modify other draft. Required verification: Concurrent reorder, draft switch and server timeout tests. **Implementation: Not started; Verified: No.**
10. **S4-0102-10 - Explore alternate accessible nonspatial lane editor without capability loss.** Acceptance: All toggles could be operated via conventional controls if adopted. Required verification: Human NVDA tasks before acceptance. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Studio closed after dirty change and local storage denied: no false recovery guarantee.
- Grid changed by other tab while Apply pending.
- An alternative grid view must share exact same data, not a reduced expert feature subset.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Horizontal scrolling is preferable to shrinking 64 columns into illegible controls.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0102 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

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
