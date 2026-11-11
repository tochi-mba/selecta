# ADR-0266 - Live theme parity for musical data graphics

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 5/8 Implemented; 0/8 In progress; 3/8 Not started.
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta final polish FP, 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority/phase:** P0 / Theme and music graphics.
- **Owner:** Unassigned.
- **Existing primary owners:** ADR-0201, ADR-0207, ADR-0212, ADR-0214, ADR-0222, ADR-0223, ADR-0234; historical states unchanged.
- **Source touchpoints:** `web/src/views/Now.tsx`; `web/src/views/spectrumVisuals.ts`; `web/src/ui/MusicObjects.tsx`; `web/src/styles/music-objects.css`; `web/src/views/Studio.tsx`.

## Context and evidence boundary

Listen already repaints a real-audio spectrum canvas using effective theme tokens, and 15 existing visualizer modes must be retained. The music waveform, energy arc, seam states and Studio cells use separate rendered marks. No full live theme-switch semantic parity report is present in the earlier plans.

This source-derived gap is a hypothesis, not independently reproduced UI, accessibility, audio or research proof. Already implemented capabilities must not be counted as missing.

## Novel delta and proposed decision

**Additive acceptance:** Add a live-theme **state parity** contract across existing graphical music objects, rather than rebuilding canvas spectrum rendering or redefining the older music-visual grammar.

**Decision:** Switching Light/Dark/System while music or an edit is active preserves exact underlying data, selection and audio, with meaningful marks re-rendered promptly using the newly effective palette. Status distinctions are readable without hue alone.

**Alternatives:** Keep current presentation if research disproves the problem; refine existing components only, not a broad redesign.

## Implementation checklist - 5/8 Implemented; 0/8 Verified

1. **FP-0266-01 - Inventory graphical semantic states.** **Acceptance:** List rendered roles, source and colour/treatment for waveform playhead, seek marker, transition countdown, spectrum, seam, energy and eight-lane Studio states. **Required verification:** Graphic state/source inventory with source paths **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** docs/engineering/music-graphics-inventory.md (26 states: waveform, playhead, seek marker, countdown, 15-style spectrum, seam, route, energy, Studio cell and lane, each with source, CSS rule, treatment and non-colour cue); web/src/styles/music-graphics-inventory.test.ts 'music graphics inventory (FP-0266-01)' checks every source and rule exists and holds only tokens (passed 2026-11-11); independent reviewer -.
2. **FP-0266-02 - Preserve music-data identity.** **Acceptance:** A theme switch changes presentation but neither recorded frequency data nor requested/measured energy, selected seam, cue or Studio cell value. **Required verification:** State equality tests and real-audio observation **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **FP-0266-03 - Measure theme-specific mark readability.** **Acceptance:** Meaningful markers, selection and control edges are distinguishable from adjacent surfaces in both themes, with semantic text/shape support. **Required verification:** Theme pair contrast and grayscale specimen audit **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/styles/music-graphics-inventory.test.ts 'theme-pair mark readability (FP-0266-03)': meaningful marks against their surfaces in Light and Dark, luminance-only so it also holds in grayscale, with the inventory's 'Without colour' column for shape and text (passed 2026-11-11); independent reviewer -.
4. **FP-0266-04 - Repaint live canvas consistently.** **Acceptance:** No stale-theme canvas gradients linger after manual or OS theme change; rendering continues from actual audio clock. **Required verification:** Frame capture while playing, switching and hiding/showing **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **FP-0266-05 - Retain all existing spectrum modes.** **Acceptance:** All 15 spectrum styles remain available and render only real mixed-audio input; silence remains quiet. **Required verification:** Visualizer mode/real-silence regression tests **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/spectrumVisuals.test.ts 'fifteen width-first real-audio visualizations': all 15 modes declared with unique labels, each never draws from missing or silent samples (passed 2026-11-11); independent reviewer -.
6. **FP-0266-06 - Keep transition and energy provenance.** **Acceptance:** Requested, planned, rendered and currently audible states retain their separate legends; intended energy is not mislabeled as achieved. **Required verification:** Music object fixtures and truth/provenance review **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/ui/MusicObjects.test.tsx 'keeps requested and measured energy explicitly separate', 'never calls an automatic unrendered transition a confirmed technique', 'keeps queued, rendering, failed and rendered Thread states distinct'; legends listed in docs/engineering/music-graphics-inventory.md (passed 2026-11-11); independent reviewer -.
7. **FP-0266-07 - Preserve Studio grid equivalence.** **Acceptance:** Shape, Grid and List retain identical exact eight-lane/8–64-cell edits and focus/solo distinctions after theme changes. **Required verification:** Keyboard/touch/AT and stale-change tests **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence/reviewer:** web/src/views/Studio.test.tsx 'keeps every square, solo and mode the same through Light, Dark and System (FP-0266-07)': 64 cells identical in grid and list after each theme, edited shape still sent to the deck (passed 2026-11-11); independent reviewer -.
8. **FP-0266-08 - Independently verify live-theme graphics.** **Acceptance:** For each critical graphic record light/dark capture, SHA, browser/device, real audio and reviewer verdict; release blocks on missing P0 evidence. **Required verification:** Signed cross-theme state report **Implementation:** Not started; Needs a person: per critical graphic a light/dark capture with SHA, browser/device, real audio and a named reviewer's verdict; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -; independent reviewer -.

## Invariants, negatives and evidence

**Area-specific:** silent/paused spectrum, pending/failed transition, missing beat grids, 64-cell Studio, Stage, hidden canvas, zoom, forced-colors, reduced motion, live switching at a seam.

**Shared negatives:** light/dark/system, 320–2560px, short landscape, 400% zoom, forced-colours, Still/reduced motion, long/RTL/Unicode or duplicate song metadata, loading/empty/offline/stale/failed states, keyboard, touch, NVDA, real music when relevant.

**Safety:** Original local audio unchanged; one audio owner/intentional Pause; exact song, seam and draft/current revision; scoped Undo; explicit atomic bridge consent; eight Studio lanes and 8–64 cells; truthful Library, LRCLIB disclosures and statuses; neutral A/B studies; frozen-revision decodable FLAC. No new SaaS, cloud music, telemetry, native launcher, unauthorized media or backend rewrite.

**Independent proof:** Computed mark-to-surface contrast audit and matching real-playback screenshots with visual, AT and audio reviewers. Reviewer name/date/OS/browser/device, exact implementation source SHA, outcome denominators, failing cases and rollback evidence mandatory. Muted synthetic E2E and screenshot candidates are not independent verification.

## Status transitions and references

Proposed → Accepted/Rejected/Superseded requires explicit dated owner rationale; Not started → In progress → Implemented requires exact source/test PR and SHA; Independently Verified requires separately witnessed named evidence. Merging this documentation ADR does **not** change any task status in this or an older programme.

[Roadmap](selecta-final-polish-roadmap.md) · [Checklist](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Release gates](selecta-final-polish-release-gates.md).
