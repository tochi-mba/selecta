# ADR-0311 — Multi-cycle agent controller, turn supersession and durable run lifecycle

- **Decision:** Proposed (owner review pending; docs-only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Agent. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0052, ADR-0095, ADR-0232, ADR-0236, ADR-0297; unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/api_common.py`; `web/src/App.tsx`.

## Context and evidence boundary

WeftAI validates and executes one declarative plan; it is not a complete chat/LLM-loop scheduler. Lucy needs multiple model/tool cycles per user turn with durable states and explicit approval boundaries. This new decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Implement outer agent loop with interpreting, running tools, evaluating, preparing, streaming, awaiting user/permission, interrupted, failed and completed states. Bound cycles, cost and time; support cancellation and new-turn supersession without forfeiting valid work.

## UI/UX and evidence contract

A user can ask an unrelated factual question without creating a new proposal, or revise an ongoing idea without prompting each internal tool. Continue planning is offered when the run budget ends.

**Required negative cases:** Duplicate send, two tabs, model loops, no tool calls, user changes intent mid-tool, ambiguous tool response, partial text, provider timeout and queued background jobs.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-311-01 — Define durable run model.** **Acceptance:** Conversation turn, run attempt and WeftAI plan have distinct stable IDs. **Required verification:** State machine and schema tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-311-02 — Implement multi-cycle progression.** **Acceptance:** Agent can independently use more than one plan before final answer. **Required verification:** Fake model plan→inspect→repair fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-311-03 — Bound autonomy and budgets.** **Acceptance:** Max cycles/steps/tokens/time and expensive jobs have fixed enforceable ceilings. **Required verification:** Infinite tool-call adversarial test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-311-04 — Support concurrent read and sequential writes.** **Acceptance:** Agent policy delegates plan concurrency to WeftAI while safeguarding outer commits. **Required verification:** Mixed-operation stress tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-311-05 — Handle superseding user feedback.** **Acceptance:** New instruction stops obsolete proposal result from publishing over a newer revision. **Required verification:** Delayed-tool multi-tab race test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-311-06 — Support stop, resume and retry.** **Acceptance:** Cancelled/interrupted/failed state recover without duplicate writes. **Required verification:** Kill/restart/fault injection. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-311-07 — Distinguish agent vs music job.** **Acceptance:** Finished Lucy response doesn't end independently running render/analysis. **Required verification:** Independent job-lifecycle E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-311-08 — Evaluate conversation clarity.** **Acceptance:** Answers, proposals, trade-offs and permission prompts appear at correct moments. **Required verification:** 20 scripted agent trajectories. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
