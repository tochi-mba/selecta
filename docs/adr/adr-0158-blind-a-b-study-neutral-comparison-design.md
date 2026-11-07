# ADR-0158 — Blind listening studies: neutral feedback, fair comparison and no visual bias

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Listening research.
- **Related earlier ADRs:** ADR-0129, ADR-0109, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Listening.tsx; web/src/audio/focus.ts.

## Context and evidence boundary

The listening-study interface must not favor one render through layout, color, timing or animation. Assessment validity matters more than visual delight on this surface. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Versions A and B have identical control size, color, prominence, microinteractions and accessible naming.
- Condition/method/renderer identity stays hidden from the DOM, announcements and timing cues; order assignment remains study-controlled.
- Preference is unlocked only after both clips are actually audible where required; Cannot judge remains possible after failure.
- Quality scales, issue tags, Tie and Cannot judge present equal semantic legitimacy without nudging toward a favored outcome.
- Each submitted answer binds to the exact study, listener, pair and trial identity even under retries.
- No AI-like loading spectacle, celebratory approval animation or colored ranking that would prime an answer.

## Interaction choreography and visual behavior

- A/B transport feedback identical 100–140 ms and no accent differences between columns.
- Progress and played-state indicators reflect actual audible playback, not press alone.
- Submission acknowledges once with neutral 160 ms status change; advance only after exact answer confirmation.
- Reduced motion uses the same neutral labels and equal spatial geometry.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0158-01 — Audit visual condition masking.** Acceptance: A/B modes have identical styling and DOM/accessibility method anonymity. Required verification: Rendered HTML and screenshot comparison. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0158-02 — Specify identical audio transport.** Acceptance: Switching clips cannot overlap or surprise-resume main mix. Required verification: Audio focus fixture. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0158-03 — Guard heard-state eligibility.** Acceptance: A button click without audio cannot unlock preference. Required verification: Unavailable clip and media readiness tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0158-04 — Balance preference controls.** Acceptance: Tie, cannot judge and both versions treated neutrally. Required verification: Researcher protocol and visual review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0158-05 — Preserve response identity.** Acceptance: Retries do not duplicate or mutate earlier exact trials. Required verification: API idempotency tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0158-06 — Design neutral issue tags.** Acceptance: Issue inputs do not prime quality or reveal hidden method. Required verification: Human study pilot. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0158-07 — Handle interruptions honestly.** Acceptance: Browser reload/failed clip preserves trial or exposes nonjudgment. Required verification: Recovery and keyboard tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0158-08 — Validate study evidence.** Acceptance: Analyze sequence/order effects, sample count and raw responses without superiority claims. Required verification: Counterbalanced research report. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
