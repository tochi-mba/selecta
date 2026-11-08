# ADR-0303 — Streaming responses, durable event log and reconnectable SSE

- **Decision:** Proposed (owner review pending; no implementation authorised by this document).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Streaming. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0052, ADR-0095, ADR-0232, ADR-0236, ADR-0270, ADR-0297; their decisions and statuses remain unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `web/src/api.ts`; `web/src/App.tsx`.

## Context and evidence boundary

Lucy needs real streamed text plus independent tool and render status. A chunked HTTP response without persisted events cannot recover state after disconnect or a phone suspending the page. This is a proposed **new Lucy feature contract**, not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Create POST-turn and GET-SSE event stream with ordered IDs, durable replay cursor, schema version, run/plan/step identity and canonical run snapshots. Stream actual provider deltas, WeftAI events and Selecta job facts independently. Never simulate streaming by revealing a completed answer one character at a time.

## Interaction, provenance and data contract

Auto-scroll only when at bottom; show New messages otherwise. Partial responses, reconnecting state, cancelled status and completed tool cards are visually distinct.

**Failure and negative scope:** Lost/repeated/out-of-order events, browser sleep, abort mid-function-arguments, server restart, event schema change, long-running render after turn completion and stale proposal events.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-303-01 — Specify event schema.** **Acceptance:** Turn/run/plan/step/event/proposal/revision IDs and ordered schema versions exist. **Required verification:** Codec/schema and fixture tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-303-02 — Stream real model deltas.** **Acceptance:** Visible response is incrementally delivered from provider, not fake typing. **Required verification:** Fake-provider timing and UI stream test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-303-03 — Implement durable event replay.** **Acceptance:** Reconnect resumes after event cursor without duplicate effects or cards. **Required verification:** Disconnect/replay/idempotence E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-303-04 — Separate tool and job events.** **Acceptance:** Tool lifecycle and actual background render state update independent of response text. **Required verification:** Concurrent timing and job-change fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-303-05 — Bound output rendering.** **Acceptance:** Text deltas batch UI work without losing content, order or accessibility. **Required verification:** Performance traces and transcript assertions. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-303-06 — Handle stop/supersede.** **Acceptance:** Cancellation affects correct run and never pauses playback or undoes writes. **Required verification:** Race, Stop and cross-conversation tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-303-07 — Build canonical snapshot recovery.** **Acceptance:** Gaps, expired streams and version changes recover from authoritative snapshot. **Required verification:** Fault injection on event gaps and restarts. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-303-08 — Protect stream trust.** **Acceptance:** Partial tool JSON stays unexecuted until complete validation; never raw HTML. **Required verification:** Malformed arguments/XSS and provider contract tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Proposed** until dated owner accept/reject/supersede. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
