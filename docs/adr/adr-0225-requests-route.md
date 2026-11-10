# ADR-0225 - Requests as visible musical intentions and consented bridge routes

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started or needing a person; updated 2026-11-10).
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

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0225-01 - Design request lifecycle.** **Acceptance:** Asked, searching, waiting, ready, placed, rejected distinct. **Required verification:** Lifecycle fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/RequestsJoining.test.tsx` (joining, bridge, timeline states) and `web/src/views/Requests.test.tsx` 'says when it has to be analysed first', 'is plain about a song it can't place'; `tests/test_request_planner.py::test_a_song_still_being_analysed_is_told_apart_from_one_that_cannot_be_placed` (2026-11-10).
2. **SF-0225-02 - Show real selected target.** **Acceptance:** Correct library identity and repeat handling. **Required verification:** Duplicate song tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Requests.test.tsx` 'won't let a song be asked for twice, or one already in the mix', 'notices a song already in the mix'; `tests/test_requests.py::test_locks_custom_seams_duplicates_and_no_current_mix`; `web/e2e/integration.e2e.ts` 'two requests at once: no song goes in twice' (2026-11-10).
3. **SF-0225-03 - Visualize candidate route.** **Acceptance:** Only actual returned extra songs represented. **Required verification:** Bridge fixture. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/RequestsJoining.test.tsx` 'shows the best first, how it gets there, and why'; `web/src/ui/MusicObjects.test.tsx` 'shows only returned ordered route songs'; `tests/test_request_routes.py::test_finding_a_bridge_lists_what_it_found` (2026-11-10).
4. **SF-0225-04 - Make consent unmistakable.** **Acceptance:** User sees precise proposed additional tracks. **Required verification:** Uncoached consent test. **Implementation:** Needs a person: uncoached consent test. Automated part: `web/src/views/Requests.test.tsx` 'names the extra song and asks' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0225-05 - Preserve atomic insert.** **Acceptance:** All approved bridges apply or none. **Required verification:** Backend error E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_requests.py::test_ready_insertion_is_atomic_and_rejects_stale_or_unapproved_plans`; `tests/test_request_routes.py::test_when_it_does_they_all_come_in_at_once_as_one_step`; `web/src/views/Requests.test.tsx` 'puts the request back if it can't be added' (2026-11-10).
6. **SF-0225-06 - Handle stale/cancel states.** **Acceptance:** No old response can alter newer request. **Required verification:** Race tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/integration.e2e.ts` 'a cancelled request that's answered late doesn't come back'; `web/src/views/Requests.test.tsx` 'a slow poll can't bring back something just cancelled', 'two picks close together both stay' (2026-11-10).
7. **SF-0225-07 - Provide accessible route list.** **Acceptance:** Full route details reachable without graphic. **Required verification:** NVDA and zoom tests. **Implementation:** Needs a person: NVDA and 400% zoom review of the route list; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0225-08 - Evaluate confidence.** **Acceptance:** Listeners predict whether/when request might play. **Required verification:** Real session observation. **Implementation:** Needs a person: real session observation of request confidence; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0148/0175/0124 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 0/8 Implemented, 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
