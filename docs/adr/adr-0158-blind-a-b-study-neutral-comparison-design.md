# ADR-0158 - Blind listening studies: neutral feedback, fair comparison and no visual bias

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Listening research.
- **Related earlier ADRs:** ADR-0129, ADR-0109, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Listening.tsx; web/src/audio/focus.ts.

## Context and evidence boundary

The listening-study interface must not favor one render through layout, color, timing or animation. Assessment validity matters more than visual delight on this surface. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

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

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0158-01 - Audit visual condition masking.** Acceptance: A/B modes have identical styling and DOM/accessibility method anonymity. Required verification: Rendered HTML and screenshot comparison. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0158-02 - Specify identical audio transport.** Acceptance: Switching clips cannot overlap or surprise-resume main mix. Required verification: Audio focus fixture. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
3. **MI-0158-03 - Guard heard-state eligibility.** Acceptance: A button click without audio cannot unlock preference. Required verification: Unavailable clip and media readiness tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Listening.tsx`; `web/src/views/Listening.test.tsx`; independent checks pending.**
4. **MI-0158-04 - Balance preference controls.** Acceptance: Tie, cannot judge and both versions treated neutrally. Required verification: Researcher protocol and visual review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
5. **MI-0158-05 - Preserve response identity.** Acceptance: Retries do not duplicate or mutate earlier exact trials. Required verification: API idempotency tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
6. **MI-0158-06 - Design neutral issue tags.** Acceptance: Issue inputs do not prime quality or reveal hidden method. Required verification: Human study pilot. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
7. **MI-0158-07 - Handle interruptions honestly.** Acceptance: Browser reload/failed clip preserves trial or exposes nonjudgment. Required verification: Recovery and keyboard tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0158-08 - Validate study evidence.** Acceptance: Analyze sequence/order effects, sample count and raw responses without superiority claims. Required verification: Counterbalanced research report. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ `b779bd3c` (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a `report` command that joins checked study records at one SHA with the sample count, raw responses and outcomes by position, and refuses superiority claims, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0158-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: write the counterbalanced research report from real participants: order effects, sample count and raw responses, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
