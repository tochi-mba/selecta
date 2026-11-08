# ADR-0318 — Strict ready-only mix generation using available rendered seams

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Ready-only. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0100, ADR-0101, ADR-0221, ADR-0237, ADR-0297; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/planner/beam.py`; `src/selecta/planner/vibes.py`; `src/selecta/seams.py`; `src/selecta/mix.py`.

## Context and source boundary

The existing planner prefers known successful transitions but does not promise every chosen transition is presently rendered and available. Lucy must answer 'make me a mix only from transitions already ready' without silently queuing missing seams. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Add a hard ready_only=true planning mode over directed graph G=(eligible recordings, exact currently playable directed render edges), with no new seam render or analysis permitted. A K-song route requires K-1 verified ready directed edges, global entry/exit timing feasibility, uniqueness/artist/lock/destination constraints and actual clip availability. Never substitute an unrendered blend or fallback.

## Interaction and evidence contract

Show 'Ready transitions only' with N verified of N-1 required seams, candidate/usable graph statistics and truthful duration/quality notices. If no route meets requirements, offer a shorter mix, other endpoint, or explicit relaxation—not a fake complete set.

**Negative cases:** Graph disconnected, isolated destination, scarce cached edges, wrong direction, edge pair counted twice, ready-but-failed audit, entry-after-prior-exit conflict, pinned tracks, source replacements, cache eviction, ready-only with one song.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-318-01 — Define hard ready-only intent.** **Acceptance:** User phrases 'only transitions already ready/no rendering' become non-relaxable generation flag. **Required verification:** Intent and consent classifier eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-318-02 — Build directed playable-edge graph.** **Acceptance:** Nodes are eligible recordings; edges are exact playable on-disk cached seams with qualifying audit. **Required verification:** Graph construction and key tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-318-03 — Plan constrained complete paths.** **Acceptance:** All adjacent directed edges exist; no guessed handoffs or automatic render jobs. **Required verification:** Property-based no-missing-edge tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-318-04 — Validate global cue continuity.** **Acceptance:** Previous seam into-track end permits next outgoing seam start; reject 'too_soon' chains. **Required verification:** Three-or-more-seam timing fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-318-05 — Respect other hard constraints.** **Acceptance:** Locked occurrences, song count, exclusions, destination, no repeats and duration checked together. **Required verification:** Infeasible and sparse graph cases. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-318-06 — Guarantee no background new renders.** **Acceptance:** Building ready-only draft cannot enqueue any seam or automatic new analysis as side effect. **Required verification:** Worker/job count before/after E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-318-07 — Handle cache freshness and pinning.** **Acceptance:** Revalidate before commit/playback; retain referenced clips via bounded lease/pin or explain cannot guarantee future readiness. **Required verification:** Eviction/readiness race and disk pressure test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-318-08 — Expose explicit failure/relaxation UX.** **Acceptance:** No qualifying path returns computed limits and user-selectable new request, never hidden constraint relaxation. **Required verification:** Disconnected graph/mobile/AT user study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Accepted; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
