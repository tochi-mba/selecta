# ADR-0301 - Lucy entry points, Make a Mix navigation and cross-route return

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Experience. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0208, ADR-0216, ADR-0219, ADR-0244, ADR-0255, ADR-0269; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/shell/manifest.ts`; `web/src/router.ts`; `web/src/views/Mixes.tsx`; `web/src/views/Mix.tsx`.

## Context and evidence boundary

Selecta's navigation manifest owns Make a Mix, My Mixes, editor and discovery breadcrumbs; Lucy should reuse the shell and preserve page hierarchy. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Provide a visible 'Make it with Lucy' path within Make a Mix, a dedicated conversation route, and scoped contextual entry from draft/song/seam. Keep one-tap Play primary for existing suggestions and never add a global floating bot that occludes audio chrome.

## Interaction, provenance and data contract

Lucy inherits Selecta's breadcrumb, theme, nav rail and mini-player. Return to editor preserves exact draft, mode, selected occurrence/seam and scroll as supported; deep links open conversation safely.

**Failure and negative scope:** Unknown conversation route, deleted draft, duplicate song titles, stale seam selection, browser Back/Forward, classic-nav and first-run readiness paths have defined fallbacks.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-301-01 - Place Lucy beside Quick Play.** **Acceptance:** A distinct low-clutter entry appears without weakening featured Play hierarchy. **Required verification:** Paired theme screenshots and uncoached discovery. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-301-02 - Add route model.** **Acceptance:** Canonical Lucy and conversation deep links parse, describe and survive Back/Forward. **Required verification:** Router unit and PWA navigation E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-301-03 - Preserve shell integration.** **Acceptance:** Nav/breadcrumb/search/help/player continue using existing authoritative shell. **Required verification:** Shell parity and viewport geometry. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-301-04 - Support scoped editor entry.** **Acceptance:** Ask Lucy about this mix/song/seam captures exact scope and occurrence IDs. **Required verification:** Duplicate-title scope regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-301-05 - Support My Mixes handoff.** **Acceptance:** Committed drafts link to existing My Mixes and editor without invented duplicate editors. **Required verification:** Draft navigation and Undo E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-301-06 - Retain first-run and unavailable states.** **Acceptance:** No-ready-songs, no-provider, offline and readiness setup have sensible Lucy entry/fallback. **Required verification:** Onboarding and disconnection fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-301-07 - Preserve return state.** **Acceptance:** Closing chat restores applicable source route, scroll and selection without music side effects. **Required verification:** Browser Back/Forward and audio-focus tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-301-08 - Test all navigation modes.** **Acceptance:** Classic/nav rail/mobile/command palette can reach equivalent workflow. **Required verification:** 320px, 400% zoom, keyboard and NVDA acceptance. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
