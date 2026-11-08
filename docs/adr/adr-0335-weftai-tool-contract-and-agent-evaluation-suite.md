# ADR-0335 — WeftAI tool contracts, agent trajectories, adversarial and deterministic testing

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Quality. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0112, ADR-0239, ADR-0240, ADR-0271, ADR-0299; unchanged.
- **Source touchpoints:** `tests/`; `web/src/views/Mixes.test.tsx`; `web/e2e/`; `src/selecta/planner/`.

## Context and evidence boundary

A fluent generated response is not proof Lucy called correct tools, respected multi-turn locks or created the exact approved musical artifact. A reproducible evaluation corpus is needed alongside normal code tests. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Test typed operation validation, plan dependencies, hook event order, read/write guardrails, agent intent extraction, six-turn critiques and exact proposal diffs with deterministic fake providers and synthetic music. Include prompt-injection, session isolation, exhausted limits and ready-only graph invariants.

## UI/UX and measurable acceptance contract

Failures are attributable to an exact run/plan/tool/proposal revision, and test snapshots verify truthful UI states rather than only model prose.

**Required negative cases:** Provider outputs malformed plan, fake permission from lyrics, cross-session $ref, expired result, 1-based ordinal, duplicate write, tool timeout, user supersedes and ready graph disconnected.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-335-01 — Build typed operation contract tests.** **Acceptance:** Schemas, caps, field errors, ref mismatch and permission flags verified. **Required verification:** WeftAI Python conformance. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-335-02 — Create conversation trajectory corpus.** **Acceptance:** Multi-turn revisions, locks and approval judged against structured state. **Required verification:** Golden 6+turn scenarios. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-335-03 — Test ready-only graph property.** **Acceptance:** Every K-song route uses K-1 playable directed edges with no queued renders. **Required verification:** Property-based music graph tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-335-04 — Simulate streaming failures.** **Acceptance:** Fake provider sends chunks, partial args, duplicates, gaps and cancellations. **Required verification:** Event decoder/browser E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-335-05 — Red-team tool outputs.** **Acceptance:** Malicious tags, lyrics, model instructions and URLs cannot induce writes or XSS. **Required verification:** Security adversarial suite. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-335-06 — Test exact commit recovery.** **Acceptance:** Restart/double approve and stale library never create divergent drafts. **Required verification:** Transactional fault injection. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-335-07 — Preserve music regressions.** **Acceptance:** Existing editor, player, Studio, requests, export and library suites remain green. **Required verification:** CI matrix including audio. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-335-08 — Track reproducible evaluation results.** **Acceptance:** Fixtures/seeds/provider versions/SHAs recorded per quality metric. **Required verification:** Independent eval sign-off. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Proposed and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
