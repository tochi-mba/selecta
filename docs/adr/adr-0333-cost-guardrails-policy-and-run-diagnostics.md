# ADR-0333 — Operation budgets, user-visible costs, safe agent diagnostics and explainability

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P1 / Operations. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0128, ADR-0237, ADR-0238, ADR-0293, ADR-0299; unchanged.
- **Source touchpoints:** `src/selecta/routes/system.py`; `src/selecta/api.py`; `web/src/views/Workshop.tsx`.

## Context and evidence boundary

A fully agentic loop may call many tools or consume provider quota. The user needs a useful result or clear limit without exposing raw secrets and personal traces in the main interface. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Enforce turn/conversation limits for model requests, tool counts, durations and expensive compute; provide bounded continuation paths and provider-specific cost estimates where reliably obtainable. Persist privacy-safe traces with appropriate retention and scoped diagnostic visibility.

## UI/UX and measurable acceptance contract

Ordinary conversation stays uncluttered. A usage/details disclosure explains time, completed operations, exhausted budgets and safe Continue planning, without manipulating the user to chat more.

**Required negative cases:** Unbounded retries, provider reports missing token usage, interrupted billable call, malicious huge tool result, diagnostics showing filenames, massive event log, unavailable model prices.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-333-01 — Set enforceable run ceilings.** **Acceptance:** Max model cycles, WeftAI steps, tool time, candidate counts, compute and tokens. **Required verification:** Infinite-loop and large-result stress. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-333-02 — Report exhausted limits.** **Acceptance:** Preserve completed results and offer bounded Continue rather than infinite work. **Required verification:** Budget exhaustion conversation test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-333-03 — Audit cost estimates.** **Acceptance:** Real provider usage separated from estimates; unavailable pricing marked unknown. **Required verification:** Provider usage/cost fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-333-04 — Keep safe operation traces.** **Acceptance:** Tool/plan/status/retry linkage available without raw audio or sensitive keys. **Required verification:** Trace redaction tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-333-05 — Define retention and pruning.** **Acceptance:** Large event and trace histories prune without breaking current replay/history. **Required verification:** Large log+replay migration test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-333-06 — Explain decisions with evidence.** **Acceptance:** Assistant can cite real constraints, scores and sources without fake chain-of-thought. **Required verification:** Grounded explanation eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-333-07 — Prevent stealth expensive analysis.** **Acceptance:** Expensive compute actions require explicit policy/consent and worker priority. **Required verification:** Resource consent and scheduler test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-333-08 — Validate user trust and clarity.** **Acceptance:** Users distinguish costs, unknowns and failures while continuing mix creation. **Required verification:** Uncoached reliability study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Proposed and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
