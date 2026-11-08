# ADR-0231 — Export Studio: frozen revision, honest render progress and finished artifact

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Export.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0157/0181/0127; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/ExportPanel.tsx; web/src/views/ExportJobs.tsx; web/src/views/exportStore.ts.

## Context and evidence boundary

Export should feel like finishing a creative work but remain a reliable exact-revision background job. Show frozen input identity, truthful processing, failure and decodable FLAC outcome. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Export should feel like finishing a creative work but remain a reliable exact-revision background job. Show frozen input identity, truthful processing, failure and decodable FLAC outcome. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No fake percentage, output from the wrong draft, implied finished artifact when job is pending or non-decodable file. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0231-01 — Show frozen revision before export.** **Acceptance:** Selected mix ID and revision explicitly confirmed. **Required verification:** Snapshot fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0231-02 — Design job phase visualization.** **Acceptance:** Queued, rendering, finalizing, done and failed accurate. **Required verification:** Backend job tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0231-03 — Display only real progress.** **Acceptance:** Indeterminate used when no reliable percentage. **Required verification:** Slow-job and no-progress tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0231-04 — Protect edit during export.** **Acceptance:** Changes after submission cannot mutate existing job. **Required verification:** Concurrent edit E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0231-05 — Handle cancel/retry safely.** **Acceptance:** Actions reflect actual backend semantics. **Required verification:** Cancel failure tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0231-06 — Present finished artifact.** **Acceptance:** Real path, format, metadata and next action correct. **Required verification:** FLAC decode and metadata validation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0231-07 — Design failure recovery.** **Acceptance:** Specific cause and retry do not lose context. **Required verification:** Corrupt/storage-full fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0231-08 — Evaluate finishing moment.** **Acceptance:** Artistic completion never sacrifices job truth. **Required verification:** User and music output review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0157/0181/0127; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
