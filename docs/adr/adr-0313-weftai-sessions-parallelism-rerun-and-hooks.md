# ADR-0313 — WeftAI sessions, parallel plans, rerun, caching and progress hooks

- **Decision:** Proposed (owner review pending; docs-only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / WeftAI. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0052, ADR-0095, ADR-0236, ADR-0237, ADR-0297; unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/routes/helpers.py`; `src/selecta/db.py`.

## Context and evidence boundary

WeftAI's default session is 'default'; in-memory results expire and plan histories are bounded. Cross-turn Lucy needs explicit per-conversation sessions, safe rehydration and event hooks without confusing plan reruns with saved proposal revisions. This new decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Derive scoped session IDs; configure limits, explicit operation allowlists, typed result caches and source version checks. Use hooks for start/completion/error and handler-level progress for long jobs. Treat rerun as plan repair only, never user approval or a mutation replay.

## UI/UX and evidence contract

Each real operation maps to one tool card with progress and retry identity; expired results produce requery/recovery rather than guessed data.

**Required negative cases:** Result eviction, stale library snapshot, same step ID reuse, invalid ordinal, cancelled dependency, failed write, concurrent reads, expired plan store and restart across turns.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-313-01 — Scope all WeftAI sessions.** **Acceptance:** Every conversation and data home has isolated result/plan namespace. **Required verification:** Cross-conversation reference rejection tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-313-02 — Set explicit resource limits.** **Acceptance:** Max steps, parallel reads, step/plan timeouts and result caps are configured. **Required verification:** Timeout and overload tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-313-03 — Emit step lifecycle hooks.** **Acceptance:** before/after/error hooks produce durable, ordered activity records. **Required verification:** Hook/event mapping snapshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-313-04 — Support measured handler progress.** **Acceptance:** Long operations send progress safely without inventing work percentages. **Required verification:** Long job fake-progress contract tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-313-05 — Rehydrate expired read results.** **Acceptance:** Stable IDs and snapshot versions allow bounded requery after TTL/eviction. **Required verification:** Restart/TTL/cache invalidation tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-313-06 — Separate rerun and proposal revision.** **Acceptance:** WeftAI plan rerun cannot masquerade as revised song order or approval. **Required verification:** State boundary tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-313-07 — Guard writes on replay.** **Acceptance:** Successful writes not repeated by automatic rerun; host enforces approval and idempotency. **Required verification:** Write-rerun refusal and fault injection. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-313-08 — Test parallel dependency semantics.** **Acceptance:** Independent reads overlap; dependent steps and writes observe correct order. **Required verification:** Deterministic concurrency scheduler tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
