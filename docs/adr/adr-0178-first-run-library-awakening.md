# ADR-0178 - Onboarding: honest library awakening and first audible DJ reward

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 4/7 Implemented, 0/7 In progress, 1/7 Need a person, 2/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Onboarding.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0141, ADR-0126, ADR-0053; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Start.tsx; web/src/views/Setup.tsx; web/src/views/Mixes.tsx.

## Context and evidence boundary

The existing three-step local setup has clear file safety and privacy copy. The proposed creative layer should turn real readiness into a meaningful reveal and get the user to the first good handoff as early as possible, without pretending all analysis is finished.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Accepted decision

- Present Selecta's music-connection purpose before the folder form without obscuring its instructions.
- Preserve local server-readable folder paths and the explicit LRCLIB metadata disclosure.
- Separate scanned, audio-analysed, lyric-available and mix-ready counts; six ready songs is an entry threshold, not total completion.
- Reveal newly mix-ready songs or discovered candidates only from real backend results.
- Celebrate the first confirmed audible handoff minimally, without a forced tutorial or autoplay.
- Handle missing drive, permission, empty folder, stop and failed scan with explicit next actions.

## Visual, animation and microinteraction contract

- Readiness collection changes only when authoritative counts/songs change.
- A long scan has calm non-fabricated progress, not a looping false percentage.
- First transition reveal triggers on actual playback, not only generated plan.

## Alternatives and trade-offs

Prefer the existing restrained and proven UI when added visuals distract or reduce correctness. No artificial music, artwork, beat, lyric accuracy, quality score or fake render status. All sensory interactions require a usable static, keyboard, high-contrast and reduced-motion alternative. Source truth and explicit human consent outrank polish.

## Implementation checklist - 4/7 Implemented, 0/7 Verified

1. **CI-0178-01 - Design inviting but clear folder start.** **Acceptance:** Creative purpose understandable while path entry/privacy remain visible. **Required verification:** Cold-start usability and accessible form test. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Setup.test.tsx (vitest, passed 2026-11-10); web/e2e/finishing.e2e.ts "a folder that can’t be used says why and what to try, nothing is read, and another can be tried straight away" (Playwright, passed 2026-11-10); cold-start usability still needs a person.
2. **CI-0178-02 - Preserve local path validation.** **Acceptance:** All existing missing/inside-added/no-audio/no-access errors recover. **Required verification:** Filesystem preflight fixture tests. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** tests/test_ci_creative_interface.py test_every_unusable_folder_has_its_own_reason_and_nothing_is_read (missing, not a folder, no access, then fine); tests/test_selecta3_changes.py test_folder_preflight_keeps_existing_library_unchanged (no audio, already added, inside added) (pytest, passed 2026-11-10); web/e2e/finishing.e2e.ts folder test (Playwright, passed 2026-11-10).
3. **CI-0178-03 - Visualize honest readiness milestone.** **Acceptance:** Six ready songs distinguished from total analysis count. **Required verification:** Mixed ready/analysed/lyric fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mixes.test.tsx "waits for six mix-ready songs even when audio analysis has finished on more", "does not misreport zero mix-ready songs when an older server omits that count"; web/src/views/Setup.test.tsx "does not promise a playable mix before the real readiness threshold" (vitest, passed 2026-11-10).
4. **CI-0178-04 - Show genuine new-musical-possibility events.** **Acceptance:** Reveals appear only with verified backend song/link data. **Required verification:** Event and no-result provenance tests. **Implementation:** Not started: no new-musical-possibility reveal during the first scan; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **CI-0178-05 - Create first-seam earned-reward moment.** **Acceptance:** Only audible finished seam triggers nonblocking reveal. **Required verification:** Real first-play, Pause and dismissed-state tests. **Implementation:** Not started: no first-seam reward moment; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0178-06 - Keep background analysis independent.** **Acceptance:** User can hear a first set while analysis continues safely. **Required verification:** Large-library slow-job tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Setup.test.tsx "offers the first mix as soon as enough songs are ready while analysis continues" (vitest, passed 2026-11-10).
7. **CI-0178-07 - Measure time to first understood value.** **Acceptance:** Users recognize difference from ordinary playlist without explanation. **Required verification:** Observed first-use task metrics and interviews. **Implementation:** Needs a person: observed first-use task metrics and interviews; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0141, ADR-0126, ADR-0053; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Accepted; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
