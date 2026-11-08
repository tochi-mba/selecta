# ADR-0223 — Stem Studio as a truthful two-song musical canvas

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Studio.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0152/0174/0122; no earlier status changed.
- **Existing source touchpoints:** web/src/views/Studio.tsx; web/src/studio.ts.

## Context and evidence boundary

Keep eight independent song-part lanes (voices, drums, bass, melody for each song), 8–64-step grid and Shape/Grid/List views, but make parts and position visually tangible. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Keep eight independent song-part lanes (voices, drums, bass, melody for each song), 8–64-step grid and Shape/Grid/List views, but make parts and position visually tangible. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No fake stems, missing lanes, hidden recovery, accidental repeated cell toggle or preview that overlaps Listen. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0223-01 — Define lane anatomy and identity.** **Acceptance:** Eight parts and both source songs always explicit. **Required verification:** Studio state fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0223-02 — Redesign grid presentation.** **Acceptance:** 8–64 cells and playhead intelligible. **Required verification:** Large-grid visual test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0223-03 — Refine direct cell painting.** **Acceptance:** Each intended cell toggled once per stroke. **Required verification:** Pointer E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0223-04 — Provide keyboard and list parity.** **Acceptance:** No drag-only editing behavior. **Required verification:** NVDA/keyboard tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0223-05 — Support Shape/Grid/List transitions.** **Acceptance:** Switching modes preserves exact arrangement. **Required verification:** Mode-state regression. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0223-06 — Represent actual stem readiness.** **Acceptance:** Missing/separating/applied/rendered distinct. **Required verification:** Backend fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0223-07 — Protect focus during preview.** **Acceptance:** One audio owner with clear return to Listen. **Required verification:** Audio ownership tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0223-08 — Validate creative legibility.** **Acceptance:** Beginners and producers can identify parts and edit. **Required verification:** User study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0152/0174/0122 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
