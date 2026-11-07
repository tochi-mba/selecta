# ADR-0120 — Arrangement editor: distinct song and transition objects

- **Decision status:** Proposed (owner approval pending).
- **Implementation status:** Not started (0/5 new tasks).
- **Independent verification:** Not verified (0/5).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P0 / Creator.
- **Related ADRs:** ADR-0100, ADR-0057; does not silently supersede earlier decisions.
- **Source touchpoints:** `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx`, `web/src/views/SeamInspector.tsx`.

## Context and evidence boundary

The current editor offers song and seam operations in interconnected rows. It already contains stable identity and focus safeguards, which must survive a more tactile, readable music-arrangement design. No live browser visual, human study, or real-media acceptance is asserted by this ADR. Existing capabilities are baseline, not evidence of implementing newly proposed changes.

## Proposed decision

- Make each song row and the connector representing the transition into the following song distinctly selectable, with clear status and safe action grouping.
- Use a persistent side inspector on wide screens and a focused accessible sheet on smaller screens.
- Separate whole-mix commands from song-specific and transition-specific actions; retain add/reorder/remove/lock/hear/Undo/export.
- Bind selection to stable song/seam identity and expected current/draft revision through asynchronous mutation, never array position alone.
- Use real audio waveform data only if available; otherwise use schematic diagrams with explicit non-waveform labeling.

## Considered alternatives and rationale

A DAW-like full multitrack timeline is visually attractive but disproportionately complex for an auto-DJ. List-only editing is safe but less expressive. Choose song/seam arrangement objects with focused detail.

## Consequences, scope and risks

Touch dragging must have a non-dragging control; 100-song mixes and late live requests must not cause focus or scope loss. Preserve current/draft/revision identities, routes, preferences, original files, one audio owner, consented atomic bridges, eight Studio lanes, blind comparison, real FLAC and local security. New APIs, cloud services, backend, DSP and schema changes require separate explicit decisions.

## New implementation tasks and evidence

1. **EX-0120-01 — Prototype distinct song/seam selection**. Acceptance: Users can identify what is being changed without coaching. Required verification: Creator task tests on 2/20/100 songs. **Implementation: Not started; Verified: No.**
2. **EX-0120-02 — Specify responsive inspector behavior**. Acceptance: One selection model and stable focus across wide/narrow. Required verification: Keyboard, sheet and zoom testing. **Implementation: Not started; Verified: No.**
3. **EX-0120-03 — Maintain all existing editor commands**. Acceptance: Reorder, add, lock, remove, preview, Undo, clear, export preserved. Required verification: E2E feature parity. **Implementation: Not started; Verified: No.**
4. **EX-0120-04 — Guard identity and concurrency**. Acceptance: Late inserts/removes never mutate a different seam or draft. Required verification: Simultaneous request/reorder tests. **Implementation: Not started; Verified: No.**
5. **EX-0120-05 — Verify scale and non-drag alternatives**. Acceptance: Editing remains accessible and responsive for 100 songs. Required verification: WCAG 2.5.7, touch and measured latency. **Implementation: Not started; Verified: No.**

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
