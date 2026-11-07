# Selecta 3.0 — full UI/UX overhaul ADR roadmap and decision index

- **Programme decision status:** Proposed.
- **Programme implementation status:** In progress on PR #24; no S3 work item is Verified.
- **Documentation status:** Originally a docs-only proposal; PR #24 now includes frontend, backend and test changes. The initial status tables are historical planning snapshots, not proof of completed implementation.
- **Date:** 2026-11-07.
- **Scope:** ADR-0047–0077, 31 decisions and 258 stable tasks (252 initial tasks plus 6 theme tasks); implementation mapping incomplete, **0 verified**.
- **Existing history:** ADR-0001–0032 and ADR-0033–0046 are preserved, not renumbered or silently superseded.
- **Planning source baseline:** main commit `84b8b5cbadf7204bf526e8932124b5c4890e2c44`, merged PR #23, at branch creation.

## Proposed experience direction

Keep the distinctive warm-black (`#100f0c`), cream (`#f4f0e4`), electric lime (`#e8ff3a`), request blue (`#6fd3ff`) and caution orange (`#ff7a4d`) identity. Rebuild virtually all navigation, page layout, typography, density, controls, feedback, advanced editing workspaces, responsive behavior and research/test governance.

Listening must be effortless and accurate; steering should be understandable; drafts/editing should be safe; Studio and diagnostics should preserve precise expert control. Redesign presentation without casually rewriting the underlying audio engine, planner, renderer or local data model.

The historical polish ADRs describe more modest finishing work. This programme proposes broader information architecture and creation-workspace changes. Previous summary text about PR #23's status can be stale: PR #23 was merged into main on 2026-11-06, but its completion evidence and manual verification must be inspected independently. The new S3 tasks **do not inherit completion** from the old P/T trackers.

## New ADR index — all Proposed / Not started

| Decision record | Decision | Implementation | Phase | Open tasks |
|---|---|---|---|---|
| [ADR-0047 — Selecta 3.0 charter, feature preservation and decision governance](adr-0047-overhaul-charter-and-governance.md) | Proposed | Not started | 0 Baseline | 8 |
| [ADR-0048 — Intent-based information architecture, routes and discoverability](adr-0048-intent-based-navigation-and-deep-links.md) | Proposed | Not started | 1 Architecture | 8 |
| [ADR-0049 — Responsive shell, persistent player and immersive Stage architecture](adr-0049-responsive-shell-player-and-stage.md) | Proposed | Not started | 1 Architecture | 8 |
| [ADR-0050 — Preserved palette with a rebuilt visual system, typography and density](adr-0050-brand-tokens-type-and-density.md) | Proposed | Not started | 2 Foundations | 8 |
| [ADR-0051 — Accessible primitives, overlays, feedback and durable undo](adr-0051-accessible-components-overlays-and-undo.md) | Proposed | Not started | 2 Foundations | 8 |
| [ADR-0052 — Truthful asynchronous state, optimistic mutations and recovery](adr-0052-truthful-async-and-state-contracts.md) | Proposed | Not started | 2 Foundations | 8 |
| [ADR-0053 — Guided onboarding, secure folder selection and time to first mix](adr-0053-first-run-sources-and-readiness.md) | Proposed | Not started | 3 Core journeys | 8 |
| [ADR-0054 — Explore mixes, presets, creation defaults and energy journeys](adr-0054-explore-mix-discovery-and-steering.md) | Proposed | Not started | 3 Core journeys | 9 |
| [ADR-0055 — Calm Listen experience, accurate waveform, lyrics and Stage](adr-0055-listen-lyrics-waveform-and-stage.md) | Proposed | Not started | 3 Core journeys | 9 |
| [ADR-0056 — My Mixes workspace, safe drafts, restoration and render priority](adr-0056-my-mixes-drafts-and-render-line.md) | Proposed | Not started | 3 Core journeys | 8 |
| [ADR-0057 — Safe timeline editor, insertion, reorder and stable identity](adr-0057-editor-song-seam-timeline.md) | Proposed | Not started | 4 Creation | 9 |
| [ADR-0058 — Context-preserving seam inspector, exact cues and honest rendered outcome](adr-0058-transition-inspector-cues-and-previews.md) | Proposed | Not started | 4 Creation | 9 |
| [ADR-0059 — Full Stem Studio workstation, grid interaction and commit safety](adr-0059-stem-studio-creative-grid.md) | Proposed | Not started | 4 Creation | 9 |
| [ADR-0060 — Requests, bridge approval and atomic live insertion](adr-0060-request-scheduling-bridge-consent.md) | Proposed | Not started | 3 Core journeys | 9 |
| [ADR-0061 — Word connections and four-stage harmonic discovery](adr-0061-discovery-word-and-harmonic-workflows.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0062 — Scalable Library search, filters, rows and pagination](adr-0062-scalable-library-browse-search-filters.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0063 — Library detail inspector, canonical readiness and protected corrections](adr-0063-library-track-details-corrections.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0064 — Workspace status, analysis, watched folders, storage and diagnostics](adr-0064-workspace-operations-sources-storage.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0065 — Persistent FLAC export jobs, exact revisions and download recovery](adr-0065-export-jobs-and-revision-identity.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0066 — Blind study interface and evaluation integrity](adr-0066-blind-listening-study-integrity.md) | Proposed | Not started | 5 Operations | 8 |
| [ADR-0067 — WCAG 2.2 AA, responsive reflow and complete keyboard access](adr-0067-wcag-responsive-and-human-access.md) | Proposed | Not started | 6 Quality | 9 |
| [ADR-0068 — Optional command palette, shortcut registry and expert navigation](adr-0068-keyboard-command-palette-and-power-flows.md) | Proposed | Not started | 6 Quality | 8 |
| [ADR-0069 — Single audio ownership, transport continuity and preview lifecycle](adr-0069-single-audio-owner-and-playback-lifecycle.md) | Proposed | Not started | 6 Quality | 9 |
| [ADR-0070 — System vocabulary, understandable explanations and restrained motion](adr-0070-content-explanations-feedback-and-motion.md) | Proposed | Not started | 2 Foundations | 8 |
| [ADR-0071 — Frontend domain boundaries, additive APIs and route compatibility](adr-0071-api-route-schema-compatibility.md) | Proposed | Not started | 1 Architecture | 8 |
| [ADR-0072 — Local-first privacy, file access, installed PWA and theme integration](adr-0072-local-privacy-pwa-security.md) | Proposed | Not started | 6 Quality | 8 |
| [ADR-0073 — Rendering performance, 20k-track scale, 100-song edits and animation budgets](adr-0073-performance-profiling-and-visual-budget.md) | Proposed | Not started | 6 Quality | 8 |
| [ADR-0074 — Full test architecture, invariants and concurrent edge-case matrix](adr-0074-testing-matrix-contract-and-races.md) | Proposed | Not started | 7 Verification | 10 |
| [ADR-0075 — Visual regression, usability research and observable release acceptance](adr-0075-visual-research-evidence-and-release-gates.md) | Proposed | Not started | 7 Verification | 9 |
| [ADR-0076 — Incremental migration, rollout controls, rollback and delivery order](adr-0076-incremental-migration-rollback-and-go-no-go.md) | Proposed | Not started | 7 Verification | 9 |

| [ADR-0077 — Choosing light or dark](adr-0077-light-and-dark-theme-choice.md) | Proposed | In progress on PR #24 | 2 Foundations | 6 |

## Status policy and evidence rule

- **Decision statuses:** Proposed → Accepted, Rejected or Superseded. Each change requires review owner, date and rationale.
- **Implementation statuses:** Not started → In progress → Implemented → Verified.
- **Not started:** No new implementation PR or evidence; the starting state of all 252 tasks.
- **In progress:** An implementing PR is underway and the task has a clear owner; a merged documentation PR is not enough.
- **Implemented:** Relevant code is merged with required automated testing and preservation evidence.
- **Verified:** Acceptance criteria are evidenced with necessary manual keyboard, screen-reader, actual audible and user-task checks, in addition to implementation.
- **Do not infer:** An accepted ADR, green linter, screenshots, mocked audio, or a past polish task do not independently verify a new S3 task.
- **Traceability:** Link each `S3-XXXX-NN` to [the checklist](selecta-3-implementation-checklist.md), [evidence ledger](selecta-3-evidence.md), old feature parity and exact implementing PR.

## Dependency gates and staged delivery

### Phase 0 — Baseline and governance

Pin the true implementation starting commit, capture real screenshots and state inventory, map all old T/P tasks, record listener/creator/expert tasks and establish severity. Exit with evidence and explicit decision approval; not with a promise of perfection.

### Phase 1 — Architecture and contracts

Approve the five-destination information architecture, old/new route compatibility, stable app shell/player ownership, typed state and additive APIs. Prototype responsive rail/dock before redesigning every page. If API additions are needed for durable export or native folder selection, approve separate backward-compatible contracts.

### Phase 2 — Foundations

Agree semantic colors/typography/density and accessible primitives, focus/menu/overlay behavior, truthful async models and vocabulary. Demonstrate a full component gallery, both themes and multiple widths.

### Phase 3 — Primary tasks

Onboarding → Explore → Listen → My Mixes → Requests, each as a focused PR with uninterrupted audio and data parity evidence. Do not delay screen-level keyboard and offline testing.

### Phase 4 — Creation workspaces

Redesign Editor, seam inspector and Stem Studio. All edits use stable resource/pair identity, guarded revisions and existing audio-focus rules. Verify 100-song and 64-cell operation.

### Phase 5 — Discovery and operations

Redesign Words/Harmonic discoveries, Library, track corrections, Workspace, export and studies with complete failure/recovery coverage. Preserve readiness and original study protocols.

### Phase 6 — Cross-cutting quality

Apply WCAG 2.2 AA, responsive reflow, command accessibility, single audio ownership, local privacy, PWA and performance constraints during all earlier phases; this phase provides integrated proof rather than deferred first implementation.

### Phase 7 — Integrated release verification

Review old/new feature parity, Python/frontend/E2E contracts, screenshots, real audio, listening/usability, screen readers, scale/security and rollback. Publish explicit go/no-go with accepted limitations. No automatic merge of unverified runtime work.

## Hard preservation contract (INV-01–INV-20)

1. **INV-01:** No source music or metadata may be deleted, rewritten, moved or exposed to unintended remote services.
2. **INV-02:** Current mix, saved drafts, ratings, playback preferences, correction overrides and render queues survive rollback.
3. **INV-03:** Every write is scoped to the correct current/draft resource and guarded against stale revisions.
4. **INV-04:** Existing URLs, URL search parameters, browser history, direct links and installed-app launch behavior keep working.
5. **INV-05:** Audio transport survives route, viewport, Stage and inspector changes with no unintended restart, overlap or silence.
6. **INV-06:** Main and preview audio have one owner; explicit user action takes precedence over automatic resume.
7. **INV-07:** All sixteen presets and mix duration, feel, stems, five-stop energy arc and destination controls remain.
8. **INV-08:** Edit retains insert, reorder, lock, remove, analysis, render, preview, audit, rating and scoped Undo.
9. **INV-09:** All 64 Stem Studio cells, stem solos, shapes, automatic arrange, fine tune, recovery and guarded Apply remain.
10. **INV-10:** Requests retain optimistic reconciliation, cancel, bridge consent, route alternatives, ghost rows and atomic insertion.
11. **INV-11:** Word/harmonic discovery, approvals, audio stages, ratings and atomic pair insertion remain.
12. **INV-12:** Library keeps all filters, sorting, search, pagination, corrections, analysis priority and exclusion.
13. **INV-13:** Workspace keeps watched folders, jobs, cache/storage protection, learning, listening studies and diagnostics.
14. **INV-14:** Planned/queued/rendering/fallback music must never be falsely labeled ready.
15. **INV-15:** FLAC must decode and correspond to exact intended mix/seam revision.
16. **INV-16:** Loopback Host/Origin/song-ID security and LRCLIB lyric-metadata privacy disclosure remain accurate.
17. **INV-17:** No essential flow becomes mouse-only, touch-inaccessible or unavailable to supported assistive technology.
18. **INV-18:** Old tests retain behavior-based assertions; visual selector changes do not justify weaker tests.
19. **INV-19:** Failures, races, duplicates, offline conditions and stale responses must not fabricate successful operations.
20. **INV-20:** Every new functionality or API dependency requires explicit acceptance and verification before launch.

## Common state inventory and input coverage

For every applicable route, overlay and subview: initial, populated, empty, partial, refreshing, saving, waiting, preparing, rendering, ready, warning, failed, unavailable, offline, reconnect and recovered. Document why a state is inapplicable rather than skipping it silently.

Review dark/light; widths 320, 375, 390, 430, 768, 1024, 1280, 1440, 1920 and 3840px; keyboard, touch, virtual keyboard, 200%/400% zoom, reduced motion, RTL/Unicode/very long/duplicate/missing metadata, PWA, two-tab focus and real audio. Actual accessibility and music quality require human verification.

## Critical release blockers

No release with lost/corrupt data; wrong mix/draft write; inaccessible essential task; unintended playback overlap, silence or resume; unauthorized or partial bridge route; invalid or wrong-revision FLAC; unsafe file access or undeclared external network calls; fabricated readiness; or material failure without a recovery path. Review every lower-severity visual problem and record its disposition.

## Supporting documents

- [Individual work-item checklist — 258 tasks](selecta-3-implementation-checklist.md)
- [Old-to-new feature parity ownership](selecta-3-parity-matrix.md)
- [Adversarial test and release verification matrix](selecta-3-verification-matrix.md)
- [Status and evidence ledger](selecta-3-evidence.md)
- [Research and sources](../research/selecta-3-overhaul.md)
- [Original feature parity](feature-parity.md), [test map](test-coverage-matrix.md), [prior polish roadmap](polish-roadmap.md)

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Original 30-ADR, 252-item documentation proposal |
| 2026-11-07 | Proposed | In progress | Code and ADR-0077 added to PR #24; automated checks and human verification outstanding |
