# Selecta / Flow - cross-programme status and source evidence reconciliation

**2026-11-12 status (recounted from the task lines of the [checklist](selecta-flow-implementation-checklist.md)):** 50 Accepted ADRs; 400 SF tasks: 263 Implemented, 17 In progress, 70 Not started, 46 Needs a person, 4 Superseded; **0 independently Verified**.

**Historical baseline - this design programme as first documented:** 50 **Accepted** ADRs, 400 new SF tasks **Not started**, 0 In progress, 0 Implemented, **0 independently Verified**. Source baseline: main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15` (2026-11-08). Do not interpret the 400 tasks as 400 missing existing capabilities. Many current code features are already present and may satisfy portions of new acceptance requirements; they are not automatically credited until examined at the *new task's exact acceptance level*.

| Programme | Historical record | Scope inherited | Status changed by this PR? |
|---|---|---|---|
| T / ADR-0001–0032 | [Implementation evidence](implementation-evidence.md) | Local audio, filesystem, feature correctness and product architecture | None |
| P / ADR-0033–0046 | [Polish evidence](polish-implementation-evidence.md) | Initial visual system and controls | None |
| Selecta 3 / ADR-0047–0077 | [3.0 evidence](selecta-3-evidence.md) | Core app experience, source handling and regression patterns | None |
| Selecta 3.1 / ADR-0078–0088 | [3.1 evidence](selecta-3-1-evidence.md) | Visual testing and interaction foundations | None |
| Selecta 4 / ADR-0089–0113 | [4.0 evidence](selecta-4-evidence.md) | Broader UI architecture, information hierarchy and preservation | None |
| Experience EX / ADR-0114–0134 | [EX evidence](selecta-experience-evidence.md) | Intent-first journeys, editor and music presentation | None |
| Immersive MI / ADR-0135–0164 | [MI reconciliation](selecta-microinteraction-status-reconciliation.md) | Motion, source-level Listen, Studio, recovery and tooling | None; previously published MI snapshot: 208 Implemented, 4 In progress, 28 Not started and 0 independently Verified; not re-audited here |
| Creative CI / ADR-0165–0184 | [CI checklist](selecta-creative-interface-implementation-checklist.md) | Musical objects, exploratory creativity and rigorous evidence | None; earlier ledger describes 140 tasks Not started at its baseline |
| Additional live spectrum / ADR-0185–0197 | [Individual visualizer ADRs](adr-0185-aurora-contours.md) | Thirteen extra spectrum styles now present in source in addition to the two originals | None; code presence is not independent audio or visual acceptance |
| **New Flow SF / ADR-0198–0247** | [New 400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [JSON status](selecta-flow-code-status.json) | New art direction, cross-screen integrity, screens and independent outcomes | **50 Accepted / 263 Implemented, 17 In progress, 70 Not started, 46 Needs a person, 4 Superseded / 0 independently Verified (2026-11-12)** |

## Current-head source findings that must not be erased

- The app is a local-first browser UI and server with a persistent player. Login, SaaS, subscription, music sync, remote media upload and telemetry are outside the present programme.
- Listen has **15 spectrum visualization styles** with real frequency-bin mappings. ADR-0212 targets *curation, art direction, sensory safety and measured acceptance*, not re-adding the fifteen existing modes.
- User-facing Listen, Make a Mix, Mix editor, Requests, Library, Stem Studio, My Mixes, Workspace, onboarding and FLAC export are source-present. New ADRs can propose refinements, but must not call these workflows missing without a fresh reproduced finding.
- Screenshot E2E emits review candidates, not independently approved golden images. Synthetic muted browser automation does not prove real handoff sound quality, no audible dropout or a screen-reader user's success.

## Reconciliation before changing a task state

1. Pin exact implementation branch and source SHA. Compare the new SF task acceptance with current source, specific tests and older ADR/task implementations; record the *precise delta*.
2. When existing source already meets an SF requirement, attach code/test lines and evidence; seek owner acceptance and status update before declaring Implemented. If an SF task is redundant, revise/supersede it rather than fabricating additional work.
3. “Implemented” requires a matching code artifact and passing relevant regression on a particular SHA. Independent “Verified Yes” requires reviewer name/date and device, theme, accessibility, real audio, and performance evidence as applicable.
4. Do not edit, tally into, or silently reinterpret the T/P/S3/S31/S4/EX/MI/CI historical statuses. The denominators represent different programmes and baselines and must not be summed as unique missing work.
5. Release gate is **NO-GO for the proposed redesign programme** until its tasks and independent criteria are accepted; this says nothing categorical about the safety of the currently shipped product.

[Roadmap](selecta-flow-roadmap.md) · [400-task ledger](selecta-flow-implementation-checklist.md) · [Verification matrix](selecta-flow-verification-matrix.md) · [Release gates](selecta-flow-release-gates.md).
