# ADR-0371 — Long-job progress, asynchronous truth and local recovery

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 4/8 Not started; 4/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 02 Foundation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0232, ADR-0252, ADR-0255, ADR-0297, ADR-0352, ADR-0358; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/state/async.ts`; `web/src/state/jobs.ts`; `web/src/ui/Skeleton.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Queued analysis, scanning and seam rendering need factual progress and safe recovery across routes.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-0371-01 — Define async state vocabulary.** **Acceptance:** Distinguish initial, stale, queued, running, paused, blocked, cancelled, failed and ready. **Required verification:** Cross-route state matrix. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `527b6c9741a635f758da22609849383c3072f16c`; **Evidence/reviewer:** `web/src/state/async.ts` and async unit tests; independent review pending.
2. **UF-0371-02 — Reserve skeletons for unknown content.** **Acceptance:** Known long work uses job status or uncertainty; no fake perpetual shimmer. **Required verification:** Delayed-load browser test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-0371-03 — Explain estimated time honestly.** **Acceptance:** Only locally grounded ranges with clear uncertainty appear. **Required verification:** Variable-workload fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **UF-0371-04 — Protect offline context.** **Acceptance:** Stale useful content is labelled and has reconnect/retry route. **Required verification:** Server restart test. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `527b6c9741a635f758da22609849383c3072f16c`; **Evidence/reviewer:** `web/src/state/async.ts` and async unit tests; independent review pending.
5. **UF-0371-05 — Reconcile lost mutation replies.** **Acceptance:** Preserve idempotency key for retries and report actual result. **Required verification:** Lost-ack duplicate guard test. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `f609504a4214a22edf6fa2be8210a2522f949776`; **Evidence/reviewer:** POST fingerprint and server replay guard with test_operation_identity.py; cross-route lost-ack verification pending; independent reviewer pending.
6. **UF-0371-06 — Handle cancellations correctly.** **Acceptance:** Cancelled, superseded and failed work cannot be shown as successful. **Required verification:** Cancel/revision-change test. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `527b6c9741a635f758da22609849383c3072f16c`; **Evidence/reviewer:** `web/src/state/async.ts` and async unit tests; independent review pending.
7. **UF-0371-07 — Keep live feedback calm.** **Acceptance:** Foreground errors take precedence over background completion noise. **Required verification:** Long-running observation. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **UF-0371-08 — Preserve layout and focus.** **Acceptance:** Changing asynchronous content does not jump controls or navigation unexpectedly. **Required verification:** Geometry/CLS/focus measurement. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
