# ADR-0153 - Library browsing: instant search, contextual actions and large-collection calm

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Library.
- **Related earlier ADRs:** ADR-0123, ADR-0105, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Library.tsx; web/src/styles/operations.css; web/src/router.ts.

## Context and evidence boundary

The Library needs to remain music-first while exposing analysis and operational status across collections of 20,000 tracks. Search and filter transitions must be fast and truthful, without losing scroll or input focus. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Search result updates happen after bounded debounce and never allow an older response to overwrite newer query results.
- Distinguish no matches, loading, stale data, ready/not-ready and source-unavailable; no empty state masquerading as a failed query.
- Song title and artist remain visually primary; readiness and correction tools stay secondary until needed.
- Filter, sort, cursor and query state survive Back/Forward, refresh and deep links without resetting the player's audio.
- Contextual actions reveal exact consequences: Play next, Add, Start mix, Analyze priority, Never play.
- Use efficient rows and compact option while preserving touch targets, accessible names and overflow handling.

## Interaction choreography and visual behavior

- Search skeleton shifts to result with ≤160 ms opacity only after real query response; never rapidly pulse every keystroke.
- Filter chip selection updates immediately; result list does not visually show previous query after latest query commitment.
- Rows can use ≤100 ms hover/focus treatment; never animate in 20,000 items individually.
- Scroll restoration is immediate to saved position, not a theatrical slide.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0153-01 - Design query feedback lifecycle.** Acceptance: Typing, waiting, loading, success, empty, stale, failed all distinct. Required verification: Delayed query and offline simulations. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Library.tsx`; `web/src/views/Library.test.tsx`; independent checks pending.**
2. **MI-0153-02 - Preserve URL-backed state.** Acceptance: Filter/sort/page/search recover after Back/Forward/refresh. Required verification: Deep-link E2E. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: URL-backed query/filter/sort/page depth and Back/Forward restoration in `Library.tsx`, `router.ts` and `Library.test.tsx`.**
3. **MI-0153-03 - Audit music identity hierarchy.** Acceptance: Title/artist precede processing metadata and remain readable. Required verification: Long/RTL/missing metadata review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
4. **MI-0153-04 - Specify contextual action states.** Acceptance: Start vs Add vs Next consequences and confirmation explicit. Required verification: Current mix conflict tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: distinct Start/Add/Play next controls, replacement confirmation and guarded operations in `Library.tsx`/`Library.test.tsx`.**
5. **MI-0153-05 - Design readiness messaging.** Acceptance: Analysis/lyrics/mix eligibility not equated with playable files. Required verification: Song readiness fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: central readiness status/reason mapping and fixtures in `state/readiness.ts`/`Library.test.tsx`; independent visual review remains open.**
6. **MI-0153-06 - Validate large-list performance.** Acceptance: 20k rows remain responsive with stable scroll, popovers and focus. Required verification: Named hardware INP/long-task trace. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: cursor paging, bounded refresh, stable-ID deduplication and rendering containment in `web/src/views/Library.tsx` and `web/src/styles/operations.css`, plus `tests/scale_server.py`; named-hardware trace remains open.**
7. **MI-0153-07 - Audit density and touch targets.** Acceptance: Compact mode preserves essential actions and 44px default targets. Required verification: 320px/zoom and coarse-pointer review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0153-08 - Measure findability.** Acceptance: Users locate songs, filters and corrections without coaching. Required verification: Search-and-act study with raw counts. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ `b779bd3c` (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a counterbalanced search-and-act sheet (find a song, use a filter, make a correction) with raw success, error and time counts, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0153-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: run a search-and-act study for songs, filters and corrections, with raw counts, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
