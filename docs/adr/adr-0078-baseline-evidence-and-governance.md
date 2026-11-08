# ADR-0078: Reconcile the shipped 3.0 baseline and govern finishing work

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress on PR #25 (selected sub-tasks only; none Verified)
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 0 - evidence baseline
- **Extends:** ADR-0047, ADR-0074, ADR-0075, ADR-0076. No inherited task is automatically complete.
- **Dependencies:** None; finish before aesthetic or interaction changes.
- **Checklist:** S31-0078-01 through S31-0078-10 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `docs/adr/selecta-3-evidence.md`, `docs/adr/selecta-3-implementation-checklist.md`, `docs/adr/selecta-3-parity-matrix.md`, `web/e2e/*`, `web/src/views/*`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Use one evidence-backed finishing backlog tied to the actual merged 3.0 head. Existing S3 tasks are inherited requirements, never silently counted as completed. Capture the real browser experience before deciding that something needs redesign.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0078-01 - Pin baseline to actual 3.0 merge and current release head.** Acceptance: Evidence record names commit, environment, browser, installed/PWA assumptions and support boundary.
2. **S31-0078-02 - Reconcile the 258 inherited S3 IDs with merged code and CI.** Acceptance: Every S3 ID maps to code/PR/tests or remains unresolved; no unchecked legacy item is silently marked done.
3. **S31-0078-03 - Inventory every destination, subview, overlay and always-on surface.** Acceptance: One route/surface map includes Listen, Explore, My Mixes, Edit, Library, Workspace, requests, Stage, Studio, Activity and edge screens.
4. **S31-0078-04 - Build the state coverage matrix for each surface.** Acceptance: Initial, partial, empty, background refresh, stale, failed, offline and recovered states are recorded or explicitly N/A.
5. **S31-0078-05 - Capture deterministic light/dark screenshots of the real built app.** Acceptance: Fixture, viewport, theme, browser, font, state and asset license are recorded; no captured private music metadata.
6. **S31-0078-06 - Run baseline core-task scripts without coaching participants.** Acceptance: Observed completion, hesitation, errors and recovery are separated from hypotheses; no fabricated success rates.
7. **S31-0078-07 - Create a risk-ranked finding record.** Acceptance: Every finding has repro, affected user, severity P0/P1/P2, owner, acceptance test and old/new ADR link.
8. **S31-0078-08 - Define non-regression comparisons against current behaviour.** Acceptance: Each proposed polish change specifies expected playback, persisted data, route and UI state unchanged.
9. **S31-0078-09 - Record decision, implementation and verification status independently.** Acceptance: Proposed/Accepted decision and Not started/In progress/Implemented/Verified are not conflated.
10. **S31-0078-10 - Approve and freeze the scope and baseline before implementation.** Acceptance: Owner signs decision boundaries and prioritization; no new engine, API or schema work is implied.

## Required adverse cases and evidence

- Merging a PR does not imply every S3 item is Verified.
- A proposed improvement can be a hypothesis rather than an observed failure.
- Fixture screenshots must not expose private song paths, titles or audio.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

A fresh tracker introduces IDs but avoids rewriting the historical S3 tracker, guessing progress, or assuming PR #24's merge verified human outcomes.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now includes limited frontend and component-test changes on selected workstreams. None of the tasks is Implemented or Verified; follow the evidence ledger for exact In-progress IDs.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Selected UI/Edge/test or visual-review infrastructure on draft PR #25; no human acceptance or task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
