# ADR-0121 - Transition Inspector: intent, rendered reality and audition

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (5/5 new tasks, 2026-11-10, uncommitted on `feat/finish-checklists`).
- **Independent verification:** Automated verification 3/5 (EX-0121-02, -04, -05 on 2026-11-10); EX-0121-01 needs a person, EX-0121-03 needs its browser fault-injection E2E.
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

1. **EX-0121-01 - Design human-first status summary**. Acceptance: Requested vs actual rendered vs heard never conflated. Required verification: Real audio and loading-state comprehension. **Implementation: Implemented; Verified: No. Needs a person: real-audio and loading-state comprehension. Evidence: `web/src/views/ex0121SeamInspector.test.tsx`.**
2. **EX-0121-02 - Map all detailed controls**. Acceptance: No seam choice or explanation silently removed. Required verification: Options/cues parity and keyboard audit. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: `web/src/views/ex0121SeamInspector.test.tsx`, `web/src/views/ufSeamInspector.test.tsx`.**
3. **EX-0121-03 - Specify failure and fallback behaviors**. Acceptance: Unrendered/failed transitions never appear as playable. Required verification: Fault-injection E2E. **Implementation: Implemented; Verified: No (component fault injection passes in `web/src/views/ex0121SeamInspector.test.tsx`; browser E2E pending).**
4. **EX-0121-04 - Feasibility-check previous/new audition**. Acceptance: Decision names matching render identity or explicitly declines feature. Required verification: Engine review and focus collision tests. **Implementation: Implemented (decision below); Verified: Yes (automated, 2026-11-10). Evidence: `web/src/audio/focus.test.tsx`, `web/src/views/ex0121SeamInspector.test.tsx`.**
5. **EX-0121-05 - Guard ratings and mutation scope**. Acceptance: Feedback and edit actions never attach to later seam. Required verification: Late response, reorder and preview races. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: `web/src/views/ex0121SeamInspector.test.tsx`, `web/src/views/Mix.test.tsx`.**

## EX-0121-04 audition feasibility decision (2026-11-10)

Before/after A/B audition is **declined**. A seam render is addressed only by its current `state.key`; the mix carries no previous render key, and `GET /api/seams/{key}/preview` (`src/selecta/routes/edit.py`) serves exactly one key. Offering "previous" audio would mean keeping and exposing an older key, which is a new API and storage decision this ADR does not authorize. The single audition that exists is bound to the exact rendered identity: `AudioPreview` is keyed by `state.key` and its source is `/api/seams/<key>/preview`, so a clip from before a change cannot be mistaken for the current one, and it takes the one audio owner in `web/src/audio/focus.ts`.

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
