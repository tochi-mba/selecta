# ADR-0144 - Listen as an immersive musical scene: song identity, ambient visuals and restraint

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Listen.
- **Related earlier ADRs:** ADR-0116, ADR-0098, ADR-0130; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Now.tsx; web/src/styles/listening.css; web/src/player.ts.

## Context and evidence boundary

Listen should be emotionally compelling while staying calm. Song and artist identity, lyrics, timing and Next are more valuable than decorative effects. The current palette and visualizer can support a music-led experience if tied to authentic playback data. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Make current song/artist the first-glance focal point, followed by transport and the next musical moment.
- Use a restrained ambient color field derived from theme and verified song context only; avoid invented cover art and genre-color inference.
- Allow user-selectable visual intensity (quiet, standard, focused) without changing audio or musical choices.
- Visualizers must use real audio analysis and pause when audio is paused, screen hidden or motion reduction requested.
- Long/RTL/multilingual song metadata must not cause jumpy layout; preserve readable full titles and screen-reader identity.
- Offer an optional low-distraction lyric/visual focus rather than putting every DJ control in the initial viewport.

## Interaction choreography and visual behavior

- Song identity updates with one ≤200 ms crossfade after playback actually changes; no temporal mismatch with audio.
- Ambient treatment reacts at most 10–15 fps, low opacity, and is frozen/static in reduced motion; never flashes rapidly.
- Dynamic background must not lower text contrast in dark/light/system or forced colors.
- Opening DJ controls gently reveals options ≤180 ms without scrolling away from the transport.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 5 source-level Implemented, 0 independently Verified

1. **MI-0144-01 - Compose first-glance Listen hierarchy.** Acceptance: Song, artist, playback and next handoff legible without scrolling on baseline viewports. Required verification: Real-metadata visual study. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Listen first-glance and responsive hierarchy mapped in the surface contract to `Now.tsx` and listening CSS.**
2. **MI-0144-02 - Specify ambient color safeguards.** Acceptance: No color-from-genre claims, fabricated artwork or contrast reduction. Required verification: Dark/light/forced-colors computed checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
3. **MI-0144-03 - Define visualizer truth.** Acceptance: Only actual analyser/clock drives motion, no invented beat bars. Required verification: Muted, paused and missing-audio fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
4. **MI-0144-04 - Handle long/RTL titles.** Acceptance: Song change does not cause critical controls to jump or truncate accessible name. Required verification: Long metadata screenshot and AT review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
5. **MI-0144-05 - Control visual intensity.** Acceptance: User preference reversible, only affects presentation, never audio engine. Required verification: Preference and theme regression. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
6. **MI-0144-06 - Specify responsive composition.** Acceptance: Lyrics/visualizer/transport remain reachable over mini-player and navigation. Required verification: 320/375/430/short-height/zoom testing. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Listen first-glance and responsive hierarchy mapped in the surface contract to `Now.tsx` and listening CSS.**
7. **MI-0144-07 - Define reduced motion Listen.** Acceptance: Same current song/next/ready info remains in static state. Required verification: Live preference toggle and screen-reader test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
8. **MI-0144-08 - Measure listener distraction.** Acceptance: Can identify song/next and keep listening without repeated screen attention. Required verification: Observed listening session and perceived calm rating. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 (uncommitted, 2026-11-12); evidence: code part built on 2026-11-12: a listening sheet recording named song, named next, screen glances and a 1 to 5 calm rating, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0144-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: observe a listening session: can listeners name the song and what is next without repeated screen attention, plus a calm rating, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
