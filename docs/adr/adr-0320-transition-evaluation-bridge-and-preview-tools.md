# ADR-0320 - Transition evaluation, provenance, directed alternatives, bridges and auditions

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Music tools. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0101, ADR-0172, ADR-0221, ADR-0225, ADR-0260; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/planner/choose.py`; `src/selecta/planner/prepare.py`; `src/selecta/routes/edit.py`; `src/selecta/routes/discover.py`.

## Context and source boundary

Selecta has enumerated transition candidates, seam ratings, word/harmonic discoveries and an audition/preview system. These differ in certainty and should never be collapsed into one generic 'compatible' result. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Provide transitions.candidates/evaluate/explain/alternatives/history/ratings/wordLinks/harmonicLinks/bridgeCandidates/renderStatus/previewInfo/compare. Preserve directed pair and actual requested versus rendered move; return available preview pointers without starting audio.

## Interaction and evidence contract

Lucy shows compact A→B cards and their evidence levels: suggested, evaluated, previously rendered, available playable, auditioned. 'Hear' is explicit and uses existing player focus rules.

**Negative cases:** Reverse pairs, untrusted lyric timing, no stem/cue, failed or near-miss render, fallback from requested style, no preview clip, worker busy, already-playing media and request bridge consent.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-320-01 - Expose directed transition types.** **Acceptance:** A→B and B→A carry separate keys, evidence and results. **Required verification:** Reverse pair conformance fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-320-02 - Reuse candidate evaluation.** **Acceptance:** Return real tempo/key/cue/vocal overlap and actual move options. **Required verification:** Planner evaluation parity. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-320-03 - Represent provenance levels.** **Acceptance:** Predicted, history-only, playable and user-rated outcomes never conflated. **Required verification:** Evicted seam/memory comparison test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-320-04 - Offer alternatives and bridges.** **Acceptance:** Search real library with cost and feasible route; request bridges retain existing consent. **Required verification:** Bridge planning and request parity. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-320-05 - Explain known word/harmonic links.** **Acceptance:** Only verified retrieved phrases/matches appear, with limitations. **Required verification:** Lyrics absent/uncertain test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-320-06 - Preserve audition audio ownership.** **Acceptance:** Read-only result cannot autoplay; explicit preview obeys focus and Stop policies. **Required verification:** Real audio and media-session test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-320-07 - Render transition mini cards.** **Acceptance:** Actual pair names, direction, move, readiness and warnings accessible. **Required verification:** Theme/RTL/touch and AT review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-320-08 - Bound expensive pair checks.** **Acceptance:** Reuse cached data; cap candidates and enforce user-approved render requests. **Required verification:** Large candidate/time-budget test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Accepted; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
