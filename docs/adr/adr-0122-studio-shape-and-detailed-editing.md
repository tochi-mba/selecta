# ADR-0122 - Stem Studio: approachable Shape controls and lossless Detailed mode

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (5/5 new tasks, 2026-11-10, uncommitted on `feat/finish-checklists`).
- **Independent verification:** Automated verification 3/5 (EX-0122-01, -03, -04 on 2026-11-10); EX-0122-02 and -05 need a person.
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Expert.
- **Related ADRs:** ADR-0102, ADR-0059; does not silently supersede earlier decisions.
- **Source touchpoints:** `web/src/views/Studio.tsx`, `web/src/studio.ts`, `web/src/styles/creation.css`.

## Context and evidence boundary

Studio supports a two-song, eight-lane, variable-length stem grid and list controls, but understanding the entire grid can be unnecessary for a first creative change. Shape controls are an unproven opportunity. No live browser visual, human study, or real-media acceptance is asserted by this ADR. Existing capabilities are baseline, not evidence of implementing newly proposed changes.

## Proposed decision

- Prototype an optional Shape mode with understandable controls for each musical part while keeping all eight underlying source/destination lanes.
- Retain Detailed grid and list controls, solo, presets, AI assistance, audio previews, restored unsaved work and guarded Apply.
- Switch between Shape and Detailed without loss of grid values; if an exact mapping cannot be proven, constrain Shape to safe reversible presets.
- Make unsaved, locally restored, rendering and applied states distinguishable, bound to the precise seam revision.
- Keep supported 8–64 cell arrangements, keyboard/AT editing and real audition as nonnegotiable.

## Considered alternatives and rationale

Replacing the grid with macros sacrifices expert precision. A grid-only surface keeps power but discourages exploration. Offer guided reversible controls alongside the full detailed interface.

## Consequences, scope and risks

Some intuitive macros may not map exactly to existing cell representations. Reject or constrain them rather than silently change meaning. Preserve current/draft/revision identities, routes, preferences, original files, one audio owner, consented atomic bridges, eight Studio lanes, blind comparison, real FLAC and local security. New APIs, cloud services, backend, DSP and schema changes require separate explicit decisions.

## New implementation tasks and evidence

1. **EX-0122-01 - Prove Shape-to-grid mapping**. Acceptance: Lossless reversible mapping or safe subset documented. Required verification: Grid round-trip tests. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: `web/src/views/ex0122StudioParity.test.tsx` (8/32/64 round trip).**
2. **EX-0122-02 - Prototype guided arrangement controls**. Acceptance: Beginners understand vocals/drums/bass/melody choices. Required verification: Uncoached creative task. **Implementation: Implemented; Verified: No. Needs a person: uncoached creative task with beginners.**
3. **EX-0122-03 - Preserve Detailed function set**. Acceptance: All lanes/cells/solo/presets/assist/recovery work. Required verification: 8/32/64-cell parity suite. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: `web/src/views/ex0122StudioParity.test.tsx`, `web/src/views/Studio.test.tsx`.**
4. **EX-0122-04 - Specify unsaved and revision behavior**. Acceptance: Mode switches never destroy work or apply to another seam. Required verification: Reopen, stale server and Undo tests. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: `web/src/views/ex0122StudioParity.test.tsx`, `web/src/views/Studio.test.tsx`, `web/src/views/StudioSafety.test.tsx`.**
5. **EX-0122-05 - Verify keyboard, AT and audible outcome**. Acceptance: Non-mouse editing and preview have correct music effect. Required verification: NVDA, touch and real audio tests. **Implementation: Implemented; Verified: No. Needs a person: NVDA, touch and real-audio checks (keyboard grid editing passes in `web/src/views/Studio.test.tsx`).**

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
