# Selecta - final-polish incremental roadmap

**2026-11-08 docs-only planning baseline:** main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`. **8 Proposed ADRs** (0264–0271), **64 task acceptances Not started**, 0 In progress, 0 Implemented, **0 independently Verified**. Owner decisions/implementing PRs are not supplied. Existing prior programme ledgers are not changed.

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-final-polish-implementation-checklist.md)):** 8 Accepted ADRs (0264-0271); 64 task acceptances: 53 Implemented, 2 In progress, 9 Not started (each names a person-only step); **0 independently Verified**. The line above is the historical 2026-11-08 baseline.

## Why these eight, and not another broad redesign?

The repository already has accepted SF ADR-0198–0247 (400 new acceptance tasks at their historical baseline), proposed GP ADR-0248–0263 (128 added acceptance tasks at their historical baseline), and substantially functional music UI. New decisions only describe **testable, previously under-specified deltas**; they do not declare the features absent. Before implementation, reconcile each exact FP requirement against source, SF/GP owners and existing tests. No changes to audio/backend/frontend are authorized by this documentation PR.

## ADR index and decision status

| ADR | Proposed delta | Priority | Owner links | Decision | Implementation | Independent proof |
|---|---|---|---|---|---|---|
| [ADR-0264](adr-0264-light-interactive-boundaries.md) | Light interactive boundary roles | P0 | ADR-0201, ADR-0204, ADR-0234, ADR-0257 | Accepted | Implemented 6/8, 1 In progress, 1 Not started | No 0/8 |
| [ADR-0265](adr-0265-browser-chrome-theme-sync.md) | Manual theme and PWA chrome precedence | P1 | ADR-0077, ADR-0201, ADR-0208, ADR-0238 | Accepted | Implemented 6/8, 2 Not started | No 0/8 |
| [ADR-0266](adr-0266-live-theme-music-graphics.md) | Live-theme musical mark parity | P0 | ADR-0201, ADR-0212, ADR-0214, ADR-0222, ADR-0223, ADR-0234 | Accepted | Implemented 7/8, 1 Not started | No 0/8 |
| [ADR-0267](adr-0267-contextual-library-batch-presentation.md) | Contextual Library selection rail | P0 | ADR-0226, ADR-0227, ADR-0232, ADR-0258 | Accepted | Implemented 6/8, 1 In progress, 1 Not started | No 0/8 |
| [ADR-0268](adr-0268-explore-card-information-budget.md) | Explore card content and disclosure budget | P0 | ADR-0216, ADR-0217, ADR-0222, ADR-0259 | Accepted | Implemented 7/8, 1 Not started | No 0/8 |
| [ADR-0269](adr-0269-cross-route-action-tier-map.md) | Cross-route action-tier register | P1 | ADR-0204, ADR-0208, ADR-0216, ADR-0219, ADR-0249, ADR-0256, ADR-0259 | Accepted | Implemented 7/8, 1 Not started | No 0/8 |
| [ADR-0270](adr-0270-viewport-layer-occlusion.md) | Stacked-viewport focus and chrome arbitration | P0 | ADR-0208, ADR-0209, ADR-0204, ADR-0233, ADR-0234 | Accepted | Implemented 7/8, 1 Not started | No 0/8 |
| [ADR-0271](adr-0271-paired-theme-state-visual-evidence.md) | Paired same-state light/dark review | P0 | ADR-0201, ADR-0234, ADR-0239, ADR-0240, ADR-0247, ADR-0257 | Accepted | Implemented 7/8, 1 Not started | No 0/8 |
| **8 / 64** | | | | **8 Accepted** | **53 Implemented, 2 In progress, 9 Not started** | **0 Verified** |

## Phase order and each exit gate

1. **Baseline and reconciliation (P0):** pin source SHA, identify already-satisfied or redundant FP acceptances, record findings without retroactively changing SF/GP status. **Exit:** signed source-to-task crosswalk and reproducible failing/positive fixtures.
2. **Light-theme boundary and live graphics (ADR-0264, 0266):** audit functional boundary contrast separately from decorative lines; preserve live musical semantics across theme changes. **Exit:** adjacent-surface quantitative readings, same-state theme captures, no loss of audio.
3. **Everyday scanning (ADR-0267, 0268):** show Library bulk rail only for actual selection and make Explore card options immediately scannable. **Exit:** exact-ID batch tests, supported card facts and independent task comparisons.
4. **All-route hierarchy (ADR-0269):** crosswalk primary/contextual/advanced actions without hiding DJ functions. **Exit:** same feature parity and uncoached control discovery.
5. **System chrome and small-view interaction (ADR-0265, 0270):** resolved-theme browser chrome plus keyboard/player/overlay collision arbitration. **Exit:** browser support truth table and zero critical occlusions.
6. **Acceptance (ADR-0271):** same data/state/viewport Light and Dark screenshots, independent AT/audio/visual reviews and signed no-P0 release decision. **Exit:** explicit required/approved pair counts and rollback demonstration.

Every phase may be split into small reversible source PRs only **after owner decision**. New docs are proposals, not implementation.

## Hard preservation constraints

Original local music files untouched; one player/audio focus owner and deliberate Pause; accurate occurrence/seam and draft/current revision; exact scoped Undo; explicitly consented atomic request bridges; eight lanes and 8–64 cells in Studio; truthful library readiness and LRCLIB disclosure; blind study integrity; frozen-revision decodable FLAC. Retain all 15 current visualizers. No cloud audio, accounts, SaaS, unconsented telemetry or unrelated rearchitecture.

## Required release status and evidence discipline

Decision Proposed → Accepted/Rejected/Superseded requires a dated owner. Implementation Not started → In progress → Implemented requires source/test PR/SHA and task-level proof. **Independent Verified** requires named reviewer and real device, AT, performance and audio evidence as relevant; source presence and screenshot capture do not suffice.

Status counters refer only to this programme. Do not add SF + GP + FP counters as if they were independent absent product features.

 [Roadmap](selecta-final-polish-roadmap.md) · [Task checklist](selecta-final-polish-implementation-checklist.md) · [Evidence ledger](selecta-final-polish-implementation-evidence.md) · [Code status](selecta-final-polish-code-status.json) · [Overlap/parity](selecta-final-polish-overlap-and-parity.md) · [Verification](selecta-final-polish-verification-matrix.md) · [Release gates](selecta-final-polish-release-gates.md) · [Status reconciliation](selecta-final-polish-status-reconciliation.md).
