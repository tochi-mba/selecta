# Selecta 3.1 — verification-led UI/UX finishing proposal (2026-11-07)

**Proposed decisions: ADR-0078–0088. Implementation: Not started. 116 tasks: 0 Implemented / 0 Verified. Documentation-only planning PR.** This programme follows Selecta 3.0's merged PR #24 and focuses on reconciling actual implementation evidence, consistent visuals, listener/creator workflow polish and human release acceptance—not another feature rewrite.

Start with the [3.1 roadmap and ADR index](selecta-3-1-roadmap.md), [116-item checklist](selecta-3-1-implementation-checklist.md), [verification matrix](selecta-3-1-verification-matrix.md), [evidence ledger](selecta-3-1-evidence.md) and [research notes](../research/selecta-3-1-polish.md). Prior ADR-0001–0077 and T/P/S3 trackers are preserved. **Historical 3.0 "PR #24 open" statements in older files are stale after the merge and must be reconciled against code/CI before any status is advanced.**

---

# Selecta 2.0 — UI/UX architecture decision records

## Selecta 3.0 — full experience overhaul proposal (2026-11-07)

**Decision status: Proposed. Implementation status: In progress on PR #24; not Verified.** See the [new roadmap and ADR index](selecta-3-roadmap.md), ADR-0047–0077, [258 individually tracked work items](selecta-3-implementation-checklist.md), [feature preservation map](selecta-3-parity-matrix.md), [verification plan](selecta-3-verification-matrix.md), [evidence ledger](selecta-3-evidence.md) and [research notes](../research/selecta-3-overhaul.md).

This programme began **documentation only**, but PR #24 now includes runtime, audio, API, frontend and test changes. Its historical roadmap/checklist status summaries are not complete implementation evidence. Retain the warm black/cream/lime identity and the complete functional preservation contract while proposing an extensive navigation and workspace overhaul. Merging this proposal does not itself approve any decision or mark an implementation task complete.

Earlier ADR-0001–0046 history is retained. Older headline status summaries may be stale: PR #23 has merged, but actual implementation and verification evidence must be reconciled before any new code work.

## New UI/UX polish programme (2026-11-06)

The [polish roadmap and ADR index](polish-roadmap.md) adds ADR-0033–0046 and a separate [143-task implementation checklist](polish-implementation-checklist.md). Every new decision is **Proposed** and every new implementation is **Not started**. This is a documentation-only proposal; it does not reset or complete the older programme below.

See the [polish verification matrix](polish-verification-matrix.md), [evidence ledger](polish-implementation-evidence.md) and [research notes](../research/ui-ux-polish.md). Historical summary statements below belong to the original programme; use its linked evidence and source inspection to reconcile them, not as the status of this new plan.

## Original programme

**Document decision status: Proposed**  
**Overhaul implementation status: In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))**  
**Proposed date: 2026-11-06**

These documents propose a complete future redesign with full functional preservation. They do **not** implement the redesign, update the backend, modify audio behaviour, replace current tests or constitute evidence that any feature has shipped. Review and separately accept each decision before implementation.

## Vision and non-negotiable preservation

Selecta remains an offline/local-first DJ for the user's own music. Listening is effortless; creation and technical details are available on demand. Keep the existing warm dark/cream/electric lime identity, blue request semantics, warning orange, the current transition engine, drafted mixes, live requests with bridge approval, stem editing, word/harmonic discovery, evaluation and real FLAC export. Never trade away user intent, privacy, data integrity or audio correctness for visual polish.

## Dual status model

- **Decision status:** Proposed → Accepted; or Rejected / Superseded with rationale.
- **Implementation status:** Not started → In progress → Implemented → Verified.
- **Implemented** means code and its required tests have merged; **Verified** additionally requires recorded acceptance, regression, accessibility and audible evidence as applicable.
- Documentation can be merged while every decision remains Proposed and every implementation remains Not started.
- Any implementing PR updates the ADR, this index, feature parity, roadmap and tests with explicit PR/commit evidence. Never mark an item done based on a plan, screenshots or mocked success alone.

## ADR index

| ADR and decision | Decision status | Implementation status | Phase |
|---|---|---|---|
| [ADR-0001 — Product contract, scope and no-regression guarantees](adr-0001-product-contract-and-parity.md) | Proposed | In progress | 0 |
| [ADR-0002 — Contextual navigation, routing and persistent player shell](adr-0002-routing-and-shell.md) | Proposed | Implemented | 2 |
| [ADR-0003 — Semantic design system retaining Selecta's colours](adr-0003-design-tokens-and-brand.md) | Proposed | In progress | 1 |
| [ADR-0004 — Reusable controls, overlays, status and undo](adr-0004-interaction-primitives-and-notifications.md) | Proposed | In progress | 1 |
| [ADR-0005 — Typed API state, revisions and optimistic mutation consistency](adr-0005-domain-state-mutations.md) | Proposed | In progress | 3 |
| [ADR-0006 — Web Audio transport, seeking and Media Session semantics](adr-0006-audio-transport-and-media.md) | Proposed | In progress | 4 |
| [ADR-0007 — Coordinating main player and all audition audio](adr-0007-audio-focus-ownership.md) | Proposed | In progress | 4 |
| [ADR-0008 — Listen composition, waveform and next-transition clarity](adr-0008-listen-screen.md) | Proposed | In progress | 4 |
| [ADR-0009 — Synchronized lyrics, lyric focus and fullscreen Stage](adr-0009-lyrics-and-stage.md) | Proposed | In progress | 4 |
| [ADR-0010 — Vibe discovery, featured choice and build preparation](adr-0010-mix-discovery.md) | Proposed | In progress | 5 |
| [ADR-0011 — Energy curve, duration, transition feel and destination scope](adr-0011-steering-and-energy.md) | Proposed | In progress | 5 |
| [ADR-0012 — My Mixes projects, draft operations and render queue](adr-0012-drafts-and-queue.md) | Proposed | Implemented | 6 |
| [ADR-0013 — Song/seam arrangement timeline and stable edit scope](adr-0013-edit-timeline.md) | Proposed | In progress | 6 |
| [ADR-0014 — Seam inspector, cues, previews, fallbacks and auditing](adr-0014-seam-inspector.md) | Proposed | In progress | 6 |
| [ADR-0015 — Live Requests, route consent and atomic bridge joining](adr-0015-requests-and-bridges.md) | Proposed | In progress | 7 |
| [ADR-0016 — Stem Studio 64-cell creative workstation](adr-0016-stem-studio.md) | Proposed | In progress | 8 |
| [ADR-0017 — Library scale, filters and canonical mix readiness](adr-0017-library-scale-and-readiness.md) | Proposed | Implemented | 9 |
| [ADR-0018 — Analysis overrides and secure library-source management](adr-0018-library-corrections-and-folders.md) | Proposed | In progress | 9 |
| [ADR-0019 — Word-link discovery and harmonic staged auditions](adr-0019-discover-words-and-harmony.md) | Proposed | In progress | 9 |
| [ADR-0020 — Workshop, background processing, queue and cache transparency](adr-0020-workshop-and-storage.md) | Proposed | In progress | 10 |
| [ADR-0021 — Blind A/B evaluation protocols and reliable submission](adr-0021-blind-listening.md) | Proposed | In progress | 10 |
| [ADR-0022 — Rendered FLAC export and artifact lifecycle](adr-0022-flac-export.md) | Proposed | In progress | 6 |
| [ADR-0023 — WCAG 2.2 AA, screen readers and keyboard conventions](adr-0023-accessibility.md) | Proposed | In progress | 1–12 |
| [ADR-0024 — Mobile, tablet, wide-screen and high-zoom workspace design](adr-0024-responsive-workspaces.md) | Proposed | In progress | 2–12 |
| [ADR-0025 — Local-only security, privacy and filesystem boundaries](adr-0025-local-privacy.md) | Proposed | Implemented | 3–13 |
| [ADR-0026 — Additive backend contracts, stable identifiers and feature detection](adr-0026-api-compatibility.md) | Proposed | In progress | 3–10 |
| [ADR-0027 — Truthful AI explanations and musical feedback](adr-0027-explanations-and-feedback.md) | Proposed | In progress | 4–10 |
| [ADR-0028 — Backend-offline recovery, conflicts and multiple tabs](adr-0028-recovery-and-multitab.md) | Proposed | In progress | 3–12 |
| [ADR-0029 — Regression strategy, real audio fixtures and release quality gates](adr-0029-testing-and-quality.md) | Proposed | In progress | 0–13 |
| [ADR-0030 — Incremental migration, rollback and ADR status governance](adr-0030-migration-and-release.md) | Proposed | Implemented | 0–13 |
| [ADR-0031 — Installed PWA, browser features and platform integrations](adr-0031-pwa-and-browsers.md) | Proposed | In progress | 2–13 |
| [ADR-0032 — Privacy-safe diagnostics and truthful background-job feedback](adr-0032-diagnostics-and-operations.md) | Proposed | In progress | 10–13 |

## Planning and verification artifacts

- [What's done, task by task](implementation-evidence.md) — all 279 tracker tasks.
- [Implementation roadmap and release gates](implementation-roadmap.md) — phase by phase.
- [Feature preservation and no-regression matrix](feature-parity.md) — every feature and where it now lives.
- [Existing/new test and edge-case matrix](test-coverage-matrix.md) — which suite covers what.
- [Current acceptance ledger](../acceptance.md) records existing, measured behaviour and limits; do not overwrite it with speculative future success.
- [UI/UX research notes](../research/ui-ux.md) give precedent and documented uncertainty.

## How to maintain these ADRs

1. Record the implementation issue/PR and dependencies in the relevant ADR status history.
2. Decide Accepted, Rejected or Superseded explicitly; docs existence does not imply acceptance.
3. Add implementation PRs incrementally; keep every capability in the parity matrix.
4. Update tests and acceptance evidence before moving from Implemented to Verified.
5. Do not remove source features or weaken behavioural tests merely to make a new layout seem complete.
6. Treat audio continuity, wrong-mix edits, request atomicity, source-file safety, a11y, export correctness and localhost protections as release blockers.

**Current status of the whole Selecta 2.0 programme: Not started. This PR is documentation-only.**
