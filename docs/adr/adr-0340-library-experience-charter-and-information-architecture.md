# ADR-0340 - Library experience charter, collection-first information architecture and task hierarchy

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library foundation. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0226, ADR-0177, ADR-0291, ADR-0251; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/shell/manifest.ts`; `web/src/state/prefs.ts`.

## Context and source/evidence boundary

Library already exposes URL-scoped search, filter and sort, a list/card choice and large collection handling. This ADR authorises investigating a full presentation redesign without suggesting these capabilities are absent. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Design Library as one music collection with two clear jobs: relaxed discovery and precise recording retrieval. Keep the same authoritative songs, search results and actions across modes. Let Library own its hierarchy, not app-wide navigation.

## User outcome and interaction contract

A first-time listener finds a known song and explores ready music; an expert reaches an exact duplicate recording and its actions without switching products.

**Required negative cases:** Empty library, first-run not ready, 20k tracks, duplicate title/artist, no artwork, stale status and changing layout preference.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0340-01 - Define collection-first jobs.** **Acceptance:** Document novice browse and expert retrieval journeys with no required DJ vocabulary. **Required verification:** Uncoached paired task walkthrough and decision log. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0340-02 - Inventory existing capabilities.** **Acceptance:** Map present search, sort, filters, card/list, selection, readiness and details to proposed surfaces; mark reuse versus actual gap. **Required verification:** Source-to-ADR parity audit at implementing SHA. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0340-03 - Choose navigation landmarks.** **Acceptance:** Library heading, search, count, filters, results and selected tools have one consistent reading order. **Required verification:** Keyboard landmark traversal and screen-reader outline. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0340-04 - Separate discovery and management.** **Acceptance:** Primary browse controls remain visible; advanced record management stays discoverable without crowding. **Required verification:** First-action and expert completion task study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0340-05 - Preserve exact song identity.** **Acceptance:** All actions and navigation remain bound to recording ID rather than title, index or visual position. **Required verification:** Duplicate-title and result-reorder E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0340-06 - Specify mode parity.** **Acceptance:** List and collection modes share filter scope, counts, exact action meanings and persisted preference. **Required verification:** List-to-card parity and URL fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0340-07 - Specify first-run path.** **Acceptance:** No-ready-music and first-library states explain readiness and a next step without pretending music is playable. **Required verification:** Cold-install and partial-scan task tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0340-08 - Approve design charter.** **Acceptance:** Owner records chosen navigation model and baseline against real rendered pages. **Required verification:** Named design review with dated paired screenshot set. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
