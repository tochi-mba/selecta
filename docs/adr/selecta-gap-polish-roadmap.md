# Selecta - gap-focused UI/UX polish roadmap

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-gap-polish-implementation-checklist.md)):** 16 Accepted ADRs (0248-0263, owner accepted 2026-11-08); 128 GP tasks: 111 Implemented, 0 In progress, 17 Not started (each names a person-only step); **0 independently Verified**.

**Historical 2026-11-08 planning baseline:** **16 Proposed ADRs (0248–0263), 128 new GP tasks Not started, 0 In progress, 0 Implemented and 0 independently Verified.** Planning baseline main `2956bc47fd735339e7216e03d27817fb3a31e92b` on 2026-11-08. Owner decisions remain pending. This PR changes only documentation; it neither implements code nor changes historical SF/CI/MI or earlier statuses.

## Why a distinct programme?

The accepted 50-ADR Selecta / Flow programme already defines broad art direction, design tokens, fifteen existing spectrum modes, first run, navigation, audio player, library paging, stem architecture, requests, FLAC, accessibility and release governance. The GP delta addresses specific under-specified trust, recognition and recovery workflows; no broad new redesign is authorized.

| Proposed ADR | Priority | Decision | Implementation | Independent verification | Existing owners |
|---|---|---|---|---|---|
| [ADR-0248](adr-0248-content-aware-title-typography.md) - Content-aware music title typography | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0202, ADR-0203, ADR-0210, ADR-0233 |
| [ADR-0249](adr-0249-listen-attention-hierarchy.md) - Listen control hierarchy and attention budget | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0210, ADR-0212, ADR-0214, ADR-0215 |
| [ADR-0250](adr-0250-edit-and-inspector-selection.md) - Edit and Inspector selection arbitration | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0219, ADR-0220, ADR-0221, ADR-0232 |
| [ADR-0251](adr-0251-music-aware-search.md) - Music-aware Library search and recording relevance | P0 | Accepted | Implemented (8/8) | No (0/8) | ADR-0226, ADR-0227, ADR-0244 |
| [ADR-0252](adr-0252-safe-library-relink.md) - Non-destructive file relocation and Library re-link | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0227, ADR-0230, ADR-0238 |
| [ADR-0253](adr-0253-durable-local-backups.md) - Durable local data backup and validated restore | P0 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0230, ADR-0231, ADR-0238, ADR-0241 |
| [ADR-0254](adr-0254-physical-audio-interruptions.md) - Physical audio interruption and output recovery | P0 | Accepted | Implemented (6/8), 2 Not started | No (0/8) | ADR-0209, ADR-0232, ADR-0235 |
| [ADR-0255](adr-0255-return-to-work.md) - Returning-session and unfinished-work continuity | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0208, ADR-0219, ADR-0228 |
| [ADR-0256](adr-0256-contextual-music-help.md) - Contextual music terms and safe discoverable guidance | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0221, ADR-0242, ADR-0246 |
| [ADR-0257](adr-0257-long-session-comfort.md) - Long-session visual comfort and notification budget | P1 | Accepted | Implemented (6/8), 2 Not started | No (0/8) | ADR-0205, ADR-0210, ADR-0232, ADR-0235 |
| [ADR-0258](adr-0258-safe-batch-library-actions.md) - Exact-scope batch Library operations | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0226, ADR-0227, ADR-0232 |
| [ADR-0259](adr-0259-explore-expectations.md) - Explore choice comparison and truthful mix expectations | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0216, ADR-0217, ADR-0222 |
| [ADR-0260](adr-0260-discovery-to-create.md) - Evidence-backed Discovery to Create handoff | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0218, ADR-0219, ADR-0225 |
| [ADR-0261](adr-0261-studio-mental-model.md) - Stem Studio novice mental model and expert confidence | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0223, ADR-0224 |
| [ADR-0262](adr-0262-request-outcome-uncertainty.md) - Request waiting uncertainty and promised outcomes | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0225, ADR-0232, ADR-0237 |
| [ADR-0263](adr-0263-workspace-self-service.md) - Workspace self-service recovery and privacy-safe diagnostics | P1 | Accepted | Implemented (7/8), 1 Not started | No (0/8) | ADR-0229, ADR-0230, ADR-0232, ADR-0238 |
| **16 / 128 tasks** | | **16 Accepted** | **111 Implemented, 17 Not started** | **0 Verified** | Older statuses unchanged |

## Phase plan

1. **Capture complete baseline:** All routes and states: Start, Setup, Explore, Listen, Stage, Up Next, Create, Inspector, My Mixes, Drafts, Stem Studio, Requests, Word/Harmonic Discovery, Library, Song Details, Workspace and Export. Record exact source SHA and compare proposed tasks against SF/CI/MI acceptance; remove redundant work before implementation.
2. **P0 visibility:** ADR-0248–0250: adaptive real music title fitting, restrained Listen controls, clear Edit selection. Prove no loss of player/inspector functionality on keyboard/zoom/real audio.
3. **P0 retrieval/data safety:** ADR-0251–0253: labeled music-query ranking, conservative local re-link and transactional backup with guaranteed recoverability. These are security and source-media safety gates, not cosmetic changes.
4. **P0 physical playback:** ADR-0254: real hardware/device/sleep behavior and strict intentional Pause semantics.
5. **P1 continuation and efficiency:** ADR-0255–0258: recent unfinished work, contextual guidance, sustained comfort and research-driven safe batch actions.
6. **P1 secondary journeys:** ADR-0259–0263: mix-choice expectations, Discovery-to-Create, Studio mental model, request uncertainty and Workspace diagnostics.
7. **Independent GO/NO-GO:** approved owner decision, targeted implementing PR/SHA, actual test reports, named human/audio/AT reviewer, no P0 blockers, reversible rollout. Screenshot capture and green CI alone are not approval.

**Preserve:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

[Task checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence ledger](selecta-gap-polish-implementation-evidence.md) · [Machine status](selecta-gap-polish-code-status.json) · [Full surface parity](selecta-gap-polish-overlap-and-parity.md) · [Independent verification](selecta-gap-polish-verification-matrix.md) · [Status reconciliation](selecta-gap-polish-status-reconciliation.md) · [Release gates](selecta-gap-polish-release-gates.md).
