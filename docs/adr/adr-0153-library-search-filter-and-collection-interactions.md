# ADR-0153 — Library browsing: instant search, contextual actions and large-collection calm

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Library.
- **Related earlier ADRs:** ADR-0123, ADR-0105, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Library.tsx; web/src/styles/operations.css; web/src/router.ts.

## Context and evidence boundary

The Library needs to remain music-first while exposing analysis and operational status across collections of 20,000 tracks. Search and filter transitions must be fast and truthful, without losing scroll or input focus. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

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

## Implementation tasks — all Not started, none Verified

1. **MI-0153-01 — Design query feedback lifecycle.** Acceptance: Typing, waiting, loading, success, empty, stale, failed all distinct. Required verification: Delayed query and offline simulations. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0153-02 — Preserve URL-backed state.** Acceptance: Filter/sort/page/search recover after Back/Forward/refresh. Required verification: Deep-link E2E. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0153-03 — Audit music identity hierarchy.** Acceptance: Title/artist precede processing metadata and remain readable. Required verification: Long/RTL/missing metadata review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0153-04 — Specify contextual action states.** Acceptance: Start vs Add vs Next consequences and confirmation explicit. Required verification: Current mix conflict tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0153-05 — Design readiness messaging.** Acceptance: Analysis/lyrics/mix eligibility not equated with playable files. Required verification: Song readiness fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0153-06 — Validate large-list performance.** Acceptance: 20k rows remain responsive with stable scroll, popovers and focus. Required verification: Named hardware INP/long-task trace. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0153-07 — Audit density and touch targets.** Acceptance: Compact mode preserves essential actions and 44px default targets. Required verification: 320px/zoom and coarse-pointer review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0153-08 — Measure findability.** Acceptance: Users locate songs, filters and corrections without coaching. Required verification: Search-and-act study with raw counts. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
