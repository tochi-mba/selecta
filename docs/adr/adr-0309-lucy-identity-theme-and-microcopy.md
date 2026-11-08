# ADR-0309 — Lucy visual identity, Selecta tokens, motion grammar and human language

- **Decision:** Proposed (owner review pending; docs-only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P1 / Visual language. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0200, ADR-0201, ADR-0202, ADR-0205, ADR-0207, ADR-0242, ADR-0296; unchanged.
- **Source touchpoints:** `web/src/styles/tokens.css`; `web/src/styles/creation.css`; `web/src/ui/Icon.tsx`.

## Context and evidence boundary

Selecta has an established warm dark/cream/lime aesthetic, meaningful state colours, Still/subtle/expressive motion and a music-first information hierarchy. Lucy must not appear as a separate purple neon chatbot. This new decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Use Selecta semantic tokens, typography and existing UI primitives; choose a restrained audio-thread icon; make musical objects outrank assistant decoration. Standardise microcopy for proposed/evaluated/rendered/saved/playing with evidence labels and quieter completed states.

## UI/UX and evidence contract

Assistant identity is recognisable but compact; tool mini visuals are task-specific and never claim fake audio. No unnecessary avatar, decorative pulsing orb, unsolicited notification sounds or meaningless celebration.

**Required negative cases:** Light mode lime contrast, dark panels, compact density, reduced motion, high contrast, long names, loading in small height, status colour ambiguity.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-309-01 — Define Lucy identity.** **Acceptance:** Icon, name, avatar alternative and label fit Selecta without separate brand chrome. **Required verification:** Visual comparison with Make a Mix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-309-02 — Reuse semantic palette.** **Acceptance:** All surfaces, borders, focus and states use theme variables. **Required verification:** Light/dark/system contrast matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-309-03 — Specify type and density.** **Acceptance:** Composer, tool card and proposal text respect readable type and compact mode. **Required verification:** Typography/zoom snapshot tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-309-04 — Define motion choreography.** **Acceptance:** Animation duration/cause/token table; Still means no decorative motion. **Required verification:** Motion trace and OS override tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-309-05 — Define status microcopy.** **Acceptance:** Idea, candidate, proposed, approved, saved, rendering, ready and playing never conflate. **Required verification:** Comprehension and status fixture review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-309-06 — Avoid false claims.** **Acceptance:** No 'perfect transition' or unknown BPM/score/ready assertions. **Required verification:** Generated response policy eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-309-07 — Standardise fallback surfaces.** **Acceptance:** Missing art/analysis uses existing visual grammar, no random stock cover. **Required verification:** Missing-data snapshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-309-08 — Approve human art direction.** **Acceptance:** Named product reviewer tests Lucy beside existing cards/editor in both themes. **Required verification:** Paired visual signoff with exact SHA. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
