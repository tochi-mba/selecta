# ADR-0146 - Lyric focus, Stage immersion and real audio-reactive visuals

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Listen.
- **Related earlier ADRs:** ADR-0098, ADR-0116, ADR-0132; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Now.tsx; web/src/styles/listening.css; web/src/App.tsx.

## Context and evidence boundary

Timed words, bars and Stage mode create an unusually expressive listening surface. Motion must reflect data, remain legible from across the room and never distract from actual musical phrasing. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Highlight the current lyric phrase or word only when synchronization is known; show unsynchronized lyrics as static text.
- Keep a stable lyric reading window and avoid compulsive scroll on every word; allow voluntary manual scroll without being pulled back.
- Stage hides shell chrome while retaining explicit Play/Pause, exit and error recovery; fullscreen failure falls back gracefully.
- Stage controls are visible/reachable and cannot vanish before keyboard or touch users can exit.
- Waveform/visualizer values originate from real audio analysis or analyser output; artistic motion cannot masquerade as an audio measurement.
- Provide a still, high-contrast lyric experience when reduced motion or low performance is requested.

## Interaction choreography and visual behavior

- Lyric line emphasis crossfades 120–200 ms with no automatic horizontal marquee; active word uses a still highlight in reduced motion.
- Auto-follow moves only between lines at a bounded pace (prefer ≤240 ms) and pauses when the user manually scrolls.
- Stage entry/exit ≤240 ms crossfade; browser fullscreen result determines actual UI state, not an optimistic assumption.
- Visualizer frame rate adapts to visibility and preferences; no strobe, large flash or rapid full-screen color inversion.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 3 source-level Implemented, 0 independently Verified

1. **MI-0146-01 - Specify timed lyric semantics.** Acceptance: Current line/word only when cue accuracy known; missing lyrics remain honest. Required verification: Missing/late/RTL lyrics fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: timed-lyric fallbacks, Stage hierarchy, fullscreen fallback and reachable controls mapped in the surface contract to Now/App fixtures; human comfort review remains open.**
2. **MI-0146-02 - Design manual lyric interruption.** Acceptance: User scrolling pauses follow and preserves reading position. Required verification: Touch and keyboard reading test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
3. **MI-0146-03 - Prototype Stage hierarchy.** Acceptance: Song, current lyric, next handoff and exit legible at distance. Required verification: TV/laptop/phone observational review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: timed-lyric fallbacks, Stage hierarchy, fullscreen fallback and reachable controls mapped in the surface contract to Now/App fixtures; human comfort review remains open.**
4. **MI-0146-04 - Handle fullscreen refusal.** Acceptance: Fallback stage and exit/focus restoration work. Required verification: Browser permission-denied E2E. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: timed-lyric fallbacks, Stage hierarchy, fullscreen fallback and reachable controls mapped in the surface contract to Now/App fixtures; human comfort review remains open.**
5. **MI-0146-05 - Define true visualizer signals.** Acceptance: No invented waveform, false beat grid or misleading spectrum values. Required verification: Audio fixtures and analyser inspection. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
6. **MI-0146-06 - Protect reduced motion and contrast.** Acceptance: Static representation conveys same song/timing information. Required verification: OS toggle, forced-colors and accessibility review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/Now.test.tsx`; independent checks pending.**
7. **MI-0146-07 - Keep media controls reachable.** Acceptance: Transport and exit remain focusable on every supported viewport. Required verification: 320px and landscape keyboard/touch tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: timed-lyric fallbacks, Stage hierarchy, fullscreen fallback and reachable controls mapped in the surface contract to Now/App fixtures; human comfort review remains open.**
8. **MI-0146-08 - Validate immersive comfort.** Acceptance: Participants can stay immersed without distraction or excessive lyric movement. Required verification: Real listening session with recorded feedback. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a counterbalanced Stage sheet (with and without lyrics) recording immersion, distractions, lyric movement and comfort, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0146-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: run a real listening session with recorded feedback on immersion and lyric movement, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
