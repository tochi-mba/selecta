# ADR-0146 — Lyric focus, Stage immersion and real audio-reactive visuals

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Listen.
- **Related earlier ADRs:** ADR-0098, ADR-0116, ADR-0132; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Now.tsx; web/src/styles/listening.css; web/src/App.tsx.

## Context and evidence boundary

Timed words, bars and Stage mode create an unusually expressive listening surface. Motion must reflect data, remain legible from across the room and never distract from actual musical phrasing. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

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

## Implementation tasks — all Not started, none Verified

1. **MI-0146-01 — Specify timed lyric semantics.** Acceptance: Current line/word only when cue accuracy known; missing lyrics remain honest. Required verification: Missing/late/RTL lyrics fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0146-02 — Design manual lyric interruption.** Acceptance: User scrolling pauses follow and preserves reading position. Required verification: Touch and keyboard reading test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0146-03 — Prototype Stage hierarchy.** Acceptance: Song, current lyric, next handoff and exit legible at distance. Required verification: TV/laptop/phone observational review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0146-04 — Handle fullscreen refusal.** Acceptance: Fallback stage and exit/focus restoration work. Required verification: Browser permission-denied E2E. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0146-05 — Define true visualizer signals.** Acceptance: No invented waveform, false beat grid or misleading spectrum values. Required verification: Audio fixtures and analyser inspection. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0146-06 — Protect reduced motion and contrast.** Acceptance: Static representation conveys same song/timing information. Required verification: OS toggle, forced-colors and accessibility review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0146-07 — Keep media controls reachable.** Acceptance: Transport and exit remain focusable on every supported viewport. Required verification: 320px and landscape keyboard/touch tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0146-08 — Validate immersive comfort.** Acceptance: Participants can stay immersed without distraction or excessive lyric movement. Required verification: Real listening session with recorded feedback. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
