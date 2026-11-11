# ADR-0141 - First run, library readiness and the first audible reward

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 6/8 Implemented, 0/8 In progress, 2 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Onboarding.
- **Related earlier ADRs:** ADR-0126, ADR-0096, ADR-0134; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Start.tsx; web/src/views/Setup.tsx; web/src/views/WorkshopPanels.tsx.

## Context and evidence boundary

The current browser-first/local-server architecture requires an absolute path and local analysis. The UX challenge is converting technically accurate progress into anticipation of the first listen without pretending processing is instantaneous. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Keep typed local paths and precise safety/permission errors; exclude native pickers, installers, cloud uploads and remote-account onboarding.
- Make the purpose of the folder input explicit with OS-appropriate examples and no implied access outside the local server.
- Celebrate genuine milestones only: folder accepted, music found, enough songs ready, first mix playable; never fake a progress percentage.
- Separate discovered songs, analyzed songs, timed lyrics and mix-ready songs with explanations tied to what the listener can do next.
- Give a first-play action as soon as readiness is genuinely achieved while background work continues nonintrusively.
- When interrupted, preserve accepted sources and explain whether the scan, analysis or server-not original files-was affected.

## Interaction choreography and visual behavior

- Folder submission responds within one frame with locked duplicate-submit and stable copy.
- Count increases use gentle numeric update ≤160 ms only on real new data; no rolling counter that suggests fabricated progress.
- At six mix-ready songs, an accessible ready cue appears once, with no auto-play or focus steal.
- In reduced motion, progress labels and milestones update instantly with the same meaning.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 2 source-level Implemented, 0 independently Verified

1. **MI-0141-01 - Prototype folder-entry teaching.** Acceptance: Path examples, server access and LRCLIB metadata disclosure are truthful. Required verification: Windows/macOS/Linux source review and first-use testing. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Mixes.tsx`, `web/src/views/WorkshopPanels.tsx`; `web/src/views/Mixes.test.tsx`, `web/src/views/Setup.test.tsx`; independent checks pending.**
2. **MI-0141-02 - Define four readiness labels.** Acceptance: Music found, analyzed, lyrics and mix-ready cannot be conflated. Required verification: Real status fixtures and uncoached comprehension. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: central readiness taxonomy in `web/src/state/readiness.ts` with API and Library fixtures; uncoached comprehension remains open.**
3. **MI-0141-03 - Specify progress microstates.** Acceptance: Scanning, stopped, retry, missing folder and server failure each get recoverable response. Required verification: Injected failure and cancellation tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: separate scan/analysis/readiness progress states in Start, Mixes and Workspace.**
4. **MI-0141-04 - Create first-ready milestone.** Acceptance: Play becomes available only at actual minimum readiness and never auto-starts. Required verification: Synthetic library threshold and live audio test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Mixes.tsx`, `web/src/views/WorkshopPanels.tsx`; `web/src/views/Mixes.test.tsx`, `web/src/views/Setup.test.tsx`; independent checks pending.**
5. **MI-0141-05 - Preserve original-file reassurance.** Acceptance: Copy states read-only guarantees without promising all network isolation. Required verification: Filesystem/privacy review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: original-file/local-audio reassurance and separate lyric-metadata disclosure in first-run/source copy.**
6. **MI-0141-06 - Handle restarts and resumed analysis.** Acceptance: Previously accepted folder and progress retain truth after reload. Required verification: Restart/scan resume E2E. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: authoritative restart/reload status and resumed-analysis reporting without fabricated completion.**
7. **MI-0141-07 - Audit first screen on touch and zoom.** Acceptance: Path input, validation and action remain visible under keyboard. Required verification: Mobile and 200/400% zoom test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: -; evidence: -.**
8. **MI-0141-08 - Measure time to first sound.** Acceptance: Record setup completion, abandonment, first rendered audible seam and satisfaction. Required verification: Observed first-run trial with real music and hardware. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: -; evidence: Needs a person: observe a first-run trial on real music and hardware and record setup completion, abandonment, time to the first audible seam and satisfaction (checked 2026-11-10; no human evidence recorded yet).**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
