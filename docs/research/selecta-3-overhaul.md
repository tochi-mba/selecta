# Selecta 3.0 — source inspection, design references and research boundaries

- **Decision status:** Proposed.
- **Implementation status:** Not started.
- **Date:** 2026-11-07.
- **Evidence boundary:** This proposal uses source inspection and public standards, not original conducted usability studies, actual screenshots or audio auditions. Do not report hypotheses as observed outcomes.

## Verified repository starting points

- `web/src/router.ts`: existing routes, Back/Forward, query state and scroll behavior require explicit alias compatibility.
- `web/src/styles/tokens.css`: warm-black `#100f0c`, cream `#f4f0e4`, electric-lime `#e8ff3a`, request-blue `#6fd3ff`, warning-orange `#ff7a4d`, and light-theme variants. Preserve recognizable brand identity.
- `web/src/styles/shell.css`: a mobile `.mini` offset rule is followed by a general same-specificity `.mini { bottom: 0; }` declaration. It is a code-level layout risk requiring an actual browser overlap test; not an assertion a user-visible failure was independently reproduced.
- `web/src/audio/focus.ts`: one main/preview audio owner, conditional pause/resume and explicit main-player user intent semantics; replacing presentation may not violate this contract.
- `web/src/views/*`: actual screen inventory and source behavior, including current/draft editor, Stem Studio, requests, Library, Discover and Workshop.
- `web/e2e/pages.e2e.ts`, `web/e2e/listen.e2e.ts`, `web/e2e/flows.e2e.ts`, `web/e2e/integration.e2e.ts`: existing automated-browser reference points, not proof the future redesign passed.
- `tests/test_api_contracts.py`, `tests/test_library_edges.py`, `tests/test_file_length.py`: server/scale/code-hygiene reference points.
- [Historical feature parity](../adr/feature-parity.md), [test matrix](../adr/test-coverage-matrix.md), [polish roadmap](../adr/polish-roadmap.md): keep as historical context, not as automatically complete new S3 work.
- Main commit `84b8b5cbadf7204bf526e8932124b5c4890e2c44` merged PR #23 on 2026-11-06; older documentation status banners remain historical and may be stale.

## Design and engineering references

1. [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): prefer immediate common tasks and discoverable advanced control.
2. [Microsoft Research — Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/): disclose limitations, support human correction and explain automation decisions.
3. [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/): focus not obscured, pointer target size minimum and alternatives to drag-only gestures.
4. [W3C — Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): 24×24 CSS px with defined spacing/other exceptions, rather than pretending every button must be 44px.
5. [WAI-ARIA APG — Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus and background interaction semantics.
6. [WAI-ARIA APG — Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/): Studio's roving focus/arrow and nested input choices.
7. [WAI-ARIA APG — Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): inspector selection and arrow behavior.
8. [WAI-ARIA APG — Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): destination search and optional command palette.
9. [MDN — showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker): limited browser support; returned browser handle is not a guaranteed server-readable absolute local path.
10. [Playwright — Visual Snapshots](https://playwright.dev/docs/test-snapshots): deterministic state screenshots and diff review.
11. [Playwright — Clock](https://playwright.dev/docs/clock): freeze/advance clocks to test timed UI behavior.
12. [Google — Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals): interaction responsiveness and visual stability reference guidance.

These sources guide pattern choices; they do not establish actual Selecta performance, accessibility, subjective transition quality or participant success.

## Research and product validation plan

**New listener:** Can an unassisted person add a folder, understand LRCLIB metadata disclosure, distinguish scan from mix readiness and play a valid first mix?

**Daily listener:** Can someone find a mix, know what is playing and coming next, steer the plan, request a song, understand bridge approval and distinguish Next from Jump to transition?

**Creator:** Can a user create a draft, reorder tracks, set cues, undo a change, recover a failed save and export exactly the intended project?

**Expert editor:** Can an experienced user understand requested versus actual fallback, use the complete 64-cell Studio with keyboard and recognize whether the work is locally saved, applied or rendered?

**Accessibility:** Can keyboard, touch and supported AT users complete every essential task across zoom levels, Stage and mobile sheets?

**Performance:** On documented hardware, can Library 20k, Editor 100 songs and Studio 64 cells remain responsive during rendering without damaging audio timing?

**Listening quality:** Do real rendered transitions satisfy blinded human auditory judgments across relevant musical fixtures? Automated scores alone do not answer.

Use real tasks, real observations and sanitized data. Record negative results rather than hiding them. The proposed navigation labels, default Library filter, palette command and export persistence are hypotheses pending review, not shipped contracts.

## Security and platform caveats

Local first means no remote analytics/asset dependency by default. The current lyric lookup can send artist/title/album/duration to LRCLIB while original audio stays local; reflect actual behavior and consent context. A browser File System Access picker is not an approved IPC/native picker and should not be assumed to solve server path validation. PWA installation does not imply playback works without the local server.

## Proposal-only status

No new UI, code, API, benchmark, screen-reader test, usability session or audio test was produced by these design notes. All implementation statuses stay **Not started**.
