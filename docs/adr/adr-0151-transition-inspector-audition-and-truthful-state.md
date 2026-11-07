# ADR-0151 — Transition Inspector: audition-first detail, state truth and precision

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Editor.
- **Related earlier ADRs:** ADR-0121, ADR-0101, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/SeamInspector.tsx; web/src/views/EditorRows.tsx; web/src/ui/seam.ts.

## Context and evidence boundary

A transition can be planned, rendering, rendered differently than requested or failed. A microinteraction that looks 'successful' at request time would mislead the creator about the audio they will hear. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Lead inspector with the audible result and pair identity; keep Change, Studio and Details available without crowding first view.
- Requested move, in-progress render and rendered/fallback move must have distinct labels and persistent inspectable evidence.
- Changing a technique highlights pending intent, but only marks a result ready when an exact seam key is confirmed.
- Previewing a transition uses one audio owner and never starts unrelated main playback unexpectedly.
- For unavailable techniques, give cause, alternatives and no hover-only reason.
- Detailed cue selection remains precise and accessible on narrow/keyboard layouts.

## Interaction choreography and visual behavior

- Tab changes 100–160 ms focus-preserving reveal; no panel slide that hides an active preview control.
- Pending technique chip immediately acknowledges intent but uses a queued/working marker, not ready/glow.
- New seam render replaces old preview only after matching key, with short ≤160 ms textual state transition.
- Preview progress follows actual audio; no waveform animation if no clip was successfully rendered.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0151-01 — Design audition-first inspector hierarchy.** Acceptance: Pair, actual heard move and Play visible before diagnostics. Required verification: Transition-edit comprehension test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0151-02 — Specify requested/rendered taxonomy.** Acceptance: Fallback, missing source and failed render differ in words/icons. Required verification: Seam status matrix. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0151-03 — Guard stale technique changes.** Acceptance: Older render cannot replace latest chosen seam key. Required verification: Rapid change race test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0151-04 — Preserve exact preview ownership.** Acceptance: No overlapping player, correct resume and explicit manual Pause authority. Required verification: Real audio and focus tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0151-05 — Explain disabled moves.** Acceptance: Why unavailable readable to keyboard/touch/AT. Required verification: Disabled choice semantic review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0151-06 — Design cue editor feedback.** Acceptance: Phrase, entry, exit and length changes show committed/pending states. Required verification: Cue control keyboard tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0151-07 — Handle narrow inspector sheet.** Acceptance: Selection context and focus retained across open/close/revision. Required verification: 320px and deleted seam fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0151-08 — Validate sound correspondence.** Acceptance: Displayed technique matches actual resulting transition across samples. Required verification: Human A/B audition with exact SHA. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
