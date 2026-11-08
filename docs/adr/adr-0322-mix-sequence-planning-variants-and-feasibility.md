# ADR-0322 — Evidence-backed sequence planning, musical objectives and meaningful variants

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Proposal engine. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0100, ADR-0117, ADR-0143, ADR-0169, ADR-0217, ADR-0222; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/planner/beam.py`; `src/selecta/planner/vibes.py`; `src/selecta/planner/arc.py`.

## Context and source boundary

Selecta's deterministic beam planner scores energy, handoffs, artist spacing, memory and destinations; Lucy must build on it rather than letting an LLM invent track orders and arbitrary scores. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Introduce a constrained planning contract accepting eligible collections, target duration, hard and soft rules, fixed anchors, destination, familiarity/discovery weighting, expected transition quality and optionally strict ready_only mode. Return ordered candidate proposals with objective breakdown and evidence, not fabricated certainty.

## Interaction and evidence contract

Present one strong default, with 2–3 genuinely different variant routes only when useful. Explain approximate playback time, energy profile, compromises and selected songs.

**Negative cases:** Short library, short/long target, no path to ending, sampled genres, low-confidence analysis, exact duration impossible, poor artist diversity and budget exhausted.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-322-01 — Specify planning request/response.** **Acceptance:** Track IDs, constraints, target duration and provenance have typed schemas. **Required verification:** Planner contract snapshot. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-322-02 — Integrate existing planner.** **Acceptance:** Reuse beam/arc/SeamMemory rather than model-generated unvalidated songs. **Required verification:** Deterministic library fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-322-03 — Enforce hard requirements.** **Acceptance:** Every candidate order validated against all hard rules before display. **Required verification:** Property-based constraint tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-322-04 — Compute realistic timing.** **Acceptance:** Approximate actual playtime accounting for transition overlap uncertainty, not source sum only. **Required verification:** Rendered-versus-estimated study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-322-05 — Evaluate full journey.** **Acceptance:** Start/middle/peak/end, variety and directed seams assessed holistically. **Required verification:** Music sequence fixture review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-322-06 — Generate distinct variants.** **Acceptance:** Variants differ by objective/constraint weight and retain independent identity. **Required verification:** Similarity diversity test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-322-07 — Report feasibility warnings.** **Acceptance:** Weak seams, missing data and unavailable destination explained without overclaim. **Required verification:** Unreachable/unknown warning tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-322-08 — Validate human musical merit.** **Acceptance:** Compare proposed sequences to existing one-tap path in real listening tests. **Required verification:** Stratified blind listener comparisons. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Accepted; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
