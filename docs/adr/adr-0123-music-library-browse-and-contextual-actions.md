# ADR-0123 - Library: music-first browsing and contextual actions

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/5 new tasks).
- **Independent verification:** Not verified (0/5).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Collection.
- **Related ADRs:** ADR-0105, ADR-0106; does not silently supersede earlier decisions.
- **Source touchpoints:** `web/src/views/Library.tsx`, `web/src/views/SongDetails.tsx`, `web/src/router.ts`.

## Context and evidence boundary

Library implements search, URL filters, sorting, pagination, density choices and many per-song operations. Simultaneously displaying add, play-next, analyze and classification commands can dilute browsing hierarchy. No live browser visual, human study, or real-media acceptance is asserted by this ADR. Existing capabilities are baseline, not evidence of implementing newly proposed changes.

## Proposed decision

- Make title/artist and readiness the readable primary row information; use one most contextually relevant action and accessible secondary controls.
- Keep Start mix/Add/Play next/Analyse/Priority/Never play and all corrections available without hover-only interaction.
- Preserve query/filter/sort/paging in URLs, history and reloads, including deep partial results and stale data labels.
- Keep measured versus corrected BPM/key distinct in details and communicate source file safety.
- Test huge library responsiveness and screen-reader focus rather than selecting virtualization solely on DOM size.

## Considered alternatives and rationale

A dense tool-heavy row minimizes clicks for experts but reduces scanning; hiding everything in a menu slows common actions. Choose adaptive primary/contextual actions and validate.

## Consequences, scope and risks

Do not infer artist or song readiness from unavailable metadata; avoid loss of keyboard reachability or source mutability safeguards. Preserve current/draft/revision identities, routes, preferences, original files, one audio owner, consented atomic bridges, eight Studio lanes, blind comparison, real FLAC and local security. New APIs, cloud services, backend, DSP and schema changes require separate explicit decisions.

## New implementation tasks and evidence

1. **EX-0123-01 - Design song row information hierarchy**. Acceptance: Identity and availability readable with long/missing/duplicate tags. Required verification: Both-theme responsive visual review. **Implementation: Not started; Verified: No.**
2. **EX-0123-02 - Crosswalk all existing row actions**. Acceptance: Every operation accessible by mouse, touch and keyboard. Required verification: Control inventory and E2E. **Implementation: Not started; Verified: No.**
3. **EX-0123-03 - Preserve URL and deep paging**. Acceptance: Filtering and Back/Forward do not reset context. Required verification: 20k source fixture navigation. **Implementation: Not started; Verified: No.**
4. **EX-0123-04 - Polish song details and corrections**. Acceptance: Effective vs measured values and validation always clear. Required verification: Correction error, focus, Undo tests. **Implementation: Not started; Verified: No.**
5. **EX-0123-05 - Measure 20k responsiveness**. Acceptance: Fast enough scrolling and input without focus drops. Required verification: Hardware/frame time/DOM profile. **Implementation: Not started; Verified: No.**

## EX-0123-02 row action crosswalk (2026-11-10)

Every Library row operation in `web/src/views/Library.tsx`, and how it is reached without hover:

| Operation | Control | Mouse / touch | Keyboard | Proof |
|---|---|---|---|---|
| Open details and corrections | `Details for <song>` button | click / tap | Tab, Enter | `web/e2e/flows.e2e.ts` "the Library: search, song details, a correction that can be put back"; `web/e2e/lx-library.e2e.ts` LX-0348-05 |
| Start a mix here | primary row action when ready | click / tap | Tab, Enter | `web/src/views/Library.test.tsx` "starting a mix from a song" |
| Analyse / analyse all | row action when not analysed, bulk button | click / tap | Tab, Enter | `web/src/views/LibraryLx.test.tsx` LX-0346-05 |
| Add to mix, Play next | More menu items | menu open by click / tap | Enter, arrow keys | `LibraryLx.test.tsx` LX-0346-04; `lx-library.e2e.ts` LX-0346-06 |
| Prioritize, Never play | More menu checkbox items, with Undo | menu open by click / tap | Enter, arrow keys | `lx-library.e2e.ts` LX-0346-06 (keyboard and touch, both undo) |
| Select for batch, batch Prioritize / Never play | checkbox and selection rail | click / tap | Tab, Space | `LibraryLx.test.tsx` LX-0347-02/05/06/07 |

No operation is hover-only: each is a native button, checkbox or menu item in the tab order.

## Adversarial cases and research

Test partial/empty/failure/stale/recovering states, long/duplicate/Unicode/RTL metadata, both themes, keyboard, touch, 200/400% zoom, reduced motion and 320–2560px layouts. Concurrent mutation must never act on a different revision. Real-audio quality and continuity need actual listening. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [APG grid guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Microsoft human-AI principles](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are standards/pattern references, not user evidence. See [implementation checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [status reconciliation](selecta-experience-status-reconciliation.md).
