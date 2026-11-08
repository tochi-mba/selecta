# ADR-0330 — AI model providers, capability negotiation, streaming and user cost controls

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Providers. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0238, ADR-0236, ADR-0128, ADR-0255; statuses and scope unchanged.
- **Source touchpoints:** `pyproject.toml`; `src/selecta/api.py`; `web/src/views/Workshop.tsx`.

## Context and source evidence boundary

WeftAI provider adapters describe wire formats but do not operate an LLM host. Local/remote models have different tool, structured argument, streaming and cost support. Lucy cannot pretend all providers support full agent mode. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Expose explicit opt-in setup for local/remote provider, secure server-only credentials, model capability negotiation and bounded per-run/per-conversation budgets. Full, constrained and unavailable modes preserve basic Selecta usability and private music data controls.

## UI/UX, interaction and truth contract

Main chat shows concise local/remote state, availability and actionable provider error; advanced model/cost configuration lives outside the creative flow.

**Negative cases:** Missing key, model 404, unsupported tool schema, provider timeout/rate limit, token window exceeded, cost cap reached, stream chunk mismatch, provider data retention unknown.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-330-01 — Define capability matrix.** **Acceptance:** Tool calls, streaming, JSON schema, context size and cancellation known per model. **Required verification:** Provider wire-shape contract tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-330-02 — Set up provider selection.** **Acceptance:** Explicit local/remote choice and consent prior to outbound prompts. **Required verification:** First-run and privacy task tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-330-03 — Protect API secrets.** **Acceptance:** Secrets server-side only; no frontend/event/trace leakage. **Required verification:** Secret canary/redaction tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-330-04 — Configure cost and usage budgets.** **Acceptance:** Enforce max tokens, turns, model cycles and optional spend ceilings. **Required verification:** Provider mock quota tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-330-05 — Gracefully degrade unsupported models.** **Acceptance:** Constrained read-only or clear unavailable state, never silent failure. **Required verification:** Non-tool and malformed model tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-330-06 — Handle failures and limits.** **Acceptance:** Timeout/rate limit/offline distinguish safely recoverable vs terminal. **Required verification:** Error states and retry-after fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-330-07 — Disclose outbound data.** **Acceptance:** Chat, relevant metadata, history and lyric sharing have clear provider policy. **Required verification:** Payload diff and consent screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-330-08 — Keep Selecta functional offline.** **Acceptance:** Provider outage cannot break Mixes, Editor, Library or active player. **Required verification:** No-key/offline full-product regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Accepted; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
