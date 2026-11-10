# ADR-0340 - Library experience charter, collection-first information architecture and task hierarchy

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 4/8 In progress; 3/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library foundation. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits).
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

## Implementation checklist - 3/8 Implemented; 0/8 independently Verified

1. **LX-0340-01 - Define collection-first jobs.** **Acceptance:** Document novice browse and expert retrieval journeys with no required DJ vocabulary. **Required verification:** Uncoached paired task walkthrough and decision log. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** collection-first novice browse and expert retrieval journeys in docs/adr/adr-0340-library-experience-charter-and-information-architecture.md, written in the Library's own words with no DJ vocabulary (2026-11-10); Needs a person: uncoached paired task walkthrough and decision log. Independent reviewer -.
2. **LX-0340-02 - Inventory existing capabilities.** **Acceptance:** Map present search, sort, filters, card/list, selection, readiness and details to proposed surfaces; mark reuse versus actual gap. **Required verification:** Source-to-ADR parity audit at implementing SHA. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** capability inventory table (reuse versus gap) in docs/adr/adr-0340-library-experience-charter-and-information-architecture.md, re-audited against web/src/views/Library.tsx and SongDetails.tsx on this branch (2026-11-10); **Evidence/reviewer:** independent reviewer -.
3. **LX-0340-03 - Choose navigation landmarks.** **Acceptance:** Library heading, search, count, filters, results and selected tools have one consistent reading order. **Required verification:** Keyboard landmark traversal and screen-reader outline. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-03 one reading order: heading, search, filters, count, results, in DOM, Tab and the accessibility outline' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
4. **LX-0340-04 - Separate discovery and management.** **Acceptance:** Primary browse controls remain visible; advanced record management stays discoverable without crowding. **Required verification:** First-action and expert completion task study. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** browse controls stay in the find bar and filter chips while record management lives in one More menu and the song sheet: web/e2e/lx-library.e2e.ts 'LX-0340-03 ...', web/src/views/LibraryLxMore.test.tsx 'LX-0344-04 one stable primary action per row, the rest in one menu' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
5. **LX-0340-05 - Preserve exact song identity.** **Acceptance:** All actions and navigation remain bound to recording ID rather than title, index or visual position. **Required verification:** Duplicate-title and result-reorder E2E. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-05 LX-0344-01 LX-0345-03 duplicate titles stay bound to their recording ID, through reorder and in both layouts'; web/src/views/LibraryLx.test.tsx 'LX-0340-05 a title shared by different artists never gives two recordings the same button name' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
6. **LX-0340-06 - Specify mode parity.** **Acceptance:** List and collection modes share filter scope, counts, exact action meanings and persisted preference. **Required verification:** List-to-card parity and URL fixture. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0340-06 LX-0343-06 LX-0345-06 list and cards share address, count, order, selection and saved choice' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
7. **LX-0340-07 - Specify first-run path.** **Acceptance:** No-ready-music and first-library states explain readiness and a next step without pretending music is playable. **Required verification:** Cold-install and partial-scan task tests. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/src/views/LibraryLx.test.tsx 'LX-0340-07, LX-0352-03 first run, nothing ready and no match each say something different' (partly scanned library and queued first run offer no playable action) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
8. **LX-0340-08 - Approve design charter.** **Acceptance:** Owner records chosen navigation model and baseline against real rendered pages. **Required verification:** Named design review with dated paired screenshot set. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** Needs a person: owner records the chosen navigation model and baseline in a named design review with a dated paired screenshot set. Independent reviewer -.

## Collection-first journeys (LX-0340-01, 2026-11-10)

Written in the words the Library itself uses. Neither journey needs DJ vocabulary: tempo and key are shown as facts, never asked for.

- **Novice browse.** Open Library. The header says how many songs there are, how many are analysed and how many are ready for mixes, and one sentence says what "ready for mixes" means. Choose the **Ready** filter, scan titles and artists, then press **Start a mix** on a song. If music is already playing, Selecta asks before replacing it (**Keep current mix** changes nothing). Anything else (add to the current mix, prioritise, never play) is one press away under **More actions**.
- **Expert retrieval.** Type a title, an artist, a credit or a recording number into **Search your library**. Each result says why it matched (Recording ID, Exact title, Artist match, Approximate match). Two recordings with the same title and artist each carry a **Recording N** badge, and every button names its recording. **Details** opens the song sheet: measured and corrected tempo and key side by side, the readiness reason and a next step, corrections, priority, never play and set aside.

## Capability inventory (LX-0340-02, 2026-11-10)

Audited against `web/src/views/Library.tsx`, `web/src/views/SongDetails.tsx`, `src/selecta/routes/library.py` and `src/selecta/api_common.py` on branch `feat/finish-checklists`. "Reuse" means the proposed surface keeps the existing capability; "gap" means something was missing and what happened to it.

| Capability | Present today | Proposed surface | Reuse or gap |
|---|---|---|---|
| Search | One search box (`q` in the address), server relevance across ID, title, artist and credits, a match reason per row | Library find bar | Reuse |
| Sort | Title, Artist, Tempo, Newest first (`sort`), cursor paging per sort | Library find bar | Reuse |
| Filters | Everything, Ready, Not analysed yet, Needs attention, Priority list (flag `library.priority`), Set aside (`show`), Clear all filters | Filter chips | Reuse |
| List / cards | `prefs.libraryLayout`, flag `library.card_view` | Layout switch | Reuse |
| Density | Comfortable / Compact (`prefs.density`) | Row size switch | Reuse |
| Selection | Checkboxes, Select up to 200 loaded songs, batch rail, confirmation with exact IDs, atomic `/api/library/batch` (flag `library.batch`) | Selection rail | Reuse |
| Readiness | Server `readiness_of`, client `trackReadiness`, badge and reason per row | Row status | Reuse |
| Details | Song sheet: identity, facts, corrections (`library.corrections`), priority, never play, set aside, advanced facts | Song inspector | Reuse; gap closed: a next step for every state (LX-0348-04) |
| Counts | Status counts in the header | Collection overview | Gaps closed: unknown counts stay unknown (LX-0341-02); the set-aside count opens its filter (LX-0341-07) |
| Paging | 100 per page, cursor, Show more, `pages` in the address, refresh of the visible page only | Results list | Reuse |
| Deep link | `song=<id>` opens that exact recording, even outside the current filter | Song inspector | Reuse |
| Empty, loading, stale | Empty library, no match, loading placeholder, stale warning with Retry | State catalogue (ADR-0352) | Gaps closed: Ready-filter empty copy, active constraints named (LX-0343-07), card-shaped placeholder (LX-0352-02) |
| Artwork | None (motifs only) | Cards | Not adopted: no documented artwork source (LX-0345-02) |
| Advanced BPM/key/duration filters, search suggestions, virtualisation | None | - | Not adopted (LX-0343-04, LX-0342-08, LX-0350-07) |

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
