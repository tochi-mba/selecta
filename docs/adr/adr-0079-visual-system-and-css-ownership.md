# ADR-0079: Unify typography, themes, visual rhythm and CSS ownership

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 Implemented (automated), 0 In progress, 2 need a person only (2026-11-10 reconciliation; updated 2026-11-11); 0/10 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 1 - design foundations
- **Extends:** ADR-0050, ADR-0070, ADR-0077, ADR-0034. No inherited task is automatically complete.
- **Dependencies:** ADR-0078 baseline and owner visual-direction approval.
- **Checklist:** S31-0079-01 through S31-0079-10 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/styles/tokens.css`, `web/src/style.css`, `web/src/styles/{foundation,shell,polish,listening,creation,operations}.css`, `web/src/ui/Icon.tsx`, `web/src/ui/ControlGallery.tsx`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Keep warm-black, cream, electric lime, request blue and caution orange; standardize typography, semantics, surface depth, spacing, controls, compact density and responsive composition without recolouring each view independently. Resolve overlapping CSS ownership rather than piling on late overrides.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0079-01 - Approve visual hierarchy for page, song, metadata and technical values.** Acceptance: Screens use a documented typographic scale; long/RTL/missing song metadata remains readable. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/styles/typography.test.ts`; `web/src/views/Mix.test.tsx` ("keeps duplicate, RTL and CJK song names readable"); `web/e2e/finishing.e2e.ts` ("long, right-to-left and duplicate names stay readable and whole at the smallest size") passed. **Needs a person:** visual approval of the hierarchy in both themes.
2. **S31-0079-02 - Specify semantic colour role mapping for both themes.** Acceptance: Buttons, links, statuses, playback, requests, caution, focus and selections preserve contrast and meaning in light/dark. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/src/styles/tokens.css` semantic roles for both themes; `web/src/ui/controls.test.tsx` ("never rely on colour alone") passed. **Needs a person:** contrast and meaning review of every role in light and dark by a named reviewer.
3. **S31-0079-03 - Audit existing CSS cascade and overlapping selectors.** Acceptance: Ownership map names each rule's canonical file; proposals identify obsolete overrides without changing code in this PR. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `docs/adr/completion/css-ownership.md` names each sheet's owner, gives a verdict on every repeated selector (accidental `.count` overlap and the `var(--bg, #111)` literal identified and removed) and owns every breakpoint; `web/src/styles/css-ownership.test.ts` passed again on 2026-11-10 evening (the earlier `.card`/`.panel` drift is resolved). **Needs a person:** owner review for Verified of the ownership map.
4. **S31-0079-04 - Standardize spacing, gutters, radii, separators and depth.** Acceptance: Listen, browse, work, panel, dialog and toast examples use a reviewed common rhythm with justified exceptions. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `docs/engineering/spacing-token-map.md`; `web/src/styles/spacing-tokens.test.ts`, `surface-depth.test.ts`, `optical-alignment.test.ts` passed. **Needs a person:** reviewer approves the common rhythm and its justified exceptions.
5. **S31-0079-05 - Standardize SVG icon dimensions, stroke and accessible names.** Acceptance: All core actions have consistent icon alignment, discernible names and non-glyph fallback behaviour. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `docs/engineering/icon-inventory.md`; `web/src/styles/icon-geometry.test.ts`, `web/src/ui/destructiveIcons.test.ts` passed. **Needs a person:** owner review for Verified of icon alignment.
6. **S31-0079-06 - Review button, input, checkbox, tab, menu and status variants.** Acceptance: Control gallery covers default, hover, focus, pressed, busy, disabled, failure and destructive states. **Status (2026-11-11):** Implemented (automated), not Verified. **Evidence:** `web/src/ui/ControlGallery.tsx` (Workspace > Diagnostics in development or a `VITE_SELECTA_GALLERY=1` build) holds default, primary, pressed, busy, busy-and-disabled, disabled, invalid field, Problem with retry and destructive buttons and menu items, tabs, checkbox, menu and all eight statuses; `web/src/ui/polish-components.test.tsx` 'holds every shared control family the polish inventory names' (passed 2026-11-11); hover, focus, pressed and busy geometry in the browser: `web/e2e/mp-0279-component-gallery.e2e.ts` MP-0279-01 to -04 passed 2026-11-11 (recorded in the measured micro-polish checklist). **Needs a person:** a reviewed gallery of every control state in both themes.
7. **S31-0079-07 - Review light/dark/system theme and first-paint transitions.** Acceptance: No theme flash, incorrect title-bar colour, unreadable lime text, or unexpected audio reaction on switch. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("changing the theme while playing starts nothing again, and the title bar follows", "a manual theme and browser chrome agree before app JavaScript") passed. **Needs a person:** visual check of first paint and title bar on a real installed browser.
8. **S31-0079-08 - Audit visible numerical values and truncation.** Acceptance: BPM, keys, durations, counts, storage, waveforms and titles align and remain understandable. **Status (2026-11-11):** Implemented (automated), not Verified. **Evidence:** `web/src/lib.ts` `gb()` now reads small amounts in MB instead of "0.0 GB"; `web/src/s31-0079-08-numbers.test.ts` (durations never NaN or negative, storage keeps a readable unit, BPM and key named in words with a reason when missing, times, counts, metrics, library columns, facts, playhead and number fields use tabular figures, long and RTL titles wrap in their own direction), with `web/src/lib.test.ts` and `web/src/sfEdgeCases.test.ts` (passed 2026-11-11). **Needs a person:** visual review of BPM, key, duration, count and waveform alignment.
9. **S31-0079-09 - Review screen composition at every density and content width.** Acceptance: No arbitrary giant heading, excessive dead space, clipping or giant unstructured action clusters in representative screenshots. **Status (2026-11-10):** Not Verified. **Needs a person:** review representative screenshots at every density for dead space, clipping and action clusters.
10. **S31-0079-10 - Approve visual regression fixtures and change-review rules.** Acceptance: Reviewed baselines exist for representative pages and state changes; no blind snapshot acceptance. **Status (2026-11-10):** Not Verified. **Evidence:** Candidate capture exists (`web/e2e/visual.e2e.ts`, `selecta-3-1-visual-review.md`). **Needs a person:** owner approves baselines and the change-review rule.

## Required adverse cases and evidence

- A logo or large heading should not diminish song and playback readability.
- A snapshot alone cannot establish accessible contrast or perceived quality.
- Compact density cannot silently shrink essential touch targets.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

System-font and lightweight CSS maintain local-first performance; more elaborate fonts or assets demand a separate decision, distribution review and contrast/performance evidence.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Every S31 task remains **Not started**. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now includes limited frontend and component-test changes on selected workstreams. None of the tasks is Implemented or Verified; follow the evidence ledger for exact In-progress IDs.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Original documentation-only finishing plan |\n| 2026-11-07 | Proposed | In progress | Selected UI/test code now on PR #25; complete verification still outstanding |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 6 Implemented (automated), 2 In progress, 2 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/10 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
