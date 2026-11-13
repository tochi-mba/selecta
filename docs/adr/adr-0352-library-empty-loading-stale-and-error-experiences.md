# ADR-0352 - Library empty, loading, stale, offline and recovery state system

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 0/8 Not started; 1/8 In progress; 7/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Library robustness. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits).
- **Existing ADR owners:** ADR-0232, ADR-0279, ADR-0297, ADR-0226; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/ui/controls.tsx`; `web/src/styles/operations.css`.

## Context and source/evidence boundary

Library currently distinguishes initial loading, stale refresh, error and no-result states. More expressive UX should keep those distinctions rather than masking errors with generic shimmer. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Create consistent content-shaped skeletons, meaningful empty results, explicit stale/failed explanations and safe retry paths, with stable geometry and no false success.

## User outcome and interaction contract

Every non-happy state answers what is happening, what remains safe, and what the person can do next.

**Required negative cases:** Zero music, active filters yield zero, fetch fails with old rows shown, server restart, offline, partial metadata, hidden-tab resume and repeated retry.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 7/8 Implemented; 0/8 independently Verified

1. **LX-0352-01 - Enumerate complete states.** **Acceptance:** Document empty, first-run, loading, refreshing, stale, offline, failure and recovery variants. **Required verification:** State catalogue linked to test fixtures. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** state catalogue in docs/adr/adr-0352-library-empty-loading-stale-and-error-experiences.md, each state linked to its fixture and test (2026-11-10); **Evidence/reviewer:** independent reviewer -.
2. **LX-0352-02 - Shape initial placeholders.** **Acceptance:** Skeletons mirror actual list or card geometry and never imply actual song content. **Required verification:** Same-state layout-shift screenshots. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/e2e/lx-library.e2e.ts 'LX-0352-02 LX-0352-06 the placeholder matches the layout, never pulses under reduced motion or Still, and says it is loading'; web/src/views/LibraryLx.test.tsx 'LX-0352-02 the loading placeholder takes the shape of the chosen layout' (2026-11-10); browser run of web/e2e/lx-library.e2e.ts green, 22 passed (dist-r3g) (chromium, 2026-11-11); **Evidence/reviewer:** independent reviewer -.
3. **LX-0352-03 - Clarify empty versus no match.** **Acceptance:** No songs, no ready songs and filtered no results get different accurate next actions. **Required verification:** Empty-state copy and action study. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** web/src/views/LibraryLx.test.tsx 'an empty library, an empty filter and a search with no match have different next actions' (2026-11-10); Needs a person: empty-state copy and action study. Independent reviewer -.
4. **LX-0352-04 - Represent stale data.** **Acceptance:** Old rows remain labelled stale when refresh fails; unsafe writes are guarded. **Required verification:** Refresh-failure E2E. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/e2e/lx-library.e2e.ts 'LX-0352-04 LX-0352-05 a failed refresh keeps rows labelled stale with writes held, and Retry keeps query, sort and scroll' (2026-11-10); browser run of web/e2e/lx-library.e2e.ts green, 22 passed (dist-r3g) (chromium, 2026-11-11); **Evidence/reviewer:** independent reviewer -.
5. **LX-0352-05 - Support retry without loss.** **Acceptance:** Retry preserves query, sort, filter and scroll when applicable. **Required verification:** Offline-to-online recovery test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/e2e/lx-library.e2e.ts 'LX-0352-04 LX-0352-05 ...' (2026-11-10); browser run of web/e2e/lx-library.e2e.ts green, 22 passed (dist-r3g) (chromium, 2026-11-11); **Evidence/reviewer:** independent reviewer -.
6. **LX-0352-06 - Respect Still and reduced motion.** **Acceptance:** No decorative pulse when motion is disabled; progress remains textual. **Required verification:** Preference and OS motion override. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/e2e/lx-library.e2e.ts 'LX-0352-02 LX-0352-06 ... never pulses under reduced motion or Still ...' (2026-11-10); browser run of web/e2e/lx-library.e2e.ts green, 22 passed (dist-r3g) (chromium, 2026-11-11); **Evidence/reviewer:** independent reviewer -.
7. **LX-0352-07 - Announce asynchronous changes.** **Acceptance:** Status regions avoid noisy repeated screen-reader messages. **Required verification:** Live-region frequency AT test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/e2e/lx-library.e2e.ts 'LX-0352-07 nothing is re-announced while the library refreshes with no change' (2026-11-10); browser run of web/e2e/lx-library.e2e.ts green, 22 passed (dist-r3g) (chromium, 2026-11-11); **Evidence/reviewer:** independent reviewer -.
8. **LX-0352-08 - Review all state screenshots.** **Acceptance:** Human comparison verifies legibility across themes, density and 320px. **Required verification:** Named reviewer/device/fixture evidence. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists-2` (2026-11-12, coordinator commits); **Evidence/reviewer:** paired screenshot set built: web/e2e/lx-review-shots.e2e.ts 'LX review shots: Library and Lucy, both themes, 320 and 1440px, states, densities and 400% zoom' writes an unsigned manifest.json (browser check pending); src/selecta/audit/lx_release_evidence.py review_problems() refuses unsigned or incomplete sets: tests/test_lx_release_evidence.py 'test_lx_0365_06_missing_shots_and_unsigned_shots_are_refused', 'test_lx_0365_06_the_unsigned_manifest_the_shot_spec_writes_is_refused' passed (2026-11-12); Needs a person: run web/e2e/lx-review-shots.e2e.ts and a named reviewer signs each state shot (themes, densities, 320px) in its manifest.json. Independent reviewer -.

## State catalogue (LX-0352-01, 2026-11-10)

| State | What shows | Fixture / test |
|---|---|---|
| Empty library | "Your library is empty", Add music | `LibraryLx.test.tsx` "an empty library, an empty filter and a search with no match have different next actions"; `Library.test.tsx` "offers an actual next step for a library without source music" |
| First run, nothing ready | "No songs are ready for mixes yet", Show all songs, no Start a mix | `LibraryLx.test.tsx` "a partly scanned library offers no playable action and explains readiness", "queued songs on first run cannot start a mix" |
| Loading | Placeholder shaped like the list or the cards, "Loading your songs" | `LibraryLx.test.tsx` "the loading placeholder takes the shape of the chosen layout"; `lx-library.e2e.ts` LX-0352-02 |
| Refreshing (new search) | "Updating results…", list `aria-busy`, old results never committed | `Library.test.tsx` "only the newest search counts, however the answers arrive"; `LibraryLx.test.tsx` LX-0342-05 |
| Stale (refresh failed) | Rows kept, "may be out of date", Retry loading, selection and batch held | `lx-library.e2e.ts` LX-0352-04 |
| Offline (first load failed) | "Couldn’t load your library. Your songs are fine.", Try again | `Library.test.tsx` "not being able to load isn’t the same as having no songs" |
| Filtered, no match | "Nothing matches", the active constraints, Clear search / Show all songs | `LibraryLx.test.tsx` (as above); `lx-library.e2e.ts` LX-0342-03 |
| Deep link missing or unreachable | Says which, Try again, Dismiss | `Library.test.tsx` "never opens another song if a deep-link ID is missing, and can retry" |
| Recovery | Retry keeps address, sort, filter and scroll | `lx-library.e2e.ts` LX-0352-05 |

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
