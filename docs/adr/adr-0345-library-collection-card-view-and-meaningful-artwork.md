# ADR-0345 - Library collection cards, meaningful artwork and browsing mode

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 6/8 In progress; 1/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Library presentation. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits).
- **Existing ADR owners:** ADR-0226, ADR-0177, ADR-0245, ADR-0309; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/styles/music-objects.css`; `web/src/ui/MusicObjects.tsx`.

## Context and source/evidence boundary

Selecta already has card presentation driven by existing song data and SVG music motifs. A full collection presentation should not invent external album covers or claim unavailable art is genuine. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Make cards a true relaxed browsing mode with clear title, artist, key readiness and one action; reuse local permitted artwork if an authorised source exists, otherwise keep intentional Selecta motifs.

## User outcome and interaction contract

Cards support exploration without becoming an inefficient clone of dense rows or changing song/action meaning.

**Required negative cases:** No art, unsupported images, hundreds of cards, duplicate titles, aspect-ratio mismatch, no metadata, touch and zoom.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 1/8 Implemented; 0/8 independently Verified

1. **LX-0345-01 - Define purpose of collection cards.** **Acceptance:** Cards prioritise musical identity and browse decisions rather than duplicating every table column. **Required verification:** Collection versus list first-impression study. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** cards show motif, title, artist, readiness and one action rather than every column: web/e2e/lx-library.e2e.ts 'LX-0340-06 ... list and cards share ...' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
2. **LX-0345-02 - Use trustworthy visual assets.** **Acceptance:** Only documented available artwork is displayed; otherwise existing motifs show deliberately. **Required verification:** Asset provenance, missing-art and offline tests. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0341-06 LX-0345-02 LX-0345-04 no invented metrics or artwork, motifs only ...' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
3. **LX-0345-03 - Maintain song identity.** **Acceptance:** Duplicate recordings retain exact ID distinction and title/artist accessibility. **Required verification:** Duplicate card task and AT labels. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-05 LX-0344-01 LX-0345-03 duplicate titles stay bound to their recording ID ... in both layouts' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
4. **LX-0345-04 - Keep actionable readiness.** **Acceptance:** A card never suggests playable/ready when canonical state disagrees. **Required verification:** Ready/missing/processing fixture. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/src/views/LibraryLx.test.tsx 'LX-0346-01, LX-0345-04, LX-0349-07 readiness decides the actions, in both layouts'; web/e2e/lx-library.e2e.ts 'LX-0341-06 LX-0345-02 LX-0345-04 ...' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
5. **LX-0345-05 - Establish grid responsiveness.** **Acceptance:** Cards fit variable widths without cropped titles, horizontal scroll or controls under player. **Required verification:** 320px to wide viewport + zoom screenshots. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0341-04 LX-0344-06 LX-0345-05 LX-0351-01 LX-0351-02 cards fits 320 to 1440 and 400% zoom ...' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
6. **LX-0345-06 - Preserve mode parity.** **Acceptance:** Switching card/list retains query, filters, sort, selection scope and navigation. **Required verification:** Cross-mode automated identity tests. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-06 LX-0343-06 LX-0345-06 list and cards share address, count, order, selection and saved choice' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
7. **LX-0345-07 - Respect large libraries.** **Acceptance:** Use staged loading and bounded work; never eagerly render all 20k cards. **Required verification:** Large-card count and scroll benchmark. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/src/views/LibraryLx.test.tsx 'LX-0345-07, LX-0350-06, LX-0350-07 a 20,000 song library renders one page, as a real list' (2026-11-10); **Evidence/reviewer:** independent reviewer -.
8. **LX-0345-08 - Validate actual discovery benefit.** **Acceptance:** People explore unfamiliar tracks more effectively than dense list without sacrificing retrieval. **Required verification:** Uncoached browse-and-find study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** Needs a person: uncoached browse-and-find study. Independent reviewer -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
