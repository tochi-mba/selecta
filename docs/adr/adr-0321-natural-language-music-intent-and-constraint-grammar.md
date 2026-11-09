# ADR-0321 - Natural-language mix intent, hard/soft constraints and contradiction handling

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Proposal engine. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0117, ADR-0143, ADR-0169, ADR-0217, ADR-0222, ADR-0237; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/planner/arc.py`; `src/selecta/planner/vibes.py`; `src/selecta/session.py`.

## Context and source boundary

Users may ask for a feeling, destination, familiarity, duration, energy journey, exact songs, keep/exclude constraints and ready-only requirements in a single informal request. Unstructured prompt instructions do not enforce those requirements. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Translate language into typed constraints with kind,target,value,strength,source,scope,createdTurn,supersedes and status. Hard constraints are validators; soft preferences influence ranking. Clarify only truly ambiguous referents or impossible trade-offs; current explicit request overrides inferred taste.

## Interaction and evidence contract

Proposal shows compact intent summary and editable chips for hard rules. Follow-up 'make it faster' changes pace preference without discarding locked ending or global exclusions.

**Negative cases:** 'faster' perceived tempo vs BPM, 'my favourites' without history, explicit-content filtering without metadata, 30 exact minutes, fixed all songs and half duration, no Afrobeats after previous request, selected duplicate.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-321-01 - Define canonical intent schema.** **Acceptance:** All supported user terms map to typed constraints with provenance. **Required verification:** Schema and intent corpus. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-321-02 - Distinguish hard/soft scope.** **Acceptance:** Must/never/locked/ready-only enforceable; prefer/ideally are weighted. **Required verification:** Constraint solver property tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-321-03 - Resolve evolving preferences.** **Acceptance:** Latest specific instruction supersedes matching old soft rule only. **Required verification:** Five-turn conversation tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-321-04 - Model exact song anchors.** **Acceptance:** Song recording, occurrence, slot, relative order and destination differ. **Required verification:** Duplicate-title/slot-lock tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-321-05 - Detect contradictions.** **Acceptance:** Infeasible simultaneous demands produce explicit conflicts, not hidden relaxation. **Required verification:** Impossible-duration/locked-exclude fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-321-06 - Represent uncertainty honestly.** **Acceptance:** Unknown clean label, perceived danceability or favourites do not become invented facts. **Required verification:** Sparse-metadata and no-history eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-321-07 - Design constraint editor.** **Acceptance:** User can inspect and remove/relax each rule with precise consequence. **Required verification:** Mobile/desktop rule editing test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-321-08 - Benchmark intent quality.** **Acceptance:** Measure precision/recall of parsed hard constraints and clarification quality. **Required verification:** Human-labelled paraphrase eval set. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Accepted; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
