# ADR-0121 - Transition Inspector: intent, rendered reality and audition

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/5 new tasks).
- **Independent verification:** Not verified (0/5).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P0 / Creator.
- **Related ADRs:** ADR-0101, ADR-0093; does not silently supersede earlier decisions.
- **Source touchpoints:** `web/src/views/SeamInspector.tsx`, `web/src/views/Now.tsx`, `web/src/audio/focus.ts`.

## Context and evidence boundary

Inspector exposes move types, cues, bars, checks and reasons. Its foremost creative value is answering whether the transition heard matches the request and can be improved; machine audio checks do not establish perceived quality. No live browser visual, human study, or real-media acceptance is asserted by this ADR. Existing capabilities are baseline, not evidence of implementing newly proposed changes.

## Proposed decision

- Order information by four user questions: what I asked for; what will actually play; can I hear it; what can I change.
- Make preparing, successful, fallback and actually heard versions visibly distinct and truthful.
- Defer detailed BPM/key, repair attempts and quality-check logs into clearly labeled optional explanations.
- Investigate before/after A/B auditions only if both exact revision-bound playable audio renders already exist; otherwise mark not feasible without new authorized work.
- Keep exact cues, phrase, bars, blend, rating and guarded re-render/Apply operations accessible.

## Considered alternatives and rationale

Technical-first details aid debugging but obscure musical action; a simplified inspector risks losing precision. Prefer a human-first summary and direct optional depth.

## Consequences, scope and risks

No new render-generation endpoint is authorized; audio previews must use one owner and ratings must bind to the exact heard seam identity. Preserve current/draft/revision identities, routes, preferences, original files, one audio owner, consented atomic bridges, eight Studio lanes, blind comparison, real FLAC and local security. New APIs, cloud services, backend, DSP and schema changes require separate explicit decisions.

## New implementation tasks and evidence

1. **EX-0121-01 - Design human-first status summary**. Acceptance: Requested vs actual rendered vs heard never conflated. Required verification: Real audio and loading-state comprehension. **Implementation: Not started; Verified: No.**
2. **EX-0121-02 - Map all detailed controls**. Acceptance: No seam choice or explanation silently removed. Required verification: Options/cues parity and keyboard audit. **Implementation: Not started; Verified: No.**
3. **EX-0121-03 - Specify failure and fallback behaviors**. Acceptance: Unrendered/failed transitions never appear as playable. Required verification: Fault-injection E2E. **Implementation: Not started; Verified: No.**
4. **EX-0121-04 - Feasibility-check previous/new audition**. Acceptance: Decision names matching render identity or explicitly declines feature. Required verification: Engine review and focus collision tests. **Implementation: Not started; Verified: No.**
5. **EX-0121-05 - Guard ratings and mutation scope**. Acceptance: Feedback and edit actions never attach to later seam. Required verification: Late response, reorder and preview races. **Implementation: Not started; Verified: No.**

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
