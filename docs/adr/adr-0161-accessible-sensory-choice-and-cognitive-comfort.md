# ADR-0161 - Accessible sensory choice, cognitive comfort and non-motion equivalents

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Accessibility.
- **Related earlier ADRs:** ADR-0110, ADR-0132, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/ui/primitives.tsx; web/src/ui/controls.tsx; web/src/styles/polish.css; web/src/App.tsx.

## Context and evidence boundary

The immersive ambition must not exclude people with vestibular sensitivity, low vision, hearing differences, keyboard-only input or screen readers. Sound must not be a prerequisite for understanding the control state, even though musical evaluation requires hearing. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Treat WCAG 2.2 AA as a minimum design target and include named human assistive-technology and mobile reviews.
- Reduced motion affects CSS, canvas, canvas-like visualizers, scrolling, loading placeholders and runtime preference changes.
- Never use flashing, strobing, red/green-only distinctions, hover-only information, tiny drag-only controls or audio-only error cues.
- Keep song identity, queue/readiness, requested vs rendered move and scope available as text even when sound is absent.
- Support alternate interfaces for complex composite components including stem list and keyboard reorder.
- Allow the user to choose visual intensity without disabling essential task feedback.

## Interaction choreography and visual behavior

- Reduced motion has zero spatial travel and no persistent pulses, but still indicates causality through instantaneous icon/text states.
- Focus indicators stay visible under motion and forced-colors; selection can use shape, outline and text.
- Announcements are event-based and throttled so lyric ticks, song-time ticks and progress counters do not flood assistive technology.
- No ambient flash faster than accepted comfort threshold; prefer slow, bounded color/brightness changes tied to genuine audio.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 4 source-level Implemented, 0 independently Verified

1. **MI-0161-01 - Create sensory equivalence map.** Acceptance: Every visual/audio motion has text, icon or static alternative where meaningful. Required verification: A11y component inventory. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0161-02 - Test live reduced-motion switching.** Acceptance: No lingering animation after OS preference changes mid-session. Required verification: Live toggle browser tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/useReducedMotion.ts`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
3. **MI-0161-03 - Validate critical noncolor states.** Acceptance: Selected/playing/requested/failed/focus distinct in monochrome and forced colors. Required verification: Automated contrast and manual review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/useReducedMotion.ts`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
4. **MI-0161-04 - Audit screen-reader announcements.** Acceptance: No repeated time/beat/lyric spam; essential transitions announced. Required verification: NVDA/Edge human trace. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
5. **MI-0161-05 - Ensure composite control alternatives.** Acceptance: Studio, combobox, timeline and menu usable without pointer. Required verification: Keyboard and screen reader task sessions. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/useReducedMotion.ts`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
6. **MI-0161-06 - Protect reading and comprehension.** Acceptance: Short labels, explicit scopes and reachable explanations in every screen. Required verification: Cognitive walkthrough with participants. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
7. **MI-0161-07 - Check touch and speech-input safety.** Acceptance: Single-key shortcuts can be disabled and touch targets remain usable. Required verification: Speech input plus phone testing. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/useReducedMotion.ts`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
8. **MI-0161-08 - Record human accessibility sign-off.** Acceptance: Named reviewers, device/browser/AT, failures, numerators and exact SHA. Required verification: Independent evidence ledger. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 (uncommitted, 2026-11-12); evidence: code part built on 2026-11-12: an accessibility sign-off record that refuses a session without reviewer, device, browser, assistive technology, passed/total numerators, written failures or exact SHA, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0161-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: named accessibility reviewers record device, browser, assistive technology, failures, numerators and the exact SHA, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
