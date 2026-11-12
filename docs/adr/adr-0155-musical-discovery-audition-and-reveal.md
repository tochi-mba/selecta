# ADR-0155 - Musical discovery: wordplay, harmonic auditions and earned delight

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Discovery.
- **Related earlier ADRs:** ADR-0125, ADR-0104, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Links.tsx; web/src/audio/focus.ts.

## Context and evidence boundary

Word connections and harmonic candidates can be genuinely surprising. Their visual presentation must communicate what the engine detected while preserving the primacy of audible proof and avoiding invented artistic quality. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Word-link cards place the shared phrase and actual lyric excerpts first, followed by the pair and rendered result.
- Show candidate versus evaluated connection truthfully; don't animate every discovered link as a winner.
- The four-stage harmonic audition should clearly communicate progression: chords, first song, transformed second song and both together.
- Each stage controls the single audio owner and exposes the same stages to keyboard and screen-reader users.
- Yes/No/Skip judgments are reversible where supported and do not silently add songs to any mix.
- Promote surprising, listener-approved relationships through restrained editorial composition rather than fireworks or fabricated success rates.

## Interaction choreography and visual behavior

- Harmonic stage advances with a quiet ≤160 ms progress highlight, only after playback actually advances.
- Chord-bar cursor tracks audition timing; in reduced motion use immediate current-bar outline and spoken stage label.
- Word phrase can receive ≤180 ms entrance emphasis when an authentic candidate loads; no auto-playing spoken lyrics.
- Approved/rejected feedback changes local status immediately, but only confirms save when server acknowledges.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 2 source-level Implemented, 0 independently Verified

1. **MI-0155-01 - Design word connection narrative.** Acceptance: Phrase, both song lines, move and actual rendered state clearly linked. Required verification: Pair comprehension and false-positive fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0155-02 - Preserve candidate/result distinction.** Acceptance: Never imply all discovered phrases sound good or are auto-approved. Required verification: Failed seam and unrated discovery checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
3. **MI-0155-03 - Specify four-stage harmonic audition.** Acceptance: Stage numbering and chord cursor are genuinely playback-driven. Required verification: Audio and seek fixture. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Links.tsx`; `web/src/views/Links.test.tsx`; independent checks pending.**
4. **MI-0155-04 - Guard one preview owner.** Acceptance: Audition cannot overlap the main mix or stale pair preview. Required verification: Audio-focus rapid skip tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Links.tsx`; `web/src/views/Links.test.tsx`; independent checks pending.**
5. **MI-0155-05 - Handle listening feedback safely.** Acceptance: Yes/No/Skip and changed verdict are exact-pair idempotent operations. Required verification: Lost-response and duplicate-submit tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
6. **MI-0155-06 - Make empty and exhausted states useful.** Acceptance: No candidates, analyzing, completed and offline are distinct. Required verification: Discovery lifecycle visual fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: distinct loading, empty, exhausted and failure recovery states in `Links.tsx`/`Links.test.tsx`; independent visual review remains open.**
7. **MI-0155-07 - Respect multilingual and instrumental tracks.** Acceptance: Lyric availability and right-to-left line presentation handled. Required verification: Metadata/lyrics edge-case review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0155-08 - Measure musical delight without bias.** Acceptance: Participants evaluate actual connections blind to engine confidence. Required verification: Counterbalanced real audio quality notes. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ `b779bd3c` (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a blind listening sheet that hides engine confidence and labels behind a separate key file, recording 1 to 5 quality and notes per connection, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0155-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: run a counterbalanced blind listening of real connections with quality notes, with engine confidence hidden, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
