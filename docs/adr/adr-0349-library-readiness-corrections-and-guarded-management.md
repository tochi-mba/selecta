# ADR-0349 - Library readiness explanations, correction safety and recording management

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library detail. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0227, ADR-0252, ADR-0258, ADR-0291; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/SongDetails.tsx`; `web/src/state/readiness.ts`; `src/selecta/routes/library.py`.

## Context and source/evidence boundary

Song correction, priority, exclusion and set-aside are existing guarded operations. Visual controls should not suggest that changing metadata edits the original audio file. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Clarify the meaning and downstream consequences of correction, priority, exclusion and music classification; offer safe confirmation or reversible paths where actual operations warrant them.

## User outcome and interaction contract

A listener can fix incorrect tempo/key and manage whether a recording is used without fear of losing audio or misleading success feedback.

**Required negative cases:** Invalid BPM/key, half/double out of bounds, failed write, stale song, file missing, multiple tabs and accidental exclusion.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0349-01 - Make corrections predictable.** **Acceptance:** Show permitted tempo/key format, active override and reset effect before Save. **Required verification:** Invalid/valid field tests and human comprehension. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0349-02 - Preserve measured values.** **Acceptance:** Reset restores measured metadata rather than deleting original or changing source music. **Required verification:** Correction/reset API and UI regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0349-03 - Explain transition rebuild impact.** **Acceptance:** Server-returned rework count is shown without inventing completion or ETAs. **Required verification:** Response-dependent message fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0349-04 - Clarify priority meaning.** **Acceptance:** Prioritise affects analysis scheduling/cache protection and not implicit playback order. **Required verification:** Before-action wording study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0349-05 - Clarify exclusion and set-aside.** **Acceptance:** Never play and not music are separate supported states with clear reversal. **Required verification:** Status-to-action mapping and revert E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0349-06 - Handle errors without loss.** **Acceptance:** Failed updates keep user input and focus on actionable errors, not false saved status. **Required verification:** Network/validation/409 failure tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0349-07 - Keep advanced file context truthful.** **Acceptance:** Missing/relinked music state never claims available local audio. **Required verification:** Lost-source and recovery fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0349-08 - Validate no-source-mutation promise.** **Acceptance:** A user action never writes to the original music file or changes unrelated selections. **Required verification:** Backend fixture and real-file integrity test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
