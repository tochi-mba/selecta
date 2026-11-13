# Selecta 4.0 - complete experience overhaul ADR roadmap and index

- **Proposed:** 2026-11-07.
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (PR #25 and PR #26 already merged at review).
- **Status (2026-11-12, recounted from the [checklist](selecta-4-implementation-checklist.md) task lines):** 25 decisions **Accepted**; 250 tasks: **202 Implemented, 36 In progress, 12 Not started; 0 Verified**. (Created 2026-11-07 with 25 Proposed decisions and 250 Not started tasks.)
- **Change scope:** Documentation only; no frontend, backend, audio, database, test or CI changes.
- **History:** ADR-0001–0088, T/P/S3/S31 identities and their historical evidence remain unchanged.


## Why a new programme

The repository already holds 3.0 and 3.1 full-experience and polish ADRs. This 4.0 series is an **additive, separately proposed** comprehensive overhaul, not permission to undo working features or retroactively claim prior work unimplemented. Some 3.1 files still describe PR #25 as pending; #25 was in fact merged, followed by #26 on main. Earlier release-readiness NO-GO reports refer to their historical candidate and remain historical evidence. Inspect the actual merge and new baseline before beginning work.

## North star and non-negotiables

**Simple is effortless; advanced is discoverable; risky is predictable.** Preserve Selecta's warm charcoal (`#100f0c`), cream (`#f4f0e4`), electric lime (`#e8ff3a`), request blue and warning orange. Redesign both dark and light themes independently. Make Listen immersive, Explore inspiring, editor precise, requests truthful, and Workshop/Workspace operational but quiet.

Retain all existing routes, preference choices, source files, drafts, corrections, current/draft scope, canonical readiness, rendering, stem tools, request bridge consent, study protocol and revision-bound FLAC. Do not rewrite backend/audio engine/schema or add remote asset tracking as an accidental UI change.

## ADR decision index

| ADR | Workstream | Phase | Decision | Implementation | Open tasks |
|---|---|---|---|---|---:|
| [ADR-0089](adr-0089-charter-baseline-parity-and-governance.md) | Selecta 4.0 charter, baseline and full feature-preservation governance | 0 Baseline | Accepted | 1 Implemented, 6 In progress, 3 Not started | 10 |
| [ADR-0090](adr-0090-palette-theme-semantics-and-contrast.md) | Preserve lime/cream/charcoal identity with an independently polished dark and light theme | 1 Foundations | Accepted | 4 Implemented, 5 In progress, 1 Not started | 10 |
| [ADR-0091](adr-0091-type-spacing-density-and-css-ownership.md) | Typography, spacing, density, icons, visual hierarchy and CSS ownership | 1 Foundations | Accepted | 6 Implemented, 4 In progress, 0 Not started | 10 |
| [ADR-0092](adr-0092-navigation-shell-viewport-and-deep-links.md) | Responsive navigation shell, optional inspector, global header and route integrity | 2 Shell | Accepted | 9 Implemented, 1 In progress, 0 Not started | 10 |
| [ADR-0093](adr-0093-persistent-player-audio-focus-and-stage-lifecycle.md) | Persistent playback presentation, previews, audio focus and immersive Stage lifecycle | 2 Shell / 4 Listen | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0094](adr-0094-accessible-components-overlays-and-feedback.md) | Shared accessible controls, menus, sheets, dialogs and activity presentation | 1 Foundations / 2 Shell | Accepted | 8 Implemented, 2 In progress, 0 Not started | 10 |
| [ADR-0095](adr-0095-async-consistency-undo-offline-and-multitab.md) | Truthful asynchronous state, revision guards, Undo, recovery and multi-tab consistency | 1 Foundations / cross-cutting | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0096](adr-0096-onboarding-sources-and-time-to-first-play.md) | First-run folder import, analysis readiness and time to first valid play | 3 Listener | Accepted | 9 Implemented, 0 In progress, 1 Not started | 10 |
| [ADR-0097](adr-0097-explore-presets-steering-and-mix-activation.md) | Explore discovery, energy and cue customization, and safe current-mix activation | 3 Listener | Accepted | 9 Implemented, 0 In progress, 1 Not started | 10 |
| [ADR-0098](adr-0098-listen-waveform-lyrics-visualizer-and-stage.md) | Listening-first Now view, accurate waveform, lyrics, spectrum and Stage | 4 Listen | Accepted | 8 Implemented, 2 In progress, 0 Not started | 10 |
| [ADR-0099](adr-0099-my-mixes-drafts-render-line-and-scoped-activation.md) | My Mixes current-vs-draft clarity, safe activation and render queue | 5 Creator | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0100](adr-0100-editor-timeline-song-seam-and-identity.md) | Timeline editor, precise insertion/reorder, persistent scope and problem navigation | 5 Creator | Accepted | 9 Implemented, 1 In progress, 0 Not started | 10 |
| [ADR-0101](adr-0101-transition-inspector-requested-versus-rendered.md) | Transition Inspector: requested intent, rendered reality, exact cues and safe previews | 5 Creator | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0102](adr-0102-stem-studio-arrangement-grid-and-recovery.md) | Stem Studio eight-lane arrangement, accessible time grid and recovery-safe Apply | 6 Expert | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0103](adr-0103-request-states-bridge-consent-and-atomic-join.md) | Requests drawer, bridge alternatives, explicit consent and atomic joining | 7 Discovery | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0104](adr-0104-word-connections-harmonic-discovery-and-feedback.md) | Lyric-word connections, harmonic four-stage auditions and version-bound feedback | 7 Discovery | Accepted | 9 Implemented, 1 In progress, 0 Not started | 10 |
| [ADR-0105](adr-0105-library-browse-search-filters-and-scale.md) | Large-Library browse, URL-backed search, readiness filters and 20k-song responsiveness | 8 Library | Accepted | 9 Implemented, 0 In progress, 1 Not started | 10 |
| [ADR-0106](adr-0106-song-details-corrections-and-local-sources.md) | Song Details, measured-versus-corrected metadata, classification and safe source management | 8 Library | Accepted | 10 Implemented, 0 In progress, 0 Not started | 10 |
| [ADR-0107](adr-0107-workspace-analysis-sources-storage-and-diagnostics.md) | Workspace operations, background analysis, watched sources, storage and diagnostics | 9 Operations | Accepted | 8 Implemented, 2 In progress, 0 Not started | 10 |
| [ADR-0108](adr-0108-flac-export-jobs-and-frozen-revisions.md) | Export audio, revision-pinned FLAC jobs, durable progress and verified downloads | 9 Operations | Accepted | 9 Implemented, 1 In progress, 0 Not started | 10 |
| [ADR-0109](adr-0109-blind-listening-study-and-learning-integrity.md) | Blind A/B listening study, harmonic feedback and learning-data integrity | 9 Operations | Accepted | 8 Implemented, 1 In progress, 1 Not started | 10 |
| [ADR-0110](adr-0110-wcag-keyboard-zoom-motion-and-screen-readers.md) | WCAG 2.2 AA accessibility, keyboard ownership, touch, reflow and human assistive technology | 1–11 Cross-cutting | Accepted | 9 Implemented, 0 In progress, 1 Not started | 10 |
| [ADR-0111](adr-0111-frontend-architecture-performance-and-privacy.md) | Frontend module boundaries, CSS performance, 20k/100-song scale and local-first privacy | 1–11 Cross-cutting | Accepted | 7 Implemented, 3 In progress, 0 Not started | 10 |
| [ADR-0112](adr-0112-tests-matrix-visual-e2e-and-concurrency.md) | Full regression strategy, stable test fixtures, visual review and adversarial races | 0–12 Verification | Accepted | 8 Implemented, 2 In progress, 0 Not started | 10 |
| [ADR-0113](adr-0113-research-migration-rollback-and-release.md) | User research, phased migration, evidence ledger, rollback and explicit go/no-go | 0–13 Governance/release | Accepted | 2 Implemented, 5 In progress, 3 Not started | 10 |
| **TOTAL** | **25 Accepted decisions** | | | **202 Implemented, 36 In progress, 12 Not started / 0 Verified** | **250** |

## Binding preservation invariants

- **V4-INV-01** Original user audio is never altered or deleted via the UI; existing secure local path and Host/Origin contracts remain intact.
- **V4-INV-02** Existing mixes, drafts, source monitoring, corrections, preferences, ratings, requests and export jobs remain recoverable across migration/rollback.
- **V4-INV-03** Exact current versus draft scope, revision, stable song/seam IDs and scoped Undo prevent wrong-mix mutations.
- **V4-INV-04** Route, theme, density, overlay and Stage changes do not remount or unexpectedly interrupt the audio controller.
- **V4-INV-05** Single audio ownership for all previews; no overlap and no surprise resume after an explicit Pause.
- **V4-INV-06** All old routes/aliases/query deep links, Media Session behaviour and pointer/touch/keyboard alternatives remain.
- **V4-INV-07** Requested, selected, preparing, rendered, fallback, actually audible and human-rated transition truths remain separate.
- **V4-INV-08** Bridge additions require explicit extra-song consent and atomic idempotent insertion.
- **V4-INV-09** Stem Studio retains all eight lanes, supported variable cell counts, assistance, audition, local recovery and guarded Apply.
- **V4-INV-10** Export is decodable FLAC for the exact frozen mix/draft revision, surviving dialog dismissal/reload.
- **V4-INV-11** Blind A/B protocol and evaluation-data identity survive.
- **V4-INV-12** All prior functionality and backend API contracts remain, even when moved into progressive disclosure.
- **V4-INV-13** WCAG 2.2 AA target, human AT, reduced motion, reflow and independent light/dark legibility.
- **V4-INV-14** Test assertions never weakened merely to pass UI change; docs and green build alone never mean Verified.
- **V4-INV-15** New APIs, dependencies, audio-engine changes and external network features require separate approved decisions.
- **V4-INV-16** Reversible migration and rollback are demonstrated before implementation release.

## Dependency sequence and evidence gates

| Stage | ADRs | Primary result | Exit gate |
|---|---|---|---|
| 0 - Baseline | 0089, 0113 | Actual main-state inventory, parity mapping, risk register and observed task baseline | Named owner signs scope and baseline |
| 1 - Foundations | 0090–0091, 0094–0095, 0110–0111 | Semantic theme system, typography, controls, state architecture, keyboard/performance contracts | Both themes and negative cases verified |
| 2 - Shell | 0092–0093 | Desktop rail, mobile nav, header, mini-player, inspector container | History and audio continuity preserved |
| 3 - First value | 0096–0097 | Onboarding, ready count, Explore and steering | Unassisted first valid mix |
| 4 - Listen | 0098 | Waveform, lyrics, visualizer, Up next, Stage | Live playback and real-audio acceptance |
| 5 - Creator | 0099–0101 | Drafts, editor and transition inspector | Correct scope, reorder, Undo, render identity |
| 6 - Expert | 0102 | Eight-lane Studio and safe Apply | Grid keyboard, recovery, 64-cell case |
| 7 - Discovery | 0103–0104 | Requests/consented bridges, Word and harmonic discovery | No duplicate/partial bridge; accurate feedback |
| 8 - Library | 0105–0106 | Large browse and safe corrections | 20k Library, deep refresh, original-file safety |
| 9 - Operations | 0107–0109 | Workspace, sources, storage, FLAC export and blind study | Frozen FLAC decode, true jobs, blinded protocol |
| 10 - Tests | 0110–0112 | Full WCAG, E2E, visuals, fault injection and performance | Named human/AT/audio evidence, exact test SHA |
| 11 - Release | 0113 | Rollback, decision reconciliation and owner GO/NO-GO | Explicit sign-off, no P0 and accepted P1 risk |

All stages are sequencing hypotheses, **not promised durations**. Track only actual PR and evidence in the [ledger](selecta-4-evidence.md).

## How to maintain the programme

1. Accept/reject individual ADR decisions with named owner and rationale; docs merge alone does not accept them.
2. Implement reversible scoped PRs that name exact `S4-XXXX-NN` and original S3/S31 references; preserve backend/audio stability.
3. When code and automated required tests actually merge, set that task to **Implemented** in the ledger. When human/audio/AT/visual/perf acceptance is complete, set it to **Verified** and only then check its box.
4. Preserve no-go until [release gates](selecta-4-release-gates.md) are met; unreviewed visuals or aggregate CI alone are not permission to ship.
5. Add newly discovered capabilities to the [feature-parity map](selecta-4-feature-parity.md). Never drop unlisted old functions silently.

## Supporting artifacts

- [250-item implementation checklist](selecta-4-implementation-checklist.md)
- [Per-task evidence ledger](selecta-4-evidence.md)
- [Full feature preservation matrix](selecta-4-feature-parity.md)
- [Verification, visual and adverse-case matrix](selecta-4-verification-matrix.md)
- [Release NO-GO and sign-off register](selecta-4-release-gates.md)
- [Historical 3.0 roadmap](selecta-3-roadmap.md), [3.1 roadmap](selecta-3-1-roadmap.md) and [historical 3.1 release readiness](selecta-3-1-release-readiness.md)
