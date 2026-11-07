# ADR-0119 — My Mixes: distinct current, draft and render scopes

- **Decision status:** Proposed, owner review pending.
- **Implementation status:** Not started (0/5 new tasks implemented).
- **Independent verification:** No (0/5).
- **Programme/date:** Experience-first UI/UX; 2026-11-07; baseline `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Priority / phase:** P0 / Creator.
- **Related:** ADR-0099, ADR-0095; no automatic supersession or inherited task completion.
- **Code touchpoints:** `web/src/views/Drafts.tsx`, `web/src/views/Mix.tsx`, `web/src/views/Mixes.tsx`.

## Context and evidence boundary

The active mix, saved drafts and render-priority line are all meaningful but not interchangeable: rendering a draft does not place it in live playback, and activating a draft can replace current music. Source inspection is not proof of a rendered UI problem, human task failure or real-audio quality. Existing functionality does not count as implementation of this newly proposed behavior.

## Proposed decision

- Present a clearly labeled active/current mix, a searchable set of drafts and a separately labeled background render line.
- Make exact scope/revision persist through edit, copy, delete, activate, prioritize and export.
- Differentiate Play now, Render sooner, Edit and Save and preserve safe replace/Undo behavior.
- Keep draft search, sort, duplicate, rename, delete, render prioritization and all existing recovery controls.
- Communicate stale, queued, storage-blocked and failed render state truthfully.

## Alternatives considered and rationale

A single queue may look neater but misrepresents meaning. Separate areas can take more space, so compress details without hiding actions.

## Consequences, risks and preservation

Never imply a queued render will automatically play. UI scope text is not a substitute for backend revision guards. Preserve original audio, routes, preferences, local security, current/draft/revision identity, scoped Undo, consented atomic bridges, full Stem Studio controls, blind study and decodable frozen-revision FLAC. No backend/audio/schema changes are implicitly approved.

## Implementation tasks (all Not started / Not verified)

1. **EX-0119-01 — Design current/draft/render hierarchy.** Acceptance: Users can identify what is live, saved and merely rendering. Verification: Comprehension exercises. **Implementation: Not started; Verified: No.**
2. **EX-0119-02 — Retain complete draft control set.** Acceptance: All existing creation/management actions reachable. Verification: Feature parity E2E. **Implementation: Not started; Verified: No.**
3. **EX-0119-03 — Preserve scope on risky actions.** Acceptance: Wrong mix cannot be activated, deleted or changed. Verification: Concurrent current/draft testing. **Implementation: Not started; Verified: No.**
4. **EX-0119-04 — Clarify render readiness and storage.** Acceptance: Partial/blocked/failed truth remains visible. Verification: Job failure and full-cache fixtures. **Implementation: Not started; Verified: No.**
5. **EX-0119-05 — Validate navigation and recovery.** Acceptance: Undo and draft context survive returning to My Mixes. Verification: History/refresh and action tests. **Implementation: Not started; Verified: No.**

## Required negative cases and references

Check empty/loading/partial/failed/stale/recovering states, long/RTL/duplicate names, dark/light/system themes, 320–2560px widths, 200/400% zoom, touch, keyboard, reduced motion and real audio where relevant. Preserve tests rather than weakening expectations. [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Microsoft human-AI guidance](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are pattern references, not evidence of Selecta outcomes. Status: [new checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
