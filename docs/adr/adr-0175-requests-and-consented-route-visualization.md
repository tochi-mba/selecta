# ADR-0175 - Requests: visible musical routes, ghost placement and bridge consent

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 6/7 Implemented, 0/7 In progress, 1/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Engage.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0148, ADR-0124, ADR-0103; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Requests.tsx; web/src/views/Now.tsx; web/src/views/EditorRows.tsx.

## Context and evidence boundary

Requesting a track is a musical placement problem, not merely an item in a queue. The current request state machine and explicit atomic bridge approval are strong; a real route diagram can make these results understandable without exposing imaginary search candidates or changing consent.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Accepted decision

- Represent the user's desired track as a persistent intent distinct from a proposed timeline position or playable song.
- Use an ordered route graphic for real returned bridge steps, with exact source/target identities.
- Mark a position as provisional until every required transition is confirmed ready.
- Keep full explicit approval for extra songs and the Play it anyway warning about rough transitions.
- Connect accepted placements visually to the editor's real sequence after authoritative confirmation.
- Prioritize actionable requests and avoid turning the listener's view into a job manager.

## Visual, animation and microinteraction contract

- Never animate a candidate bridge before the backend returns real song IDs.
- Approval causes one atomic visual join; no partly inserted route or premature ready signal.
- Blue request semantics include accessible text, not color alone.

## Alternatives and trade-offs

Prefer the existing restrained and proven UI when added visuals distract or reduce correctness. No artificial music, artwork, beat, lyric accuracy, quality score or fake render status. All sensory interactions require a usable static, keyboard, high-contrast and reduced-motion alternative. Source truth and explicit human consent outrank polish.

## Implementation checklist - 6/7 Implemented, 0/7 Verified

1. **CI-0175-01 - Specify intent/position/ready visual states.** **Acceptance:** User can distinguish requested, proposed and audible states. **Required verification:** State-machine and screen-reader fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Requests.test.tsx "says requested", "says where it will go and how long it will take", "uses the fresh playhead before adding a ready request, and says where it went" (vitest, passed 2026-11-10).
2. **CI-0175-02 - Design direct versus bridge route graphic.** **Acceptance:** Only returned ordered songs and valid edges shown. **Required verification:** Bridge search and unavailable-route tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/ui/MusicObjects.test.tsx "shows only returned ordered route songs, and never implies a proposed path has joined"; web/src/views/Requests.test.tsx "names the extra song when it says where a request will go", "says which request a bridge is for" (vitest, passed 2026-11-10).
3. **CI-0175-03 - Add provisional timeline representation.** **Acceptance:** Ghost position cannot be confused with a ready playable transition. **Required verification:** Editor and request integration fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "show up faded in the timeline at the place they’re going", "take over from the transition they’ll replace, which comes back if they’re cancelled", "aren’t shown on a draft" (vitest, passed 2026-11-10).
4. **CI-0175-04 - Preserve approval and atomic insert.** **Acceptance:** No extra bridge track inserted before consent or only partially. **Required verification:** Server race, approve/decline and multi-tab tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Requests.test.tsx "names the extra song and asks", "allows only one bridge decision while its server response is pending", "saying no stops asking and says what happens now" (vitest, passed 2026-11-10); web/e2e/integration.e2e.ts "two requests at once: no song goes in twice and no two share a spot" (Playwright, passed 2026-11-10).
5. **CI-0175-05 - Clarify force and cancel operations.** **Acceptance:** Rough transition consequences and cancel focus are obvious. **Required verification:** Play anyway, cancel error and recoverability audit. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Requests.test.tsx "is offered when nothing fits, and goes straight in", "keeps it on the list if cancelling fails, and says so", "a cancel that fails puts the request back" (vitest, passed 2026-11-10); web/e2e/finishing.e2e.ts "the keyboard alone can request a song, cancel it, and get back to where it was" (Playwright, passed 2026-11-10).
6. **CI-0175-06 - Prevent stale/duplicate request feedback.** **Acceptance:** Late/failed search cannot visually add wrong track twice. **Required verification:** Idempotency and offline replay tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Requests.test.tsx "won’t let a song be asked for twice, or one already in the mix", "two picks close together both stay, whichever answer comes back first", "a slow poll can’t bring back something just cancelled" (vitest, passed 2026-11-10); web/e2e/integration.e2e.ts "a cancelled request that’s answered late doesn’t come back" (Playwright, passed 2026-11-10).
7. **CI-0175-07 - Measure listener trust in bridge plan.** **Acceptance:** Users understand why extra songs appear and when desired song will play. **Required verification:** Uncoached real-audio request study. **Implementation:** Needs a person: uncoached real-audio request study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0148, ADR-0124, ADR-0103; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Accepted; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
