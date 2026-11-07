# ADR-0162 — Animation performance budgets, audio continuity and long-session stability

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Performance.
- **Related earlier ADRs:** ADR-0111, ADR-0133, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/player.ts; web/src/App.tsx; web/src/styles/creation.css; web/src/views/Library.tsx.

## Context and evidence boundary

Selecta may render audio and analyze tracks while the UI animates. A pleasing interaction that causes dropped playback, long tasks or warm laptop fans defeats the purpose of a calm music experience. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Define named hardware and browser budgets for frame times, input response, memory and audio gaps; never equate browser interaction metrics with DSP latency.
- Prefer compositor-only transform/opacity for cosmetic motion, and update real progress at a sensible cadence.
- Pause hidden or offscreen visualizers, avoid app-wide rerenders from frequent song-time ticks and honor reduced motion.
- Benchmark 20,000-song Library, 100-song Editor, 64-cell Studio, many requests and overlapping background jobs.
- Prioritize uninterrupted audio and exact revision/state safety over high-frame-rate visuals.
- Provide graceful degradation to still visuals under load without presenting the degraded mode as an audio failure.

## Interaction choreography and visual behavior

- Default non-audio animation budget targets 60 fps on named reference hardware; record actual p95 frame time and dropped frames rather than claim success.
- If long tasks or repeated dropped frames occur, reduce or suspend visual decoration without delaying transport/control state.
- Avoid layout animation in paginated/contained rows; no repeated full-page reflow from numeric progress updates.
- All animation stops when page hidden unless required by actual playback state; audio scheduling remains independent.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0162-01 — Specify reference hardware matrix.** Acceptance: CPU/GPU/OS/browser/power mode recorded for every benchmark. Required verification: Benchmark protocol review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0162-02 — Profile main thread and frame costs.** Acceptance: Animation doesn't create long tasks or meaningful INP regression. Required verification: Performance recording with p95 frame timing. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0162-03 — Profile audio scheduling under load.** Acceptance: Background renders and UI interaction do not produce unexpected gap/overlap. Required verification: Captured real audio and CPU load test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0162-04 — Stress large Library.** Acceptance: 20k songs, search/filter and scroll remain usable. Required verification: Synthetic and real dataset benchmarks. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0162-05 — Stress long Editor and Studio.** Acceptance: 100 songs and 64 cells maintain focus/render performance. Required verification: Trace and keyboard tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0162-06 — Define graceful visual downgrade.** Acceptance: Low power/hidden/reduced motion disable nonessential frames. Required verification: Visibility and resource measurements. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0162-07 — Prevent layout shift of controls.** Acceptance: Current song/time/status updates keep stable transport targets. Required verification: CLS and visual diff review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0162-08 — Publish exact measured results.** Acceptance: No claimed benchmark pass without machine, SHA, trace and limitations. Required verification: Independent quality ledger. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
