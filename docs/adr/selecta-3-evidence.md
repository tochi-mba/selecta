# Selecta 3.0 - implementation status and evidence ledger

- **Programme decision:** Proposed. **Implementation:** PR #24 merged as `3b01dc1336aab0f1cb0a4d85be5eba359de81831`; task-level reconciliation and independent verification remain open.
- **Date:** 2026-11-07.
- **ADR count:** 31; **individual task count:** 258; **programme PR merged / independently Verified tasks:** yes / 0.
- **Scope:** Began as a documentation-only plan. PR #24 now also contains implementation changes; no complete manual audio, screen-reader or user-testing verification is claimed.
- **Baseline:** main `84b8b5cbadf7204bf526e8932124b5c4890e2c44`; PR #23 had merged.

## Individual ADR status table

The first 30 rows retain their *original proposal* states and have not been reconciled with all code changes in PR #24. They are not a live accounting of implemented work. Code is in progress, but Implemented requires merge plus CI evidence and Verified requires independent acceptance evidence.

| ADR | Decision | Implementation | Item progress | Actual evidence |
|---|---|---|---|---|
| [ADR-0047 - Selecta 3.0 charter, feature preservation and decision governance](adr-0047-overhaul-charter-and-governance.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0048 - Intent-based information architecture, routes and discoverability](adr-0048-intent-based-navigation-and-deep-links.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0049 - Responsive shell, persistent player and immersive Stage architecture](adr-0049-responsive-shell-player-and-stage.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0050 - Preserved palette with a rebuilt visual system, typography and density](adr-0050-brand-tokens-type-and-density.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0051 - Accessible primitives, overlays, feedback and durable undo](adr-0051-accessible-components-overlays-and-undo.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0052 - Truthful asynchronous state, optimistic mutations and recovery](adr-0052-truthful-async-and-state-contracts.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0053 - Guided onboarding, secure folder selection and time to first mix](adr-0053-first-run-sources-and-readiness.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0054 - Explore mixes, presets, creation defaults and energy journeys](adr-0054-explore-mix-discovery-and-steering.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0055 - Calm Listen experience, accurate waveform, lyrics and Stage](adr-0055-listen-lyrics-waveform-and-stage.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0056 - My Mixes workspace, safe drafts, restoration and render priority](adr-0056-my-mixes-drafts-and-render-line.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0057 - Safe timeline editor, insertion, reorder and stable identity](adr-0057-editor-song-seam-timeline.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0058 - Context-preserving seam inspector, exact cues and honest rendered outcome](adr-0058-transition-inspector-cues-and-previews.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0059 - Full Stem Studio workstation, grid interaction and commit safety](adr-0059-stem-studio-creative-grid.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0060 - Requests, bridge approval and atomic live insertion](adr-0060-request-scheduling-bridge-consent.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0061 - Word connections and four-stage harmonic discovery](adr-0061-discovery-word-and-harmonic-workflows.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0062 - Scalable Library search, filters, rows and pagination](adr-0062-scalable-library-browse-search-filters.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0063 - Library detail inspector, canonical readiness and protected corrections](adr-0063-library-track-details-corrections.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0064 - Workspace status, analysis, watched folders, storage and diagnostics](adr-0064-workspace-operations-sources-storage.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0065 - Persistent FLAC export jobs, exact revisions and download recovery](adr-0065-export-jobs-and-revision-identity.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0066 - Blind study interface and evaluation integrity](adr-0066-blind-listening-study-integrity.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0067 - WCAG 2.2 AA, responsive reflow and complete keyboard access](adr-0067-wcag-responsive-and-human-access.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0068 - Optional command palette, shortcut registry and expert navigation](adr-0068-keyboard-command-palette-and-power-flows.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0069 - Single audio ownership, transport continuity and preview lifecycle](adr-0069-single-audio-owner-and-playback-lifecycle.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0070 - System vocabulary, understandable explanations and restrained motion](adr-0070-content-explanations-feedback-and-motion.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0071 - Frontend domain boundaries, additive APIs and route compatibility](adr-0071-api-route-schema-compatibility.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0072 - Local-first privacy, file access, installed PWA and theme integration](adr-0072-local-privacy-pwa-security.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0073 - Rendering performance, 20k-track scale, 100-song edits and animation budgets](adr-0073-performance-profiling-and-visual-budget.md) | Accepted | Not started | 0/8 | None - plan only |
| [ADR-0074 - Full test architecture, invariants and concurrent edge-case matrix](adr-0074-testing-matrix-contract-and-races.md) | Accepted | Not started | 0/10 | None - plan only |
| [ADR-0075 - Visual regression, usability research and observable release acceptance](adr-0075-visual-research-evidence-and-release-gates.md) | Accepted | Not started | 0/9 | None - plan only |
| [ADR-0076 - Incremental migration, rollout controls, rollback and delivery order](adr-0076-incremental-migration-rollback-and-go-no-go.md) | Accepted | Not started | 0/9 | None - plan only |

| [ADR-0077 - Choosing light or dark](adr-0077-light-and-dark-theme-choice.md) | Accepted | In progress on PR #24 | 0/6 merged | Theme code present; CI and human verification outstanding |

## Required future item record

For `S3-XXXX-NN`, record the date, decision owner and status, implementation owner and status, implementing PR/commit/merge, linked historical T/P and parity row, exact acceptance, relevant unit/component/API/E2E test commands/results, reviewed fixture screenshots and browser/viewport/theme, keyboard/AT/zoom evidence, actual audio/FLAC evidence, user-task observations where necessary, race/failure cases, outstanding limitations and rollback disposition.

**Not started** means no implementing PR. **In progress** requires active code work. **Implemented** means code merged and relevant automated checks passed. **Verified** requires complete acceptance including independent manual/audio/AT evidence when appropriate. An approved or merged documentation proposal alone never advances implementation status.

Do not infer completion from historical ADRs, design mockups, assertions on mocked playback, a CI badge without task mapping, or a change to only component names. Update [the checklist](selecta-3-implementation-checklist.md), [roadmap](selecta-3-roadmap.md) and this ledger together.

## Evidence boundary

This proposal includes source-observed constraints, reasoned design choices and test plans. Actual browser captures, screen-reader use, performance measurements, user trials and real audio auditions remain unperformed within the new S3 programme.

## Current disposition

**31 Proposed decisions, 258 tracked items. PR #24 contains in-progress code, but not all work is reconciled, merged or verified. No item is claimed Verified.**
