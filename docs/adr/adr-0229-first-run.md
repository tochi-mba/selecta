# ADR-0229 — First-run library awakening with honest local filesystem and first play

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Onboarding.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0141/0178/0126; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/Start.tsx; web/src/views/Setup.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

A new listener should reach six genuinely ready local songs and a first convincing real handoff. Retain server-path entry instead of claiming a browser folder picker can supply a server filesystem path. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

A new listener should reach six genuinely ready local songs and a first convincing real handoff. Retain server-path entry instead of claiming a browser folder picker can supply a server filesystem path. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No invented progress, silent LRCLIB metadata disclosure omission, upload implication or autoplay before explicit intent. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0229-01 — Design local setup explanation.** **Acceptance:** User understands browser/server folder relationship. **Required verification:** First-time comprehension test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0229-02 — Refine path validation.** **Acceptance:** Missing/invalid/disallowed folders show accurate reason. **Required verification:** Local path fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0229-03 — Explain lyrics metadata lookup.** **Acceptance:** Artist/title/album/duration exposure disclosed. **Required verification:** Privacy review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0229-04 — Design actual library awakening.** **Acceptance:** Discovered, analyzed and playable counts separate. **Required verification:** Live scan state tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0229-05 — Honor six-ready-song threshold.** **Acceptance:** First mix offered only when eligible. **Required verification:** Readiness E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0229-06 — Handle slow or interrupted scan.** **Acceptance:** Resume/retry never pretend completed work. **Required verification:** Offline/interrupt tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0229-07 — Make first play obvious.** **Acceptance:** One safe action and accessible audio expectations. **Required verification:** Novice task study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0229-08 — Evaluate first handoff milestone.** **Acceptance:** Actual audio audition plus understanding measured. **Required verification:** Uncoached real-music session. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0141/0178/0126; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
