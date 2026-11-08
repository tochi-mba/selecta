# ADR-0310 — Per-call system context, persistent taste facts and memory priority

- **Decision:** Proposed (owner review pending; docs-only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Memory. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0237, ADR-0238, ADR-0227, ADR-0271; unchanged.
- **Source touchpoints:** `src/selecta/session.py`; `src/selecta/db.py`; `src/selecta/routes/system.py`.

## Context and evidence boundary

Lucy needs fresh authoritative state each tool cycle; reusing stale prompt summaries as facts risks wrong draft scope, hallucinated most-played songs and lost user constraints. This new decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Build a typed prompt context per model invocation from stable behaviour instructions, live Selecta state, explicit preferences, evidence-backed taste summaries, relevant conversation recap and immutable proposal pointer. The database is the memory; prompt text is a bounded derived view with source and timestamp.

## UI/UX and evidence contract

What Lucy knows is explainable and user-editable. Explicit current instructions supersede uncertain learned preferences without secretly altering global mix defaults.

**Required negative cases:** No play-history table yet, conflicting preferences, privacy opt-out, token cap truncation, stale analysis, cross-home context, unsupported provider context length and deleted memories.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-310-01 — Separate invariant and dynamic instructions.** **Acceptance:** Trust boundaries and tool policy cannot be overridden by music metadata or memories. **Required verification:** Prompt construction and injection fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-310-02 — Build per-invocation snapshot.** **Acceptance:** Live mix, readiness, player state and scope refreshed at required moments. **Required verification:** Multi-turn external edit tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-310-03 — Define four memory layers.** **Acceptance:** Live facts, taste, conversation and proposal versions stored/retrieved separately. **Required verification:** Typed context schema and persistence tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-310-04 — Enforce provenance and confidence.** **Acceptance:** Every observed preference has underlying counts/sources and unknown stays unknown. **Required verification:** Sparse-history evidence fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-310-05 — Limit context size safely.** **Acceptance:** Deterministic prioritisation preserves hard constraints under token budgets. **Required verification:** Long-thread compaction evaluations. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-310-06 — Resolve preference conflicts.** **Acceptance:** Current hard exclusions and locked tracks outrank inferred habits; superseded soft rules removed. **Required verification:** Multi-turn contradiction tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-310-07 — Implement memory visibility.** **Acceptance:** Explain/edit/forget controls distinguish explicit, inferred and session-only data. **Required verification:** Privacy and user-comprehension study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-310-08 — Prevent cross-session leakage.** **Acceptance:** Prompt context scoped by conversation, data home and authorised selected mix. **Required verification:** Cross-home/session red-team tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
