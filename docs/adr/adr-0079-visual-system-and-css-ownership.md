# ADR-0079: Unify typography, themes, visual rhythm and CSS ownership

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress on PR #25 (selected sub-tasks only; none Verified)
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 1 — design foundations
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

1. **S31-0079-01 — Approve visual hierarchy for page, song, metadata and technical values.** Acceptance: Screens use a documented typographic scale; long/RTL/missing song metadata remains readable.
2. **S31-0079-02 — Specify semantic colour role mapping for both themes.** Acceptance: Buttons, links, statuses, playback, requests, caution, focus and selections preserve contrast and meaning in light/dark.
3. **S31-0079-03 — Audit existing CSS cascade and overlapping selectors.** Acceptance: Ownership map names each rule's canonical file; proposals identify obsolete overrides without changing code in this PR.
4. **S31-0079-04 — Standardize spacing, gutters, radii, separators and depth.** Acceptance: Listen, browse, work, panel, dialog and toast examples use a reviewed common rhythm with justified exceptions.
5. **S31-0079-05 — Standardize SVG icon dimensions, stroke and accessible names.** Acceptance: All core actions have consistent icon alignment, discernible names and non-glyph fallback behaviour.
6. **S31-0079-06 — Review button, input, checkbox, tab, menu and status variants.** Acceptance: Control gallery covers default, hover, focus, pressed, busy, disabled, failure and destructive states.
7. **S31-0079-07 — Review light/dark/system theme and first-paint transitions.** Acceptance: No theme flash, incorrect title-bar colour, unreadable lime text, or unexpected audio reaction on switch.
8. **S31-0079-08 — Audit visible numerical values and truncation.** Acceptance: BPM, keys, durations, counts, storage, waveforms and titles align and remain understandable.
9. **S31-0079-09 — Review screen composition at every density and content width.** Acceptance: No arbitrary giant heading, excessive dead space, clipping or giant unstructured action clusters in representative screenshots.
10. **S31-0079-10 — Approve visual regression fixtures and change-review rules.** Acceptance: Reviewed baselines exist for representative pages and state changes; no blind snapshot acceptance.

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

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
