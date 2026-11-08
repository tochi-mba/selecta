# ADR-0341 — Library header, truthful collection overview and readiness-oriented summary

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library hierarchy. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0226, ADR-0178, ADR-0180, ADR-0291; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/styles/operations.css`; `web/src/state/readiness.ts`.

## Context and source/evidence boundary

Library currently shows a title and counts for analysed, ready, music and set-aside songs. A visual summary must not turn raw counters into misleading progress or block routine search. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Create a calm, compact collection header with actual totals and readiness, emphasising immediately useful search. Avoid dashboard clutter; allow a short collection overview only when it assists orientation.

## User outcome and interaction contract

People can tell total collection size, ready-for-mixes count and an actionable attention state without confusing analysed with playable.

**Required negative cases:** Unknown counts, count changes during scans, 0 songs, 1 song, large 20k figures, mobile truncation and untrusted cache values.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0341-01 — Set header hierarchy.** **Acceptance:** Library name and primary collection task outrank metrics and decorative information. **Required verification:** Paired desktop/mobile hierarchy critique. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0341-02 — Use canonical counters.** **Acceptance:** Counts are derived from authoritative status and retain unknown state instead of manufacturing a zero. **Required verification:** Unknown/partial status fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0341-03 — Explain readiness.** **Acceptance:** Ready for mixes is explicitly distinct from analysed and from ready transitions. **Required verification:** Comprehension task with misleading-value fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0341-04 — Design responsive counters.** **Acceptance:** Overview folds to readable lines/cards only when content permits, without horizontal scroll. **Required verification:** 320–1440px and 400% zoom geometry tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0341-05 — Preserve number stability.** **Acceptance:** Tabular counts, thousands separators and live changes do not cause avoidable layout shift. **Required verification:** Computed geometry and CLS trace. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0341-06 — Avoid vanity metrics.** **Acceptance:** Do not add fabricated hours listened, ratings, quality scores, cover art or fake completion percentages. **Required verification:** Source/provenance and copy audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0341-07 — Link attention to action.** **Acceptance:** If supported, attention counters navigate to exact Library filtered results. **Required verification:** Navigation, filter and back-stack E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0341-08 — Validate overview value.** **Acceptance:** Users understand relevant collection counts faster than the baseline without compromising song retrieval. **Required verification:** Uncoached count explanation and retrieval comparison. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
