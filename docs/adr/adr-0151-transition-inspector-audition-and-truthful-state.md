# ADR-0151 - Transition Inspector: audition-first detail, state truth and precision

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Editor.
- **Related earlier ADRs:** ADR-0121, ADR-0101, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/SeamInspector.tsx; web/src/views/EditorRows.tsx; web/src/ui/seam.ts.

## Context and evidence boundary

A transition can be planned, rendering, rendered differently than requested or failed. A microinteraction that looks 'successful' at request time would mislead the creator about the audio they will hear. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

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

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0151-01 - Design audition-first inspector hierarchy.** Acceptance: Pair, actual heard move and Play visible before diagnostics. Required verification: Transition-edit comprehension test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
2. **MI-0151-02 - Specify requested/rendered taxonomy.** Acceptance: Fallback, missing source and failed render differ in words/icons. Required verification: Seam status matrix. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
3. **MI-0151-03 - Guard stale technique changes.** Acceptance: Older render cannot replace latest chosen seam key. Required verification: Rapid change race test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
4. **MI-0151-04 - Preserve exact preview ownership.** Acceptance: No overlapping player, correct resume and explicit manual Pause authority. Required verification: Real audio and focus tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/audio/focus.ts`, `web/src/views/SeamInspector.tsx`; `web/src/audio/focus.test.tsx`, `web/src/views/Mix.test.tsx`; independent checks pending.**
5. **MI-0151-05 - Explain disabled moves.** Acceptance: Why unavailable readable to keyboard/touch/AT. Required verification: Disabled choice semantic review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
6. **MI-0151-06 - Design cue editor feedback.** Acceptance: Phrase, entry, exit and length changes show committed/pending states. Required verification: Cue control keyboard tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
7. **MI-0151-07 - Handle narrow inspector sheet.** Acceptance: Selection context and focus retained across open/close/revision. Required verification: 320px and deleted seam fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: audition hierarchy, truth taxonomy, stale guards, disabled reasons, cue feedback and narrow context mapped in the surface contract to SeamInspector/Mix fixtures.**
8. **MI-0151-08 - Validate sound correspondence.** Acceptance: Displayed technique matches actual resulting transition across samples. Required verification: Human A/B audition with exact SHA. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a blind A/B audition sheet whose shown-technique labels are shuffled per listener into a separate key file, recording yes, no or unsure, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0151-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: a person runs an A/B audition confirming the displayed technique matches the rendered transition, on an exact SHA, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
