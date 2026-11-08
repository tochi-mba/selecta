# ADR-0225 — Requests as visible musical intentions and consented bridge routes

- **Decision:** Proposed (owner decision pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Requests.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0148/0175/0124; no earlier status changed.
- **Existing source touchpoints:** web/src/views/Requests.tsx; web/src/views/RequestsJoining.test.tsx.

## Context and evidence boundary

Represent requested track, actual candidate route and preparation status without claiming playback. Any extra bridge songs require explicit approval and all-or-none insertion by backend. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Represent requested track, actual candidate route and preparation status without claiming playback. Any extra bridge songs require explicit approval and all-or-none insertion by backend. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No duplicate request IDs, phantom bridge route, partial insertion or consent via visual suggestion alone. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0225-01 — Design request lifecycle.** **Acceptance:** Asked, searching, waiting, ready, placed, rejected distinct. **Required verification:** Lifecycle fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0225-02 — Show real selected target.** **Acceptance:** Correct library identity and repeat handling. **Required verification:** Duplicate song tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0225-03 — Visualize candidate route.** **Acceptance:** Only actual returned extra songs represented. **Required verification:** Bridge fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0225-04 — Make consent unmistakable.** **Acceptance:** User sees precise proposed additional tracks. **Required verification:** Uncoached consent test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0225-05 — Preserve atomic insert.** **Acceptance:** All approved bridges apply or none. **Required verification:** Backend error E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0225-06 — Handle stale/cancel states.** **Acceptance:** No old response can alter newer request. **Required verification:** Race tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0225-07 — Provide accessible route list.** **Acceptance:** Full route details reachable without graphic. **Required verification:** NVDA and zoom tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0225-08 — Evaluate confidence.** **Acceptance:** Listeners predict whether/when request might play. **Required verification:** Real session observation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0148/0175/0124 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Proposed, 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
