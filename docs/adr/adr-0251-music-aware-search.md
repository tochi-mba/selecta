# ADR-0251 - Music-aware Library search and recording relevance

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P0 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0226, ADR-0227, ADR-0244; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `src/selecta/db.py`; `src/selecta/routes/library.py`; `web/src/views/Library.tsx`; `web/src/shell/commands.ts`.

## Context and evidence boundary

Working Library search uses containing-text SQL and the command palette uses substring matching; neither specifies music-specific relevance tests for remixes, credits or misspellings.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Rank exact ID/artist/title ahead of bounded music-aware approximate matches, distinguish versions explicitly, keep query processing local and preserve pagination, filters and correct song identity.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 0/8 Implemented, 0/8 independently Verified

1. **GP-0251-01 - Create labeled exact, remix, feat, typo and accent query fixtures.** **Acceptance:** Create labeled exact, remix, feat, typo and accent query fixtures is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
2. **GP-0251-02 - Define normalization that never changes displayed metadata.** **Acceptance:** Define normalization that never changes displayed metadata is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
3. **GP-0251-03 - Rank exact trusted matches ahead of approximate suggestions.** **Acceptance:** Rank exact trusted matches ahead of approximate suggestions is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
4. **GP-0251-04 - Distinguish recordings by artist, version and stable song ID.** **Acceptance:** Distinguish recordings by artist, version and stable song ID is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
5. **GP-0251-05 - Preserve filter and cursor state across search and Back.** **Acceptance:** Preserve filter and cursor state across search and Back is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
6. **GP-0251-06 - Align command results without accidentally running actions.** **Acceptance:** Align command results without accidentally running actions is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
7. **GP-0251-07 - Show honest no-results and approximate-match explanations.** **Acceptance:** Show honest no-results and approximate-match explanations is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
8. **GP-0251-08 - Measure relevance accuracy and p95 latency on 20k tracks.** **Acceptance:** Measure relevance accuracy and p95 latency on 20k tracks is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** labeled query corpus, 20k search benchmark and duplicate-selection study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.

## Negative cases and required evidence

**Area-specific:** same-title tracks, covers, feature credits, Unicode, 20k library, stale query

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0226, ADR-0227, ADR-0244, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
