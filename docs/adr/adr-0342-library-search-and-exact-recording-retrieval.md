# ADR-0342 — Library search field, result explanation and exact-recording retrieval

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library retrieval. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0251, ADR-0291, ADR-0153, ADR-0314; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `src/selecta/routes/library.py`; `src/selecta/library/relevance.py`.

## Context and source/evidence boundary

Search is already debounced and URL-backed; numeric ID lookup and duplicate-title disambiguation already exist. New UX work must not treat these as missing or replace search semantics without source-backed evidence. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Give search visual primacy and predictable suggestions and results, with concise match reasons and exact-ID disambiguation. Any new filters or ranking changes require a separately tested backend contract.

## User outcome and interaction contract

People find a recording by artist, title, remix credit or exact ID, recognise why it matched and return to the same search state.

**Required negative cases:** Rapid typing, out-of-order responses, ambiguous title, punctuation, Unicode, RTL/CJK, empty query, no results, offline and browser Back/Forward.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0342-01 — Design prominent search.** **Acceptance:** Search remains the most visible Library control without hiding current result context. **Required verification:** Visual hierarchy and search-discovery test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0342-02 — Retain URL-state truth.** **Acceptance:** Query, sort and filter restore by deep-link and Back/Forward with no stale data committed. **Required verification:** Router and browser-history E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0342-03 — Explain search matches.** **Acceptance:** Match reason or highlighted matching field is legible and sourced from real backend metadata. **Required verification:** Title/artist/credit/id fixtures with AT. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0342-04 — Protect exact IDs.** **Acceptance:** Numeric lookup resolves exact recording IDs rather than a similarly named track. **Required verification:** Duplicate and ID precision E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0342-05 — Stabilise async search.** **Acceptance:** Out-of-order results never appear as the latest query or steal keyboard focus. **Required verification:** Deferred-response race and focus test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0342-06 — Support clear and reset.** **Acceptance:** Clear-search and no-results recovery preserve intended filters and are accessible. **Required verification:** Uncoached zero-match recovery test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0342-07 — Budget retrieval latency.** **Acceptance:** Collect named-device latency from input to stable result; optimise regressions without invented field percentiles. **Required verification:** 20k fixture trace and p75 lab baseline. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0342-08 — Review new search affordances.** **Acceptance:** Suggestions, shortcuts and optional query grammar only ship if accessible and demonstrably helpful. **Required verification:** Keyboard and novice/expert comparison study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
