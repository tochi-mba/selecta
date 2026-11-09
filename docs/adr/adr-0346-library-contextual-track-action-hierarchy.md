# ADR-0346 - Library per-recording action hierarchy and contextual disclosure

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library interaction. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0258, ADR-0267, ADR-0291, ADR-0226; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/ui/controls.tsx`; `web/src/state/readiness.ts`.

## Context and source/evidence boundary

Track rows currently offer Start a mix, Add, Play next, Analyse and More based on canonical readiness. Rearranging controls must not change action guards or audio semantics. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Choose the most useful action per state, expose secondary operations through a discoverable menu and make all actions understandable before committing a playback-affecting change.

## User outcome and interaction contract

A person knows which action starts/replaces playback, which edits a mix and which only schedules analysis.

**Required negative cases:** Unready track, active mix, already-added song, rapid double click, stale route, multiple tabs, touch and keyboard menus.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0346-01 - Map actions by readiness.** **Acceptance:** Define allowed primary and secondary actions for every canonical track status. **Required verification:** Readiness-to-UI contract test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0346-02 - Limit visual action competition.** **Acceptance:** Rows/cards expose one dominant action at a time without suppressing essential alternatives. **Required verification:** Uncoached task priority comparison. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0346-03 - Keep start-mix confirmation.** **Acceptance:** Replacing currently playing material requires existing explicit confirmation and correct expected order. **Required verification:** Real-player focus and replacement E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0346-04 - Clarify Add versus Play next.** **Acceptance:** Label and explain positional/current-mix effects without implying playback when not requested. **Required verification:** Active/idle mix action task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0346-05 - Preserve analysis semantics.** **Acceptance:** Analyse buttons show requested, queued, running, error and retry truth from actual job state. **Required verification:** Async queued/stale/failure fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0346-06 - Make menus fully accessible.** **Acceptance:** More actions work by keyboard, touch and screen reader with stable focus return. **Required verification:** Menu/escape/role and touch AT tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0346-07 - Guard async duplicates.** **Acceptance:** Repeated actions cannot commit twice or visually claim success before the server responds. **Required verification:** Race and duplicate-submit E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0346-08 - Validate novice meaning.** **Acceptance:** Participants correctly predict the result of each action before performing it. **Required verification:** Pre-action comprehension study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
