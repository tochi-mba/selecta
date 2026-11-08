# ADR-0319 — Ready-only request controls, proof, trade-offs and playback-ready outcome

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Ready-only UX. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0117, ADR-0216, ADR-0228, ADR-0237, ADR-0268; statuses and ownership unchanged.
- **Source touchpoints:** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`; `web/src/views/Mix.tsx`; `web/src/api.ts`.

## Context and source boundary

A user may ask Lucy to create a mix that plays immediately without waiting for transitions. Preference for cached seams is different from a guarantee to use only currently verified, fully playable seams. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Expose strict 'Only already-ready transitions' as a recognizable user-visible constraint, separate from 'Prefer ready transitions' and ordinary mix planning. Mark every proposed edge with its exact ready state; count songs/seams correctly and recheck at approval and playback.

## Interaction and evidence contract

Lucy can say 'I found 9 tracks connected by 8 existing ready transitions. No new rendering is needed for this proposal.' only if independently verified at that moment. Missing edges block Build draft in strict mode rather than triggering workers.

**Negative cases:** One-song route (zero seams), no valid route, user sets too many songs, pinned ending unreachable, cache evicts between proposal and commit, near-miss transition, storage full, hidden render queue scheduling.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-319-01 — Interpret strict vs preference mode.** **Acceptance:** Natural-language request and UI chip distinguish ready_only from prefer_ready. **Required verification:** Paraphrase intent eval and UI test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-319-02 — Make strict filter visible.** **Acceptance:** Current proposal and every revision show active hard 'already rendered' rule. **Required verification:** Constraint persistence E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-319-03 — Display real seam ledger.** **Acceptance:** Each adjacent exact request shows status, actual move, source and playable-audio proof. **Required verification:** Ready/evicted/near-miss fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-319-04 — Show ready count accurately.** **Acceptance:** N tracks require max(0,N-1) incoming transitions, without double counting. **Required verification:** 1/2/long mix count tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-319-05 — Explain scarce connected paths.** **Acceptance:** No-route state gives feasible shorter options or asks permission to relax rules. **Required verification:** Sparse directed graph novice test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-319-06 — Revalidate approval semantics.** **Acceptance:** Approve/build cannot use stale ready-only snapshot or auto-queue missing audio. **Required verification:** Concurrent eviction/commit tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-319-07 — Preserve instant-play expectation.** **Acceptance:** Only claim playable now if all clips and sources still valid, no render waits. **Required verification:** Cold playback across exact ready graph. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-319-08 — Support accessible compact proof.** **Acceptance:** Phone and AT users can inspect constraints without opening every seam. **Required verification:** 320px/400% zoom/keyboard and screen reader test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Accepted; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
