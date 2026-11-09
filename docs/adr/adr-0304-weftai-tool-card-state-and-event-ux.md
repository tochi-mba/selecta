# ADR-0304 - In-chat WeftAI tool activity cards and truthful progress

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Tool UI. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0204, ADR-0205, ADR-0237, ADR-0270, ADR-0296, ADR-0297; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/ui/controls.tsx`; `web/src/styles/tokens.css`; `web/src/views/Mixes.tsx`.

## Context and evidence boundary

Users need to see independent WeftAI operations without being overwhelmed by a terminal transcript or a stack of modal dialogs. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Every visible operation has a stable mini card with queued/running/progress/completed/failed/skipped/cancelled/retrying states. Group plans by cycle; collapsed view shows milestones and warnings, expanded view shows exact operation evidence. Hook events, not model prose, own state.

## Interaction, provenance and data contract

Cards remain in chronological conversational context; each has title, compact mini visual, actual count/status, expandable details and context actions. Completed tools settle rather than animating indefinitely.

**Failure and negative scope:** Parallel completions, almost-instant tools, true zero matches, soft truncation, no progress available, retry identity, offscreen cards, reduced motion, tiny phones and screen reader announcement rate.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-304-01 - Define card lifecycle.** **Acceptance:** All 8 activity states and legal transitions have stable identifiers. **Required verification:** State-machine property tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-304-02 - Bind WeftAI hooks.** **Acceptance:** Queued/start/complete/fail events sourced from runtime and actual handlers. **Required verification:** Hook sequence and error-injection tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-304-03 - Support real progress only.** **Acceptance:** Counters/bars driven by measured events; unknown duration uses indeterminate cue. **Required verification:** False-percentage/partial-result negative tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-304-04 - Implement grouped disclosure.** **Acceptance:** Plan activity defaults to concise milestones with complete expandable step detail. **Required verification:** 20-step novice comprehension and expert audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-304-05 - Resolve parallel activity.** **Acceptance:** Out-of-order independent step completions update exactly the right card. **Required verification:** Concurrent fake-plan E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-304-06 - Handle retry and cancellation.** **Acceptance:** Attempt count, error, skipped dependency and recovery are traceable. **Required verification:** Retry/supersede/timeout fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-304-07 - Budget motion and layout.** **Acceptance:** No flash for trivial operations, no indefinite animation, bounded layout shift. **Required verification:** Reduced motion, perf trace, screenshot diffs. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-304-08 - Provide keyboard/AT parity.** **Acceptance:** Every card readable/expandable by keyboard and screen reader with batched announcements. **Required verification:** NVDA/VoiceOver and WCAG 2.2 manual checks. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
