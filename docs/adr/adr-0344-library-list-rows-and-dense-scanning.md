# ADR-0344 — Library list-row geometry, metadata hierarchy and dense scanning

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library presentation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0291, ADR-0275, ADR-0226, ADR-0245; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/styles/operations.css`; `web/src/styles/music-objects.css`.

## Context and source/evidence boundary

The current row has song identity, BPM/key/length, readiness and several actions. Header and row share a grid, while responsive breakpoints intentionally hide inaccurate column headings. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Redesign the professional list around recording identity first, aligned numerical metadata, legible readiness and one stable primary action. Comfortable/compact density should change rhythm, not safety or semantics.

## User outcome and interaction contract

Users scan dozens of tracks, compare BPM/key and spot readiness without repeating detailed inspection or misreading shifted columns.

**Required negative cases:** Very long remix titles, multi-line artists, unknown facts, 320px, RTL, 400% zoom, rows changing status and focus within content-visibility.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0344-01 — Define track identity geometry.** **Acceptance:** Motif/artwork, title, artist and duplicate recording identity remain distinguishable. **Required verification:** Mixed-length title and duplicate fixture screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0344-02 — Align facts and column labels.** **Acceptance:** Headings, BPM, Camelot key, duration, readiness and actions share intentional guides. **Required verification:** Computed-grid geometry in both densities. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0344-03 — Make numeric scans stable.** **Acceptance:** BPM/key/duration use readable tabular alignment and explicit unknown states. **Required verification:** Metadata update and unknown-value screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0344-04 — Redesign row action hierarchy.** **Acceptance:** One relevant primary action is stable; secondary actions are reachable by menu and keyboard. **Required verification:** Uncoached action choice and menu E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0344-05 — Specify density variants.** **Acceptance:** Comfortable and compact rows retain legibility and required target/spacing exceptions. **Required verification:** Computed hitbox and contrast audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0344-06 — Handle wrapping accessibly.** **Acceptance:** Long names do not overlap adjacent columns; full identity remains obtainable by AT. **Required verification:** Long/RTL/CJK at zoom and focus test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0344-07 — Preserve stable IDs.** **Acceptance:** Dynamic readiness updates and sorting do not move focus to another recording. **Required verification:** Background-scan reorder and focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0344-08 — Validate scan efficiency.** **Acceptance:** DJ retrieval and casual browsing tasks improve or match baseline in both themes. **Required verification:** Timed expert/novice comparison with matched data. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
