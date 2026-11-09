# Selecta - LX historical status and source reconciliation

**Status:** 26 Proposed ADRs (0340–0365); 208 LX tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owner unassigned. Baseline `main` `da942863e9f57e45653cfc2fda35fe463477b8be` (2026-11-08). Documentation only.

The historical Library and UI decisions (including SF/CI/MI/GP/FP/MP) and Lucy ADR-0300–0339 retain their own decision, implementation and independent verification histories. This new LX programme does not overwrite those trackers, change accepted decisions, or label preexisting code as missing. PR #39 merged Lucy app files on main; its ADR checklists and source implementation have distinct provenance and must be reconciled item by item, not bulk-promoted.

## Three independent axes

1. **ADR decision:** Proposed → Accepted/Rejected/Superseded only by named owner, dated rationale and design/safety review.
2. **Implementation:** Not started → In progress → Implemented only with a source/test implementing PR, exact SHA, relevant acceptance proof and the precise LX task update.
3. **Independent verification:** No → Yes only with separate reviewer/date/platform/device and real evidence for the specified visual, usability, performance, AT or audio acceptance.

## Required status updates after implementation

Update **all four** representations in one linked PR: (a) each affected ADR's embedded item and counters; (b) the implementation checklist; (c) per-task evidence ledger; (d) machine-readable status JSON. If acceptance depends on already source-present behaviour, record classification and exact later verification before advancing. New LX tasks are acceptance of a new design outcome, not assertions that existing search, music engine, ready-only or chat code is absent.

## Current programme boundary

Only ADR-0340–0365 and linked LX documents were created here. Every new task is **Not started/Not verified**. No existing decision, older implementation ledger or application file is changed by this planning PR.
