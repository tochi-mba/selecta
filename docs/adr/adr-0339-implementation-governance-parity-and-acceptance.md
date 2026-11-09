# ADR-0339 - Lucy ADR ownership, status/evidence governance and independent release acceptance

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Governance. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0199, ADR-0239, ADR-0240, ADR-0241, ADR-0247, ADR-0271, ADR-0299; unchanged.
- **Source touchpoints:** `docs/adr/README.md`; `docs/adr/selecta-flow-roadmap.md`; `docs/adr/selecta-measured-micro-polish-roadmap.md`.

## Context and evidence boundary

Selecta tracks design decisions, implementation tasks and independent verification separately, with previous programmes and accepted UI parity preserved. New Lucy docs cannot claim 320 missing features or mark existing work implemented. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Own new LU tasks and their decision status only; map overlaps with existing ADR owners, provide per-task status and evidence ledger, source/test PR links, verification matrix, release gates and explicit no-code baseline. Future task changes require exact evidence and owner review.

## UI/UX and measurable acceptance contract

Reviewers can locate every Lucy tool/UI/mobile/ready-only contract, see status counters, identify unresolved risks and independently verify real user journeys without conflating proposal, source implementation or listening success.

**Required negative cases:** Wrong baseline or numbering, task IDs duplicated, documentation implementation claimed, older ADR overwritten, checked box without SHA, synthetic evidence treated as human proof, release without privacy consent.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-339-01 - Publish canonical ADR index.** **Acceptance:** 40 numbered Lucy decisions link to phase, source and related owners. **Required verification:** Link/index lint. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-339-02 - Publish complete 320-task checklist.** **Acceptance:** Each LU task has one ID, acceptance, verification and independent status. **Required verification:** Automated ID/count audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-339-03 - Publish per-task evidence ledger.** **Acceptance:** Every task has owner, source PR/SHA, test/evidence, reviewer/date/platform fields. **Required verification:** Blank-state consistency test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-339-04 - Publish machine-readable status.** **Acceptance:** JSON matches ADR/checklist Not started counts and decision status. **Required verification:** JSON schema/status reconciliation. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-339-05 - Publish old-programme parity.** **Acceptance:** No current capability or prior accepted implementation silently reclassified. **Required verification:** Source/ADR crosswalk review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-339-06 - Publish full quality matrix.** **Acceptance:** Security, ready-only, agent, mobile, real audio and accessibility tests assigned. **Required verification:** Risk-to-test coverage audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-339-07 - Define independent release gates.** **Acceptance:** No-P0, real audio, UI/AT, privacy, exact write and rollback proof required. **Required verification:** Named GO/NO-GO dry run. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-339-08 - Record owner decision lifecycle.** **Acceptance:** Proposed→Accepted/Rejected/Superseded dated with rationale before implementation. **Required verification:** Reviewer/ledger status governance audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Accepted and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
