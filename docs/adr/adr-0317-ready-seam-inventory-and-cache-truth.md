# ADR-0317 — Existing rendered-transition inventory, exact seam keys and cache truth

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Ready-only. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0101, ADR-0151, ADR-0172, ADR-0221, ADR-0237; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/seams.py`; `src/selecta/mix.py`; `src/selecta/routes/edit.py`; `src/selecta/planner/memory.py`.

## Context and source boundary

SeamStore.status(key) can report a ready rendered seam, while SeamMemory also retains historical clean attempts after disposable audio is evicted. These are not equivalent. A ready-only mix needs actual usable audio for the exact directed request. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Specify a read-only indexed inventory of exact A→B render keys, requested move/settings, applied move, fallback, validation result, existing clip presence/decodability and source-analysis validity. Separate cached-playable edges from historical-proven/failed/queued/unknown edges.

## Interaction and evidence contract

Lucy's transition card distinguishes Already rendered and available, Rendered before but audio no longer cached, Ready with warning, Waiting and Not tried. Display provenance and actual applied technique.

**Negative cases:** Evicted clip with retained history, stale state file, rules-version mismatch, move-specific key, reversed pair, fallback style, near-miss, reanalysed audio, corrupt FLAC, simultaneous cache cleanup.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-317-01 — Define strict edge identity.** **Acceptance:** Directed A→B plus exact SeamRequest settings and immutable key identify ready candidate. **Required verification:** Request key/recipe/ordering fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-317-02 — Enumerate cache safely.** **Acceptance:** Indexed retrieval avoids O(n²) filesystem scans and unbounded model transfer. **Required verification:** Large seam-store profiling. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-317-03 — Separate current versus historical.** **Acceptance:** SeamMemory.clean/liked alone never qualifies as currently playable. **Required verification:** Eviction history negative test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-317-04 — Verify playable artefacts.** **Acceptance:** status ready, present decodable clip, current source/analysis and accepted quality policy required. **Required verification:** Missing/corrupt/stale clip tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-317-05 — Expose actual technique and fallback.** **Acceptance:** Requested versus rendered style and audit checks are kept distinct. **Required verification:** Fallback and near-miss fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-317-06 — Handle concurrent cache eviction.** **Acceptance:** Inventory carries snapshot/version; validation rechecks before use. **Required verification:** Eviction race during read/approval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-317-07 — Provide typed ready seam tools.** **Acceptance:** transitions.readyInventory/readyFrom/readyTo and result refs are bounded. **Required verification:** WeftAI collection and cap tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-317-08 — Deliver transparent mini UI.** **Acceptance:** Exact ready status, known-only evidence and explanation are readable on all devices. **Required verification:** AT/mobile/provenance comprehension test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Proposed; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
