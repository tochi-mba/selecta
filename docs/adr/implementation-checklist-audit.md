# Repository implementation-checklist audit

**Audit date:** 2026-11-07 (task counts refreshed 2026-11-12)  
**Current implementation PR:** [#56](https://github.com/tochi-mba/selecta/pull/56) on `feat/finish-checklists-2` (it was [#31](https://github.com/tochi-mba/selecta/pull/31) at the 2026-11-07 audit)  
**Rule:** Source implementation, owner decision and independent verification are separate. A merged programme PR proves that its commit reached `main`; it does not by itself prove every task acceptance criterion or any unperformed human/device/audio/performance check.

## Complete checklist inventory

| Programme | Canonical checklist | Stable task scope | Authoritative implementation history | Current interpretation |
|---|---|---|---|---|
| Selecta 2.0 | `implementation-checklist.md` | T0001–T0279 | Historical implementation/evidence on main | On 2026-11-12, 248 of 279 ticked with evidence and 31 open (24 need a person); do not rewrite history from later similar work |
| UI/UX polish | `polish-implementation-checklist.md` | P0001–P0143 | PR #23 merged as `84b8b5cbadf7204bf526e8932124b5c4890e2c44` | The original zero-done planning snapshot is stale as a code-state summary; per-task acceptance and independent evidence remain unreconciled/open |
| Selecta 3.0 | `selecta-3-implementation-checklist.md` | 258 S3 tasks | PR #24 merged as `3b01dc1336aab0f1cb0a4d85be5eba359de81831` | Runtime programme merged; original all-open task register remains a verification ledger, not proof that no code exists |
| Selecta 3.1 | `selecta-3-1-implementation-checklist.md` | S31-0078–0088 | PR #25 merged as `6d78cf420c55817e967fc3b8db45749c9817926e` | Partial source work merged; checkboxes intentionally remain independent-Verified markers |
| Selecta 4.0 | `selecta-4-implementation-checklist.md` | 250 S4 tasks | Planning PRs #27/#28, implementation PR #29 merged as `6638ec2313ce53843adfaf363306f8e79c4c8c7e` | Post-PR-29 runtime exists; original zero-done ledger requires task-specific evidence before status advancement |
| Experience-first | `selecta-experience-implementation-checklist.md` | 105 EX tasks | PR #30 merged as `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` | Runtime programme merged; new acceptance criteria and human verification remain separate |
| Immersive microinteractions | `selecta-microinteraction-implementation-checklist.md` | 240 MI tasks | PR #31 | Live source-level register plus independent verification state; 30 ADR decisions owner-Accepted on 2026-11-07 |
| Selecta Cloud | `selecta-cloud-implementation-checklist.md` | 136 SC tasks (ADR-0391 to ADR-0416) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Creative interface | `selecta-creative-interface-implementation-checklist.md` | 140 CI tasks (ADR-0165 to ADR-0184) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Final polish | `selecta-final-polish-implementation-checklist.md` | 64 FP tasks (ADR-0264 to ADR-0271) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Flow | `selecta-flow-implementation-checklist.md` | 400 SF tasks (ADR-0198 to ADR-0247) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Gap polish | `selecta-gap-polish-implementation-checklist.md` | 128 GP tasks (ADR-0248 to ADR-0263) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Library/Lucy experience | `selecta-library-lucy-experience-implementation-checklist.md` | 208 LX tasks (ADR-0340 to ADR-0365) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Measured micro-polish | `selecta-measured-micro-polish-implementation-checklist.md` | 224 MP tasks (ADR-0272 to ADR-0299) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |
| Unified finish | `selecta-unified-finish-implementation-checklist.md` | 192 UF tasks (ADR-0366 to ADR-0389) | Branch `feat/finish-checklists-2` (PR #56) | Task lines carry their own status; see the counts below |

## Task status on 2026-11-12

Recounted from every checklist's task lines by `src/selecta/audit/checklist_summary.py`. This is a dated snapshot; each checklist's computed line under its title is the live count. Checkbox meaning differs by programme (see reconciliation decision 2), so compare the state columns, not the ticks.

| Programme | Tasks | Implemented | In progress | Not started | Needs a person | Superseded | Ticked | Independently Verified |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Selecta 2.0 (T) | 279 | 251 | 0 | 3 | 24 | 1 | 248 | 0 |
| UI/UX polish (P) | 143 | 115 | 1 | 6 | 20 | 1 | 110 | 0 |
| Selecta 3.1 (S31) | 116 | 96 | 1 | 0 | 19 | 0 | 0 | 0 |
| Selecta 3.0 (S3) | 258 | 227 | 2 | 0 | 29 | 0 | 221 | 0 |
| Selecta 4.0 (S4) | 250 | 202 | 36 | 12 | 0 | 0 | 0 | 0 |
| Selecta Cloud | 136 | 92 | 34 | 10 | 0 | 0 | 91 | 0 |
| Creative interface | 140 | 106 | 1 | 0 | 33 | 0 | 106 | 0 |
| Experience-first (EX) | 105 | 91 | 4 | 7 | 0 | 3 | 51 | 51 |
| Final polish | 64 | 53 | 2 | 9 | 0 | 0 | 0 | 0 |
| Flow | 400 | 263 | 17 | 70 | 46 | 4 | 261 | 0 |
| Gap polish | 128 | 111 | 0 | 17 | 0 | 0 | 111 | 0 |
| Library/Lucy experience | 208 | 179 | 1 | 28 | 0 | 0 | 144 | 0 |
| Measured micro-polish | 224 | 194 | 11 | 19 | 0 | 0 | 194 | 0 |
| Immersive microinteractions (MI) | 240 | 213 | 3 | 24 | 0 | 0 | 213 | 0 |
| Unified finish | 192 | 169 | 6 | 17 | 0 | 0 | 108 | 0 |
| **All programmes** | **2883** | **2362** | **119** | **222** | **171** | **9** | **1858** | **51** |

## Reconciliation decisions

1. Later programmes are additive; similarly worded tasks do not silently complete older IDs.
2. Historical checkboxes keep their documented meaning. T and MI checkboxes represent source/evidence implementation; S31/S4/EX checkboxes represent independent verification. P/S3 instructions require their own linked evidence.
3. Merged PR state is now corrected in each programme header/evidence summary. This removes stale “PR open/not merged” claims without fabricating per-task completion.
4. Current runtime sources and tests may be cited by multiple programmes only where each task's exact acceptance is independently mapped.
5. Human listening, named visual review, NVDA/physical-device work, participant studies, performance traces and final release sign-off stay open until recorded against an exact SHA.

## Code-verifiable cross-programme evidence

The current main/PR #31 lineage contains concrete implementations for persistent playback, route aliases/history, readiness taxonomy, drafts/current isolation, guarded mutations, Studio state recovery, Library cursor paging, export jobs, request consent, focus-managed overlays, reduced motion and rollback/scale harnesses. The live MI ledger maps the active source work task by task. Older programmes retain their separate acceptance ledgers because their wording, baselines and checkbox contracts differ.

Authoritative shared evidence includes:

- `web/src/router.ts`, `web/src/shell/manifest.ts`, `web/src/App.tsx` - canonical navigation, history and persistent playback.
- `web/src/state/readiness.ts`, `web/src/views/Library.tsx` - non-conflated readiness, stable identity and bounded large-library behavior.
- `web/src/views/Drafts.tsx`, `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx` - current/draft isolation, stable revisions and accessible editing.
- `web/src/audio/focus.ts`, `web/src/player.ts`, `web/src/studio.ts` - single audio ownership and scheduling.
- `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx` - frozen, persistent export jobs and truthful artifacts.
- `tests/scale_server.py`, `tests/rollback_check.py`, `tests/check_export_audio.py` - repeatable scale, preservation and decoded-audio harnesses; actual candidate results remain evidence to be produced at the test/verification stage.

## Remaining boundary

Unchecked historical tasks are not all missing code. They are a mixture of distinct acceptance work, stale reconciliation, owner/human approval and real-world verification. This audit intentionally does not bulk-check them. Each source-verifiable advancement must name the exact behavior and source; each independent verification must name its reviewer/environment/result.

