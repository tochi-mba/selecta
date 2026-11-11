# ADR-0124 - Requests: truthful lifecycle and explicit bridge consent

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented 5/5 new tasks (2026-11-10, uncommitted on `feat/finish-checklists`).
- **Independent verification:** Automated verification 3/5 on 2026-11-10; open items name a person or a pending run in the checklist.
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Collection.
- **Related ADRs:** ADR-0103, ADR-0060; does not silently supersede earlier decisions.
- **Source touchpoints:** `web/src/views/Requests.tsx`, `src/selecta/request_planner.py`, `web/src/views/Now.tsx`.

## Context and evidence boundary

Requests have real search, planning, waiting, rendering and bridge insertion states. A request might not fit a current mix; a route through extra songs is a meaningful decision, not automatic queueing. No live browser visual, human study, or real-media acceptance is asserted by this ADR. Existing capabilities are baseline, not evidence of implementing newly proposed changes.

## Proposed decision

- Give the user a human-readable state for searching, waiting, preparing, joining, failed and actually playing, mapped precisely from backend facts.
- Distinguish direct-fit, no-fit, forced insertion and multi-song bridge options without inventing availability or ETA.
- Show each extra bridge song and consequence before explicit informed consent.
- Retain atomic idempotent insertion, stable requests, cancellation, concurrent planning and no duplicates.
- Keep request previews governed by single audio focus and avoid surprise playback transitions.

## Considered alternatives and rationale

Pretending every request joins a conventional social queue is simpler but dishonest; exposing all engine stages is accurate but confusing. Present verified, understandable stages.

## Consequences, scope and risks

A stale or duplicate confirmation can affect the mix; preserve server guards and never auto-approve extra-song routes. Preserve current/draft/revision identities, routes, preferences, original files, one audio owner, consented atomic bridges, eight Studio lanes, blind comparison, real FLAC and local security. New APIs, cloud services, backend, DSP and schema changes require separate explicit decisions.

## New implementation tasks and evidence

1. **EX-0124-01 - Define canonical user-facing lifecycle**. Acceptance: Every actual stage has truthful display and recovery. Required verification: Backend state map and error fixtures. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
2. **EX-0124-02 - Redesign pending requests panel**. Acceptance: User sees what is likely versus merely asked. Required verification: Listener comprehension test. **Implementation: Implemented; Verified: No. Needs a person: listener comprehension test of likely versus merely asked. Evidence: see checklist.**
3. **EX-0124-03 - Specify bridge consent presentation**. Acceptance: Each extra song and route explicitly approved or declined. Required verification: Consent/decline/reopen scenarios. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
4. **EX-0124-04 - Verify atomic/duplicate safeguards**. Acceptance: No partial or duplicated bridge under races. Required verification: Concurrent API and browser E2E. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
5. **EX-0124-05 - Test audible handover and preview focus**. Acceptance: No unexpected overlap or transport interruption. Required verification: Real music request-join test. **Implementation: Implemented; Verified: No. Needs a person: real-music request-join listening test for overlap or transport interruption. Evidence: see checklist.**

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
