# Repository implementation-checklist audit

**Audit date:** 2026-11-07  
**Current implementation PR:** [#31](https://github.com/tochi-mba/selecta/pull/31)  
**Rule:** Source implementation, owner decision and independent verification are separate. A merged programme PR proves that its commit reached `main`; it does not by itself prove every task acceptance criterion or any unperformed human/device/audio/performance check.

## Complete checklist inventory

| Programme | Canonical checklist | Stable task scope | Authoritative implementation history | Current interpretation |
|---|---|---|---|---|
| Selecta 2.0 | `implementation-checklist.md` | T0001–T0279 | Historical implementation/evidence on main | Preserve 178 checked source/evidence items and 101 explicitly open acceptance/human gates; do not rewrite history from later similar work |
| UI/UX polish | `polish-implementation-checklist.md` | P0001–P0143 | PR #23 merged as `84b8b5cbadf7204bf526e8932124b5c4890e2c44` | The original zero-done planning snapshot is stale as a code-state summary; per-task acceptance and independent evidence remain unreconciled/open |
| Selecta 3.0 | `selecta-3-implementation-checklist.md` | 258 S3 tasks | PR #24 merged as `3b01dc1336aab0f1cb0a4d85be5eba359de81831` | Runtime programme merged; original all-open task register remains a verification ledger, not proof that no code exists |
| Selecta 3.1 | `selecta-3-1-implementation-checklist.md` | S31-0078–0088 | PR #25 merged as `6d78cf420c55817e967fc3b8db45749c9817926e` | Partial source work merged; checkboxes intentionally remain independent-Verified markers |
| Selecta 4.0 | `selecta-4-implementation-checklist.md` | 250 S4 tasks | Planning PRs #27/#28, implementation PR #29 merged as `6638ec2313ce53843adfaf363306f8e79c4c8c7e` | Post-PR-29 runtime exists; original zero-done ledger requires task-specific evidence before status advancement |
| Experience-first | `selecta-experience-implementation-checklist.md` | 105 EX tasks | PR #30 merged as `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` | Runtime programme merged; new acceptance criteria and human verification remain separate |
| Immersive microinteractions | `selecta-microinteraction-implementation-checklist.md` | 240 MI tasks | PR #31 | Live source-level register plus independent verification state; 30 ADR decisions owner-Accepted on 2026-11-07 |

## Reconciliation decisions

1. Later programmes are additive; similarly worded tasks do not silently complete older IDs.
2. Historical checkboxes keep their documented meaning. T and MI checkboxes represent source/evidence implementation; S31/S4/EX checkboxes represent independent verification. P/S3 instructions require their own linked evidence.
3. Merged PR state is now corrected in each programme header/evidence summary. This removes stale “PR open/not merged” claims without fabricating per-task completion.
4. Current runtime sources and tests may be cited by multiple programmes only where each task's exact acceptance is independently mapped.
5. Human listening, named visual review, NVDA/physical-device work, participant studies, performance traces and final release sign-off stay open until recorded against an exact SHA.

## Code-verifiable cross-programme evidence

The current main/PR #31 lineage contains concrete implementations for persistent playback, route aliases/history, readiness taxonomy, drafts/current isolation, guarded mutations, Studio state recovery, Library cursor paging, export jobs, request consent, focus-managed overlays, reduced motion and rollback/scale harnesses. The live MI ledger maps the active source work task by task. Older programmes retain their separate acceptance ledgers because their wording, baselines and checkbox contracts differ.

Authoritative shared evidence includes:

- `web/src/router.ts`, `web/src/shell/manifest.ts`, `web/src/App.tsx` — canonical navigation, history and persistent playback.
- `web/src/state/readiness.ts`, `web/src/views/Library.tsx` — non-conflated readiness, stable identity and bounded large-library behavior.
- `web/src/views/Drafts.tsx`, `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx` — current/draft isolation, stable revisions and accessible editing.
- `web/src/audio/focus.ts`, `web/src/player.ts`, `web/src/studio.ts` — single audio ownership and scheduling.
- `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx` — frozen, persistent export jobs and truthful artifacts.
- `tests/scale_server.py`, `tests/rollback_check.py`, `tests/check_export_audio.py` — repeatable scale, preservation and decoded-audio harnesses; actual candidate results remain evidence to be produced at the test/verification stage.

## Remaining boundary

Unchecked historical tasks are not all missing code. They are a mixture of distinct acceptance work, stale reconciliation, owner/human approval and real-world verification. This audit intentionally does not bulk-check them. Each source-verifiable advancement must name the exact behavior and source; each independent verification must name its reviewer/environment/result.

