# ADR-0214 — Truthful playback time, waveform and seek interactions

- **Decision:** Proposed; owner acceptance pending.
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0145/0170/0101; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/player.ts.

## Context and evidence boundary

Separate seek preview from committed time, display peaks only from real audio, and explain protected seam regions. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Separate seek preview from committed time, display peaks only from real audio, and explain protected seam regions. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

No synthetic waveforms, fake successful seek or fabricated beat markers. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0214-01 — Define clock semantics.** **Acceptance:** Time, unknown and remaining from real player. **Required verification:** Clock tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0214-02 — Redesign seek surface.** **Acceptance:** Touch and keyboard targets robust. **Required verification:** Touch/AT E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0214-03 — Show ghost scrub position.** **Acceptance:** Proposed pointer distinct from accepted position. **Required verification:** Rejected seek test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0214-04 — Explain blocked seams.** **Acceptance:** Seek restriction reason clear. **Required verification:** Seam audio tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0214-05 — Validate peak provenance.** **Acceptance:** Waveform derived from actual data. **Required verification:** Source test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0214-06 — Show trusted markers.** **Acceptance:** Cue/section only when known. **Required verification:** Partial-analysis fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0214-07 — Measure scrub responsiveness.** **Acceptance:** No audio dropout under rapid gesture. **Required verification:** Hardware trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0214-08 — Test seek understanding.** **Acceptance:** Users distinguish preview versus commit. **Required verification:** Uncoached task. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0145/0170/0101, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
