# ADR-0352 - Library empty, loading, stale, offline and recovery state system

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Library robustness. **Owner:** Unassigned. **Implementing PR/SHA:** -.
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

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0352-01 - Enumerate complete states.** **Acceptance:** Document empty, first-run, loading, refreshing, stale, offline, failure and recovery variants. **Required verification:** State catalogue linked to test fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0352-02 - Shape initial placeholders.** **Acceptance:** Skeletons mirror actual list or card geometry and never imply actual song content. **Required verification:** Same-state layout-shift screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0352-03 - Clarify empty versus no match.** **Acceptance:** No songs, no ready songs and filtered no results get different accurate next actions. **Required verification:** Empty-state copy and action study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0352-04 - Represent stale data.** **Acceptance:** Old rows remain labelled stale when refresh fails; unsafe writes are guarded. **Required verification:** Refresh-failure E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0352-05 - Support retry without loss.** **Acceptance:** Retry preserves query, sort, filter and scroll when applicable. **Required verification:** Offline-to-online recovery test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0352-06 - Respect Still and reduced motion.** **Acceptance:** No decorative pulse when motion is disabled; progress remains textual. **Required verification:** Preference and OS motion override. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0352-07 - Announce asynchronous changes.** **Acceptance:** Status regions avoid noisy repeated screen-reader messages. **Required verification:** Live-region frequency AT test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0352-08 - Review all state screenshots.** **Acceptance:** Human comparison verifies legibility across themes, density and 320px. **Required verification:** Named reviewer/device/fixture evidence. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
