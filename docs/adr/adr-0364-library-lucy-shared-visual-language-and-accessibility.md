# ADR-0364 — Library + Lucy shared art direction, theme, motion and accessibility contract

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Shared design. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0200, ADR-0202, ADR-0233, ADR-0234, ADR-0275, ADR-0309, ADR-0336; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/styles/tokens.css`; `web/src/styles/operations.css`; `web/src/styles/lucy.css`; `web/src/ui/Icon.tsx`.

## Context and source/evidence boundary

Selecta has established semantic tokens, compact density, Light/Dark/System themes, Still/reduced motion and icon primitives. A focused redesign should feel integrated, not like an unrelated assistant app. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Adopt one restrained music-first visual grammar spanning Library and Lucy: clear title rhythm, purposeful surface depth, truthful state colours, real/provenance-backed imagery and accessible controls. No blanket global restyle.

## User outcome and interaction contract

The same song and readiness state are recognisable across collection and proposal, with a coherent feel on desktop/mobile and in every theme.

**Required negative cases:** Forced colours, system theme switch, bright/lime contrast, missing artwork, RTL, zoom, touch, Still and unsupported graphics.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0364-01 — Define area-specific design tokens.** **Acceptance:** Document reused typography, spacing, surfaces and focus colours with scope boundaries. **Required verification:** CSS owner and computed-state audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0364-02 — Standardise song identity motifs.** **Acceptance:** Exact song identity stays recognisable in Library and Lucy, no invented artwork. **Required verification:** Cross-route motif and provenance review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0364-03 — Tune information hierarchy.** **Acceptance:** Primary track/mix object outranks AI decoration, metadata and advanced controls. **Required verification:** Paired light/dark visual critique. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0364-04 — Specify semantic state palette.** **Acceptance:** Ready, planned, working, blocked, saved and playing use labels plus non-colour differences. **Required verification:** Contrast, forced-colour and AT status audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0364-05 — Apply practical target sizes.** **Acceptance:** WCAG 2.2 AA target-size criterion with generally 44px touch controls where feasible. **Required verification:** Hitbox matrix and documented exceptions. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0364-06 — Document motion rules.** **Acceptance:** Animations map to genuine state transitions; Still and reduced motion remove decoration. **Required verification:** OS plus app motion setting tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0364-07 — Protect international text.** **Acceptance:** Long/RTL/CJK titles, timing and numeric alignment remain readable at 400% zoom. **Required verification:** Locale/zoom screenshot and keyboard fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0364-08 — Approve visual cohesiveness.** **Acceptance:** Named reviewers compare both routes with actual songs, light/dark and active-player screenshots. **Required verification:** Independent dated art/AT review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
