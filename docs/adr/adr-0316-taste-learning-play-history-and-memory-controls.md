# ADR-0316 — Listening history, evidence-backed taste learning and opt-in memory

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P1 / Personalisation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0109, ADR-0227, ADR-0238, ADR-0255; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/db.py`; `src/selecta/planner/memory.py`; `web/src/player.ts`; `web/src/state/prefs.ts`.

## Context and source boundary

Selecta already remembers transition quality and ratings but inspected schema does not show persisted play-count events. Lucy cannot accurately name 'most played' until a new listening-event contract exists. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Implement privacy-controlled player observation of starts, meaningful listens, completions, skips and repeats; separate full-track listens from seam/stem auditions, and calculate aggregates with uncertainty. Explicit preferences, inferred patterns and temporary requests have separate scopes and editable evidence.

## Interaction and evidence contract

'What Lucy knows' lists explicit choices, observed counts and unknown facts with source dates. Disable/clear history works without affecting audio or ratings unrelated to history.

**Negative cases:** Play while paused, cross-tab audio owner, short auditions, repeat cue, same recording in multiple mixes, skip by app interruption, history opt-out, backup restore and missing song.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-316-01 — Define listening event semantics.** **Acceptance:** Starts, heard duration, completed, skipped and replay have auditable thresholds and session provenance. **Required verification:** Deterministic player clock fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-316-02 — Respect one audio owner.** **Acceptance:** Only authoritative playback contributes; preview/Studio audition excluded or tagged separately. **Required verification:** Multi-tab/media focus integration. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-316-03 — Implement privacy controls.** **Acceptance:** History collection, retention, clear and exclude controls are explicit and reversible where appropriate. **Required verification:** Opt-in/out and data deletion tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-316-04 — Compute honest most-played.** **Acceptance:** Top songs derived only from real persisted events with counts and period. **Required verification:** No-history/duplicate/partial-play tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-316-05 — Reuse transition feedback.** **Acceptance:** Aggregate directed rated seam evidence without claiming historical cached audio is ready now. **Required verification:** SeamMemory/ratings integration. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-316-06 — Separate explicit and inferred taste.** **Acceptance:** Source, sample size and confidence accompany derived preference; user rule wins. **Required verification:** Sparse evidence and disagreement eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-316-07 — Show memory explanation UI.** **Acceptance:** Users inspect/edit/forget preferences and see which data remote AI receives. **Required verification:** Privacy comprehension and keyboard E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-316-08 — Validate retention and migration.** **Acceptance:** New history tables survive local backup/relink while respecting data-home scope. **Required verification:** Migration/restore/cross-home tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Proposed; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
