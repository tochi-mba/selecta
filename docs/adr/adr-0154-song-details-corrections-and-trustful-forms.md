# ADR-0154 - Song details: metadata confidence, corrections, validation and safe recovery

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Library.
- **Related earlier ADRs:** ADR-0123, ADR-0106, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/SongDetails.tsx; web/src/ui/primitives.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

Users may correct tempo, key, lyric state or processing priority. These changes can affect future transitions but must not imply original audio files were rewritten or that already-rendered seams instantly changed. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Show measured and user-overridden BPM/key separately with clear provenance; reversible reset restores detected values.
- Double/Half tempo affordances need stable, precise values and explanation of why this helps beat analysis.
- Validate form inputs without interrupting typing; show actionable errors beside the correct field.
- When correction may require re-rendering, say what will become stale and what remains playable right now.
- Never use a fake 'saved' animation before the mutation is confirmed; pending state retains edit values.
- Song details should work for unavailable, duplicated, instrumental, RTL and malformed metadata with non-destructive recovery.

## Interaction choreography and visual behavior

- Correction field highlights pending on submit ≤120 ms; confirmed success becomes stable saved label ≤160 ms.
- Double/Half updates numeric value immediately without animated rolling digits; semantics always reflect current actual field value.
- Reset confirmation uses visible non-color cue, no shake or celebration.
- Re-render effect stays marked waiting until job reports ready; no premature green status.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0154-01 - Define metadata provenance layout.** Acceptance: Detected/effective/user override clearly distinguished. Required verification: Example songs and comprehension review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0154-02 - Specify tempo/key field validation.** Acceptance: Invalid, partial and corrected states retain input and focus. Required verification: Keyboard and invalid value tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: retained invalid input and targeted focus recovery in `SongDetails.tsx`, exercised through Library correction fixtures.**
3. **MI-0154-03 - Design double/half tempo controls.** Acceptance: One precise reversible value change with accessible name. Required verification: Numeric and audio analysis fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/SongDetails.tsx`; `web/src/views/Library.test.tsx`; independent checks pending.**
4. **MI-0154-04 - Clarify regeneration consequences.** Acceptance: Affected seam is marked stale/queued; originals remain safe. Required verification: Mutation plus render-state test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
5. **MI-0154-05 - Specify pending/saved/retry visuals.** Acceptance: No optimistic success; failed save can retry same value. Required verification: Network failure and operation guard. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
6. **MI-0154-06 - Handle duplicate and missing metadata.** Acceptance: Stable song ID prevents editing wrong recording. Required verification: Duplicate title and file-missing tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: stable song-ID addressing, duplicate disambiguation and missing-file readiness in `Library.tsx`, `SongDetails.tsx` and fixtures.**
7. **MI-0154-07 - Validate dialog and mobile behavior.** Acceptance: Focus enters/returns, field remains visible under keyboard. Required verification: NVDA, touch and zoom. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0154-08 - Test correction confidence.** Acceptance: Listener predicts what changed and what did not. Required verification: Observed correction task and questions. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 (uncommitted, 2026-11-12); evidence: code part built on 2026-11-12: a correction sheet recording whether listeners predicted what changed and what did not, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0154-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: observe a correction task where listeners predict what changed and what did not, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
