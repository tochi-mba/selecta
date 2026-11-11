# ADR-0343 - Library filters, sorting and optional musical-query depth

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 3/8 In progress; 4/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library retrieval. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits).
- **Existing ADR owners:** ADR-0291, ADR-0251, ADR-0226, ADR-0153; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `src/selecta/routes/library.py`; `web/src/api.ts`.

## Context and source/evidence boundary

Current filters include Everything, Ready, Not analysed, Needs attention, Priority and Set aside, with sorting by title, artist, tempo and recency. BPM range, key and duration are redesign candidates, not currently proven server filters. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Use a short high-frequency filter row and an accessible advanced filter disclosure; ensure every visible filter is backed by a real supported query and clearly indicates active state and result scope.

## User outcome and interaction contract

A listener narrows to ready songs quickly while an expert refines an exact musical selection without confusing unanalysed with filtered-out.

**Required negative cases:** Unknown BPM/key, zero results, incompatible filters, stale counts, 20k data, saved URL, resorting during analysis and touch overflow.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 4/8 Implemented; 0/8 independently Verified

1. **LX-0343-01 - Prioritise frequent filters.** **Acceptance:** Show All, Ready, Processing and Needs attention with plain labels; retain priority/set-aside access. **Required verification:** Uncoached filter discovery and copy study. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** web/src/views/LibraryLxMore.test.tsx 'LX-0343-01 the frequent filters have plain names, with priority and set aside still there' (Everything, Ready, Not analysed yet for queued and processing, Needs attention, Priority list, Set aside) (2026-11-10); Needs a person: uncoached filter discovery and copy study. Independent reviewer -.
2. **LX-0343-02 - Make active state obvious.** **Acceptance:** Selected chips and clear-all state are visible with text/ARIA, not colour alone. **Required verification:** Keyboard, theme and pressed-state tests. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0343-02 LX-0351-03 filters show their state without colour, wrap at 320px and work by keyboard and touch' (aria-pressed, both themes, forced colours) (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
3. **LX-0343-03 - Preserve supported sorting.** **Acceptance:** Existing title/artist/tempo/recent ordering remains consistent with URL and server authority. **Required verification:** Full sort comparison and Back/Forward E2E. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0342-02 LX-0343-03 query, filter and sort live in the address and Back/Forward shows the server's own order' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
4. **LX-0343-04 - Specify advanced panel.** **Acceptance:** Optional BPM, key, duration and artist filters only appear after source/API capability is approved. **Required verification:** Capability matrix and empty-data contract review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** capability matrix in docs/adr/adr-0343-library-filters-sorting-and-musical-query-depth.md; web/src/views/LibraryLx.test.tsx 'LX-0343-04, LX-0342-08 nothing unapproved is offered' (2026-11-10); **Evidence/reviewer:** independent reviewer -.
5. **LX-0343-05 - Explain unknown musical facts.** **Acceptance:** Unknown tempo/key records are not silently treated as matching a music-specific query. **Required verification:** Missing-feature fixture and result explanation. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** tests/test_library_lx.py test_an_unanalysed_song_has_no_made_up_tempo_in_a_tempo_sort (2026-11-10); **Evidence/reviewer:** independent reviewer -.
6. **LX-0343-06 - Keep scope on layout switches.** **Acceptance:** List/card/density toggles never change filter meaning or silently broaden selection. **Required verification:** Cross-mode scope parity tests. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-06 LX-0343-06 LX-0345-06 list and cards share address, count, order, selection and saved choice' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
7. **LX-0343-07 - Design zero-result recovery.** **Acceptance:** Explain active constraints and offer reversible clear/reset without dropping song identity. **Required verification:** Empty + combinations usability test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** web/src/views/LibraryLxMore.test.tsx 'LX-0342-06, LX-0343-07 no match says what is hiding songs and each way back is a single, reversible step' (Looking in: line, Show all songs is a Back-able history step) (2026-11-10); Needs a person: empty and combined-constraint usability test. Independent reviewer -.
8. **LX-0343-08 - Validate musical refinement.** **Acceptance:** Expert tasks get faster without degrading ordinary search or creating hidden required steps. **Required verification:** Timed novice/expert search study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** Needs a person: timed novice/expert search study. Independent reviewer -.

## Advanced filter capability matrix (LX-0343-04, 2026-11-10)

| Filter | Source data | API capability | Shipped |
|---|---|---|---|
| Tempo range | `analysis.bpm` or a correction; unknown until analysed | None: `/api/library` takes `q`, `state`, `sort`, `limit`, `after` only | No |
| Key | `analysis.camelot` or a correction; unknown until analysed | None | No |
| Duration | `songs.duration` | None | No |
| Artist | `songs.artist`, already searchable | Search only | No separate filter |

No advanced panel ships until a source/API capability is approved. `web/src/views/LibraryLx.test.tsx` "only the supported filters and a plain search box are shown" keeps it that way.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
