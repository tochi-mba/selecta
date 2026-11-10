# ADR-0105: Large-Library browse, URL-backed search, readiness filters and 20k-song responsiveness

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (9/10 implemented, 0 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 8 Library
- **Extends, does not automatically supersede:** ADR-0017, ADR-0062, ADR-0086
- **Source surfaces to reconcile:** `web/src/views/Library.tsx`; `web/src/state/readiness.ts`; `src/selecta/routes/library.py`
- **Tasks:** S4-0105-01 through S4-0105-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A music collection of thousands of songs needs a scanner-friendly list and precise filters. The current subset polling pattern risks stale readiness for deep pages; aggressive virtualization can break accessibility.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use a structured multi-column desktop list and compact mobile rows while preserving the existing URL search, filters, pagination, actions, readiness and corrected metadata. Optimize measured 20k-song workloads before adopting virtualization.

## Experience, frontend and interaction specification

- Title/artist dominate; BPM/Camelot/duration/readiness align in predictable columns.
- Mobile rows retain one primary action and accessible secondary actions without hover requirements.
- Filter state, result count, URL query and Back/Forward are authoritative user context.
- Refresh visible/current page readiness, not only initial fixed song subset; avoid fetching entire library every poll.

## Detailed implementation work

1. **S4-0105-01 - Redesign desktop list and mobile card-row hierarchy.** Acceptance: Titles, artist, status and actions remain legible with dense data. Required verification: 320/375/768/1280 and 20k screenshot fixtures. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/Library.tsx list and card layouts; Library.test.tsx 'preserves the same song actions, readiness reason and list while switching layouts'; finishing.e2e.ts 'long, right-to-left and duplicate names stay readable'. Needs a person: 320/375/768/1280 and 20k screenshot review.
2. **S4-0105-02 - Preserve all existing Library actions and availability rules.** Acceptance: Add/Play next/Start a mix/Analyze/Prioritize/Never play intact. Required verification: Feature parity and action-by-readiness tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'offers the whole lot in one press', 'lets the listener prioritize a song', 'shows bulk actions only for a real selection'; web/src/state/readiness.test.ts 'never offers excluded music for manual mixing or analysis'. Needs a person: independent review.
3. **S4-0105-03 - Preserve URL-backed search/filter/page and history semantics.** Acceptance: Reload/Back/Forward restore correct browse state. Required verification: Deep link and browser navigation E2E. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'keeps what you were looking for in the address', 'restores the requested page depth'; web/e2e/pages.e2e.ts 'the Library's filters are part of its address', 'Back and Forward go where they should'. Needs a person: independent review.
4. **S4-0105-04 - Harden asynchronous search and debouncing.** Acceptance: Late query response cannot replace newer result. Required verification: Rapid typing/empty query/server failure tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'only the newest search counts, however the answers arrive', 'not being able to load isn't the same as having no songs'; finishing.e2e.ts 'a slow search can't replace a newer one'. Needs a person: independent review.
5. **S4-0105-05 - Design filter grouping and clear active state.** Acceptance: Every preexisting filter remains accessible and visible. Required verification: Filter-combination/multi-select tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.tsx filter chips with aria-pressed held in the URL; Library.test.tsx 'refuses a confirmed batch action if a different filter takes over'. Needs a person: filter review.
6. **S4-0105-06 - Clarify ready/processing/failed/excluded reasons.** Acceptance: Badges never falsely mark track as mix-ready. Required verification: Canonical backend readiness fixture cases. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'gives the reason in the song's details', 'distinguishes analysed songs from mix-ready songs'; tests/test_library_edges.py 'a_song_analysis_gave_up_on_says_so_rather_than_looking_ready'; readiness.test.ts. Needs a person: independent review.
7. **S4-0105-07 - Fix deep-page readiness freshness during processing.** Acceptance: Currently displayed page updates without requiring return to page 1. Required verification: Page >200 refresh and analysis progress tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Library.test.tsx 'reloads an edited song on a middle page, not just the first or last page' (passed alone with --testTimeout=60000; it hit the 10 s default under shared-laptop load). Needs a person: page 200+ check during real analysis.
8. **S4-0105-08 - Measure pagination versus virtualization before changing architecture.** Acceptance: Focus/find-in-page/AT/scroll restoration not sacrificed. Required verification: 20k rows, 100-page deep browsing and memory tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/adr/completion/performance.md 'Pagination versus virtualization'; tests/test_library_edges.py 'twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick'. Needs a person: hardware memory and AT trace at 20k.
9. **S4-0105-09 - Support missing, long, duplicate and RTL metadata.** Acceptance: Search and list never produce wrong song action. Required verification: Synthetic Unicode/colliding titles tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: test_library_edges.py 'songs_with_the_same_name_are_kept_apart', 'any_name_comes_back_exactly_as_it_is_and_can_be_searched_for'; Library.test.tsx 'makes duplicate recording IDs visible', 'resolves a linked song by exact ID'. Needs a person: independent review.
10. **S4-0105-10 - Review new advanced tempo/key/genre filters separately.** Acceptance: No unsupported analysis field presented as available. Required verification: Backend capability flag tests if enhancement approved. **Implementation: Not started (2026-11-10); Verified: No.** Evidence: no tempo/key/genre filter exists (tempo is a sort only), so nothing unsupported is shown. Needs a person: owner decision whether to approve advanced filters.

## Required negative cases and regression strategy

- An existing song disappears from filtered results after readiness update; preserve safe focus.
- Server returns stale page while user changes filter.
- Browser storage quota or tab switch cannot erase URL state.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Pagination may be more accessible and predictable than virtualization until measured evidence justifies it.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0105 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (9/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
