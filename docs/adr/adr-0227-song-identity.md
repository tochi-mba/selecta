# ADR-0227 — Song Details: trusted analysis, metadata corrections and availability

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Library.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0154/0177/0123; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/SongDetails.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

Give each local recording an honest identity and readable provenance for BPM, key, lyrics, stems and readiness. Metadata correction must update only authorized scope. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Give each local recording an honest identity and readable provenance for BPM, key, lyrics, stems and readiness. Metadata correction must update only authorized scope. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No misleading exact BPM/quality, accidental source-file mutation or confusing pending analysis with ready playback. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0227-01 — Design rich song profile.** **Acceptance:** Core metadata and actions first, diagnostics progressive. **Required verification:** Detail screen critique. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0227-02 — Identify provenance and uncertainty.** **Acceptance:** Measured, missing and corrected values distinguishable. **Required verification:** API fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0227-03 — Clarify readiness by capability.** **Acceptance:** Play, mix, stems and lyrics may have different states. **Required verification:** Readiness component tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0227-04 — Refine correction workflow.** **Acceptance:** Editable metadata clear, reversible when supported. **Required verification:** Correction E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0227-05 — Protect original files.** **Acceptance:** Metadata edits never rewrite source without approved contract. **Required verification:** Filesystem safety test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0227-06 — Show analysis failures.** **Acceptance:** Reason and recovery are specific and truthful. **Required verification:** Backend failure fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0227-07 — Handle unusual metadata.** **Acceptance:** Long/RTL/null values fit at all widths. **Required verification:** Visual and AT review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0227-08 — Verify song identity continuity.** **Acceptance:** Duplicate titles link to correct recording ID. **Required verification:** Cross-route identity test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0154/0177/0123; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
