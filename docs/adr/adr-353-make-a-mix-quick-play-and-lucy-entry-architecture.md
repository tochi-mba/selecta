# ADR-353 — Make a Mix front door: Quick Play and Create with Lucy as clear choices

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Make a Mix entry. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0216, ADR-0268, ADR-0283, ADR-0300, ADR-0301; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Mixes.tsx`; `web/src/shell/manifest.ts`; `web/src/styles/creation.css`.

## Context and source/evidence boundary

Make a Mix already has a one-tap recommended Play, mood cards, optional shaping and a visible Lucy link. This decision rethinks their relative hierarchy; it does not claim Lucy or Quick Play are missing. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Present two legible but asymmetrical paths: fast Quick Play remains the shortest listening route; Create with Lucy becomes an unmistakable alternative for intentional planning. No compulsory chat or hidden autoplay.

## User outcome and interaction contract

Novices can predict what both choices do, begin a Quick Mix or elect to describe a personal mix without surprise audio changes.

**Required negative cases:** First mix, current track playing, Lucy off, unavailable provider, not enough ready songs, small screen and Back to original entry.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-353-01 — Prototype two creation paths.** **Acceptance:** Quick Play and Create with Lucy have distinct purpose, language and consequence. **Required verification:** Uncoached first-choice expectation study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-353-02 — Keep Quick Play efficient.** **Acceptance:** One-tap route is not gated by AI and preserves existing replacement safeguards. **Required verification:** Quick Play regression and real-audio E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-353-03 — Create visible Lucy entry.** **Acceptance:** Lucy is presented as a core creation option without floating global bot chrome. **Required verification:** 5-second entry discovery test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-353-04 — Define prompt handoff.** **Acceptance:** If entry supports draft prompt text, opening Lucy pre-fills only; no auto-send or build. **Required verification:** Unsent-text and no-side-effect E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-353-05 — Reuse truthful readiness gate.** **Acceptance:** No-ready and setup states explain actual capability and optional fallback. **Required verification:** Zero/low-ready and provider-off fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-353-06 — Preserve shell routes.** **Acceptance:** Breadcrumb, history and return to Make a Mix/Library do not reset playing audio. **Required verification:** Navigation and audio-focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-353-07 — Specify balanced mobile layout.** **Acceptance:** Two choices remain readable and discoverable above mood options at narrow widths. **Required verification:** 320px/400% zoom and touch screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-353-08 — Validate decision confidence.** **Acceptance:** Users accurately choose faster listening versus planning based on intended outcome. **Required verification:** Novice and expert preference task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
