# ADR-0323 — Immutable proposed mixes, exact identity, readiness and source-backed versions

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Proposals. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0207, ADR-0219, ADR-0228, ADR-0237, ADR-0238; statuses and ownership unchanged.
- **Source touchpoints:** `src/selecta/db.py`; `src/selecta/mix.py`; `web/src/views/EditorHeader.tsx`.

## Context and source boundary

A proposal is not a real draft, a chat paragraph or a WeftAI temporary result. Users need a durable artifact they can inspect, revise, compare, approve and return to after session expiry. A documentation decision is not feature implementation, real-audio acceptance or a claim that existing source is defective. Reconcile related accepted ADRs and source at the implementation SHA.

## Proposed decision

Persist Proposal with immutable Revision snapshots, canonical hash, exact song occurrence IDs, scoped constraints, directed seam intentions, evaluation evidence, planner/source versions and active pointer. Historic cards remain snapshots; only an explicitly chosen current revision may be approved.

## Interaction and evidence contract

Every proposal card says exact revision and Not built; older versions can be inspected or restored as new revisions. The current proposal stays accessible without scrolling backwards.

**Negative cases:** Two occurrences of same recording, stale Library, expired WeftAI refs, deleted conversation, cross-tab edit, backup restore, commit partial failure and old cards after newer revision.

## Alternatives and rejected shortcuts

Do not equate historical transition-memory success to playable cached media; do not use model prose as music evidence or build a differently generated order after approval. Reuse the existing local music engine and current/draft authority; any new cache index or planner mode needs direct regression proof. For non-ready-only features, this restriction is relevant when requested.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-323-01 — Define proposal and revision schema.** **Acceptance:** Immutable song-order snapshots include occurrence/seam IDs and canonical hash. **Required verification:** Schema/migration and hash determinism. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-323-02 — Persist beyond WeftAI TTL.** **Acceptance:** Reopen multi-day conversation with exact proposal even after result eviction. **Required verification:** TTL/restart and resume tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-323-03 — Store evidence and provenance.** **Acceptance:** Source/analysis/planner version, warnings and quality state tied to snapshot. **Required verification:** Provenance update tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-323-04 — Keep historical cards immutable.** **Acceptance:** Old messages and snapshots do not mutate when new revision appears. **Required verification:** Revision history UI snapshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-323-05 — Separate proposal from drafts.** **Acceptance:** Not built is distinct from saved draft and rendering/playing identities. **Required verification:** State-machine E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-323-06 — Handle concurrent revision writes.** **Acceptance:** Expected parent/current revision check blocks stale overwrite. **Required verification:** Two-tab compare-and-swap test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-323-07 — Invalidate stale readiness safely.** **Acceptance:** History stays readable while current build eligibility is revalidated. **Required verification:** Missing track and source change tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-323-08 — Support home/backup boundary.** **Acceptance:** Proposal data included in documented backup policy, isolated by data-home. **Required verification:** Backup-restore migration and cross-home test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Hard preservation and evidence gate

Original local media untouched; one audio owner and intentional Pause; exact scopes, song occurrences, seams and Undo; explicitly consented atomic request bridges; eight Studio stem lanes and 8–64 cells; truthful source/lyrics readiness; unbiased blind studies; frozen-revision decodable FLAC. Test missing/stale/failed/evicted/cache race cases, mobile/zoom/RTL, accessibility and real audio as relevant. Independent proof must cite named reviewer/date/platform and exact implementing source SHA.

## Status and programme links

Decision Proposed; all 8 tasks Not started; none independently Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [ready-only contract](selecta-lucy-ready-transitions-contract.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
