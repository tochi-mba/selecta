# ADR-0173 — Arrangement timeline: tactile songs, seam edges and energy overview

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0150, ADR-0100, ADR-0120; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/Mix.tsx; web/src/views/EditorRows.tsx; web/src/styles/creation.css.

## Context and evidence boundary

The vertical song/seam editor is accessible and works on narrow screens; it should remain the reliable structural model. The creative delta is making the song order feel like a musical composition and exposing which connections must change after edits.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, older implementation checkmarks and this docs PR cannot demonstrate that a new CI task is implemented or independently verified.

## Proposed decision

- Keep songs as objects and transitions as explicit independently selectable connections.
- Offer a compact, real-data relative-energy overview and locate the current song within long sets.
- During dragging show lifted object, insertion point and affected neighbour seams without prematurely committing order.
- After server confirmation, visibly distinguish transitions needing new rendering from those that remain ready.
- Make locks, draft/current edit scope, revision and undo visibly unmistakable.
- Preserve keyboard reorder and phone scrolling; do not impose a dense desktop DAW on narrow screens.

## Visual, animation and microinteraction contract

- Drag follows pointer precisely and only settles when the final target is valid.
- Cancel or failed reorder returns the prior sequence without fake transient success.
- Selected seam and inspector remain synchronized during insertion, removal and Undo.

## Alternatives and trade-offs

Preserve the current restrained design when a richer animation does not measurably improve comprehension, creative control or delight. Illustrative graphics are not analysed waveforms, beats, timed lyrics, fake quality ratings or album artwork. Every animated interaction needs an accessible static/keyboard equivalent; audio and current/draft correctness outrank motion.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0173-01 — Define song block/seam link material.** **Acceptance:** Song and connection distinguishable without extra reading. **Required verification:** Full density and 320px specimens. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0173-02 — Prototype affected-seam drag preview.** **Acceptance:** Users see valid insertion and relevant changed neighbours. **Required verification:** Pointer and repeated-ID move fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0173-03 — Preserve keyboard and touch reorder.** **Acceptance:** Handle never traps vertical scroll; non-drag path has same result. **Required verification:** Coarse pointer, focus and keyboard tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0173-04 — Implement optional honest energy mini-map.** **Acceptance:** Real relative energy shown with unknown fallback and stable current position. **Required verification:** 40+ track and metadata-missing sample. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0173-05 — Clarify lock, draft scope and revision.** **Acceptance:** Cannot accidentally edit current while drafting or unlock by drag. **Required verification:** Revision and current/draft tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0173-06 — Animate confirmed add/remove/undo only.** **Acceptance:** Displayed row order equals actual returned authoritative state. **Required verification:** Conflict, failed write and Undo fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0173-07 — Measure long-editor response.** **Acceptance:** Inspector, open menus and 40+ songs stay interactive. **Required verification:** Performance trace and screen reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner and manual Pause, original files and LRCLIB disclosure, scoped mix/draft revisions and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing Library/routes, neutral blind A/B, decodable frozen-revision FLAC and local operation. Test errors, cancel, stale response, missing/RTL names, long set, offline, 320–2560px, zoom, forced colors, reduced motion, touch, keyboard and real audio where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0150, ADR-0100, ADR-0120; reconcile old task status against actual source before implementing.
- **Implementation sequence:** owner decision → visual/state prototype → fixtures → scoped source PR → independent AT/audio/device/human verification → release signoff.
- **Current:** Proposed; Not started; Independently Verified No. There is no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
