# ADR-0147 - Up Next anticipation, transition readiness and audible handoff choreography

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Listen.
- **Related earlier ADRs:** ADR-0121, ADR-0116, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Now.tsx; web/src/ui/seam.ts; web/src/player.ts.

## Context and evidence boundary

A DJ's most memorable moment is often the handoff between songs. Selecta exposes intended and rendered seam status, but the UI must preserve anticipation without claiming a transition is ready before the audio exists. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Describe the current-to-next song connection as a small narrative: current, upcoming, status and optional why.
- Use a countdown in bars only when actual cue data and playback timing support it; otherwise show plain timing or preparation status.
- Show 'planned', 'rendering', 'ready', 'fallback' and 'failed' as distinct visual and spoken states.
- Represent an actively playing transition as one shared handoff between the two song identities, not two independent tracks that appear to play at once.
- A rejected render or fallback does not trigger a false success glow or polished transition animation.
- Keep why-this-transition information optional and distinguish measured checks from human musical quality.

## Interaction choreography and visual behavior

- Next-card attention changes at confirmed transition preparation (≤180 ms surface color) without stealing focus.
- During a real handoff, song identity can dissolve over 160–240 ms after the engine reports its transition; never run independently on an assumed timer.
- Countdown is clock-derived and numerically stable with tabular digits; no beat pulse when precision unavailable.
- Fallback switches status immediately with icon/text and remains readable until the user moves on.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0147-01 - Specify handoff state diagram.** Acceptance: Planned/queued/rendering/ready/playing/fallback/failed each has truthful copy. Required verification: Seam-state fixture matrix. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
2. **MI-0147-02 - Define supported countdowns.** Acceptance: Bars/beats shown only with valid cues and clocks. Required verification: Invalid cue/fallback and timing tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
3. **MI-0147-03 - Design next-card hierarchy.** Acceptance: Upcoming song, arrival expectation and action are first-glance clear. Required verification: Uncoached comprehension study. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
4. **MI-0147-04 - Choreograph real handoff identity.** Acceptance: Visual switch never precedes or lags audible track identity misleadingly. Required verification: Real mixed audio plus screen recording. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/player.ts`; `web/src/views/Now.test.tsx`, `web/src/player.test.ts`; independent checks pending.**
5. **MI-0147-05 - Surface requested vs rendered differences.** Acceptance: Listener can tell chosen and actual move when different. Required verification: Forced fallback test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
6. **MI-0147-06 - Specify error/recovery.** Acceptance: Failed transition provides next action without interrupting continued music. Required verification: Render-failure playback test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
7. **MI-0147-07 - Audit focus and screen reader changes.** Acceptance: No every-beat announcements; current/next identities named once. Required verification: NVDA/Edge live-region review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: handoff states/countdowns/next hierarchy/truth/recovery/announcement behavior mapped in the surface contract to Now/player/inspector fixtures; real-audio review remains open.**
8. **MI-0147-08 - Measure anticipation and trust.** Acceptance: Users know what will happen at the handoff and confidence after listening. Required verification: Task survey with time-stamped observations. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ `b779bd3c` (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a handoff sheet recording each prediction with its playback-clock timestamp and the 1 to 5 confidence after listening, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0147-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: run a task survey with time-stamped observations of handoff anticipation and confidence after listening, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
