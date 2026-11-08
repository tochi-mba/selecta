# ADR-0177 — Library: expressive collection browsing and trustworthy track identity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0153, ADR-0154, ADR-0123; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Library.tsx; web/src/views/SongDetails.tsx; web/src/styles/operations.css.

## Context and evidence boundary

Library already scales to long lists and exposes readiness and metadata correction. An optional more visual browsing mode can make the collection enjoyable without destroying the practical list, adding guessed cover art or hiding important readiness explanations.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Accepted decision

- Keep searchable, sortable, deep-linked row list as the dependable management mode.
- Explore a visual browse option with stable decorative track identity derived from known data only.
- Expose readiness reason in every density including compact mode through accessible secondary action.
- Make Start a mix from a song preserve the starting song's identity across the generated journey.
- Show known song-specific word/harmonic links in details only when real candidate data exists.
- Distinguish measured metadata and a user's correction, with clear implications for transitions.

## Visual, animation and microinteraction contract

- Switching list and visual browse never resets query, sort, filter or player state.
- Confirmed Add/Priority/Play next update only affected item; no decorative shifts of unrelated rows.
- No remote artwork lookup from file title and no hidden endless grid animations.

## Alternatives and trade-offs

Prefer the existing restrained and proven UI when added visuals distract or reduce correctness. No artificial music, artwork, beat, lyric accuracy, quality score or fake render status. All sensory interactions require a usable static, keyboard, high-contrast and reduced-motion alternative. Source truth and explicit human consent outrank polish.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0177-01 — Prototype alternative song browse layout.** **Acceptance:** Song/artist legible and unknown artwork doesn't imply a real cover. **Required verification:** 1000-song and missing-art fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0177-02 — Preserve list feature parity and deep links.** **Acceptance:** Query/filter/sort/density/search continue identically. **Required verification:** URL and pagination/regression tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0177-03 — Surface readiness reasons at every density.** **Acceptance:** Blocked song's reason accessible in compact and card layouts. **Required verification:** Readiness and screen-reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0177-04 — Connect Start a mix to song identity.** **Acceptance:** Chosen source track identifiable in resulting set. **Required verification:** Build response and route tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0177-05 — Expose validated related discoveries.** **Acceptance:** Only existing song connections with candidate labels displayed. **Required verification:** No links/partial analysis fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0177-06 — Clarify measured versus corrected BPM/key.** **Acceptance:** Active override and restoration consequence transparent. **Required verification:** Correction/reanalysis/rerender tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0177-07 — Validate performance and browser access.** **Acceptance:** Large collection remains responsive with keyboard-first list available. **Required verification:** Scroll/frame/zoom and assistive technology review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0153, ADR-0154, ADR-0123; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Accepted; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
