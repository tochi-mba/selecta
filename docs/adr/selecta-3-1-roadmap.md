# Selecta 3.1 - verification-led UI/UX finishing plan

- **Date:** 2026-11-07
- **Baseline:** `main` 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831` (PR #24 merged).
- **Decision status:** Accepted for ADR-0078–0088; the owner has not approved their design decisions.
- **Implementation status:** PR #25 merged (`6d78cf4`). 70 Implemented, 34 partly implemented, 10 need a person, 2 not started; **0/116 Verified**. See the [ledger](selecta-3-1-evidence.md#task-status).
- **Scope:** Initially documentation-only; PR #25 now contains frontend and regression tests, plus non-blocking synthetic screenshot artifact upload in CI. Backend, schema, audio engine and dependencies are unchanged.
- **History:** Existing ADR-0001–0077 and T/P/S3 task IDs remain intact. Prior roadmap ledgers, including the still-stale 3.0 "PR open" snapshot, are not proof of merged/verified work.

## Direction

Selecta 3.0 already introduced intent-based navigation, a responsive shell, a persistent mini-player, tokens and theme choice, accessible primitives, Activity/Undo, audio focus protection, revision-pinned exports, revised pages and substantial tests. This programme is **not another redesign**. It reconciles what shipped, removes visual and workflow inconsistency, and validates real human use before further runtime changes. Distinguish code observations, design hypotheses, actual browser measurements and human judgments.

One product with three depths: **listener-effortless**, **creator-confident**, **expert-precise**. Keep Play obvious, advanced tools discoverable, precise music state trustworthy, and failure recovery dependable.

## Preservation contract

The [Selecta 3.0 INV-01–INV-20 requirements](selecta-3-roadmap.md) remain binding. No source-music modification; no loss of drafts/corrections/ratings/preferences; no wrong mix or stale write; old route and query compatibility; one audio owner with no unintended silence, overlap or resumption; entire approved bridges only; accurate readiness and requested-versus-rendered status; revision-accurate decodable FLAC; localhost/Host/Origin and LRCLIB metadata disclosure; WCAG-compatible essential workflows; existing behavioural tests stay intact. These are not negotiable for a visual improvement.

## Decision index

| ADR | Phase | Workstream | Open S31 tasks | Decision | Implementation |
|---|---|---|---:|---|---|
| [ADR-0078](adr-0078-baseline-evidence-and-governance.md) | 0 Baseline | Reconcile the shipped 3.0 baseline and govern finishing work | 10 | Accepted | 5 implemented, 2 partly implemented, 2 need a person, 1 not started |
| [ADR-0079](adr-0079-visual-system-and-css-ownership.md) | 1 Foundations | Unify typography, themes, visual rhythm and CSS ownership | 10 | Accepted | 1 implemented, 7 partly implemented, 1 needs a person, 1 not started |
| [ADR-0080](adr-0080-interaction-state-recovery-and-undo.md) | 1 Foundations | Make controls, asynchronous states, recovery and Undo dependable | 10 | Accepted | 8 implemented, 2 partly implemented |
| [ADR-0081](adr-0081-first-run-explore-and-mix-choice.md) | 2 Listener | Reduce friction from first music folder to a confident first mix | 10 | Accepted | 8 implemented, 2 need a person |
| [ADR-0082](adr-0082-listen-shell-stage-and-audio-trust.md) | 2 Listener | Polish Listen, navigation, mini-player and Stage without audio regressions | 11 | Accepted | 6 implemented, 5 partly implemented |
| [ADR-0083](adr-0083-mixes-editor-inspector-and-export.md) | 3 Creator | Make drafts, timeline editing, transition intent and export unambiguous | 12 | Accepted | 10 implemented, 2 partly implemented |
| [ADR-0084](adr-0084-stem-studio-workstation-polish.md) | 3 Creator | Refine Stem Studio's expert controls without reducing capability | 9 | Accepted | 5 implemented, 4 partly implemented |
| [ADR-0085](adr-0085-requests-and-music-discovery.md) | 4 Discovery/Operations | Clarify Requests, consented bridges and discovery auditions | 10 | Accepted | 8 implemented, 2 partly implemented |
| [ADR-0086](adr-0086-library-workspace-study-and-operational-trust.md) | 4 Discovery/Operations | Polish Library, Workspace, studies and operational status | 11 | Accepted | 8 implemented, 3 partly implemented |
| [ADR-0087](adr-0087-accessibility-responsive-and-performance-gates.md) | 5 Cross-cutting quality | Verify WCAG, device reflow, audio latency and scale | 11 | Accepted | 5 implemented, 5 partly implemented, 1 needs a person |
| [ADR-0088](adr-0088-research-visual-regression-and-release.md) | 6 Verification | Require observable user, visual and product acceptance before release | 12 | Accepted | 6 implemented, 2 partly implemented, 4 need a person |
| **Total** | | | **116** | | **70 Implemented / 0 Verified** |

## Dependencies and proposed delivery order

1. **Phase 0 (indicative week 1) - baseline**: ADR-0078. Pin the actual code/feature/state baseline, reconcile inherited S3 tasks, record issue severity, screenshots and unassisted task observations. **Gate:** owner approves evidence boundaries and priority list.
2. **Phase 1 (week 2) - foundations**: ADR-0079 and ADR-0080. Standardize design tokens/CSS rule ownership and reliable loading/action/overlay/Undo behaviour. **Gate:** shared component states are demonstrably consistent in both themes.
3. **Phase 2 (weeks 3–4) - listener journeys**: ADR-0081 and ADR-0082. Onboarding, Explore, Listen, Stage, mini-player and request entry. **Gate:** a new user can reach a valid first mix and maintain safe playback and control.
4. **Phase 3 (weeks 4–5) - creator journeys**: ADR-0083 and ADR-0084. My Mixes, editor, Inspector, Studio and export. **Gate:** drafts, exact mix scope and revision-pinned audio/export survive realistic negative and concurrent cases.
5. **Phase 4 (week 6) - discovery and operations**: ADR-0085 and ADR-0086. Requests/bridges, Word/Harmonic discovery, Library, Workspace and studies. **Gate:** no misleading readiness, unconsented bridge, lost override or unsafe operation.
6. **Phase 5 (throughout, integrated week 7) - quality**: ADR-0087. Keyboard and actual assistive technology, all viewport classes, 20k Library, 100-song editor, Studio and real audio/performance measurements. **Gate:** no inaccessible essential flow or P0 regression.
7. **Phase 6 (week 8 indicative) - acceptance and release**: ADR-0088. Visual snapshots, unassisted participant sessions, auditory and FLAC review, rollback, evidence and go/no-go. **Gate:** owner signs off observed results and any remaining limitation.

Weeks are **planning estimates, not promises or evidence of work done**. Accessibility, correctness and data protection are reviewed continuously, not deferred to the end.

## Severity and order of attack

- **P0 - stop:** source/user data loss, wrong draft/current revision, playback overlap/unintended silence/resume, partial/unconsented bridge, wrong/invalid FLAC, unsafe path/privacy transfer, invented readiness or inaccessible essential task.
- **P1 - block absent documented owner acceptance:** core task dead end, missing recovery path, unusable first-run, persistent player obstruction, misleading active state.
- **P2 - planned polish:** spacing, typography, visual state, copy, motion and alignment inconsistencies whose functionality is intact.

Prioritize P0 before P1 and high-frequency listener/creator work before rare detail. Individual issues must have reproducible steps, location, expected outcome and a clear proof test.

## Human outcomes and provisional measurement

Start with unassisted listener, creator and expert scripts from [3.0 baseline](selecta-3-baseline.md); include failure scenarios and assistive technology. Measure first successful mix, completion, hesitation, incorrect edits, recovery and confidence. **Provisional** targets, to approve after baselining: >=90% unassisted completion for agreed core tasks, zero critical unsafe outcomes and no systematic misunderstanding of Play/Skip/Next, draft scope or bridge consent. No outcome is currently claimed.

Treat web performance references (INP <=200ms, CLS <=0.1) as methodology context. Record device/production-build measurements; never pretend localhost lab runs are field 75th-percentile results. Audit light/dark/system themes, width 320–3840px, keyboard, touch, 200/400% zoom, reduced motion, safe areas and media continuity.

## PR scope and governance

PR #25 began as planning documentation; it now includes scoped source/test work on controls, onboarding, Listen, editor intent, Studio recovery, mix scope and visual capture infrastructure. This does **not** accept ADR decisions, justify checking tasks off or satisfy the other release gates. Further work must map each S31 and inherited S3/parity row to code and real automated/human evidence. Do not merge on the strength of partial work.

## Supporting documents

- [116-item implementation checklist](selecta-3-1-implementation-checklist.md)
- [Adversarial verification and usability matrix](selecta-3-1-verification-matrix.md)
- [Synthetic visual-review candidates](selecta-3-1-visual-review.md)
- [Route, overlay and state inventory](selecta-3-1-surface-inventory.md)
- [Release readiness and outstanding human acceptance](selecta-3-1-release-readiness.md)
- [Per-task evidence ledger](selecta-3-1-evidence.md)
- [Measurements: scale, FLAC, rollback](selecta-3-1-measurements.md)
- [Source inspection and research references](../research/selecta-3-1-polish.md)
- [Selecta 3.0 road map](selecta-3-roadmap.md), [parity](selecta-3-parity-matrix.md), [verification](selecta-3-verification-matrix.md), [legacy evidence](selecta-3-evidence.md)
