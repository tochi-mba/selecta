# ADR-0247 - Implementation-status integrity and independent GO/NO-GO governance

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Delivery.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0184/0164/0030; historical statuses remain unmodified.
- **Existing source touchpoints:** docs/adr/README.md; docs/acceptance.md; web/playwright.config.ts.

## Context and evidence boundary

Every programme task independently tracks design acceptance, implemented code and verification. New programme status should not be summed with past ledgers or used to declare the current working product broken. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Every programme task independently tracks design acceptance, implemented code and verification. New programme status should not be summed with past ledgers or used to declare the current working product broken. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No self-verified release, unsupported green CI equivalence, historical status rewrite or premature GO. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 7/8 Implemented, 0/8 Verified

1. **SF-0247-01 - Define decision state transitions.** **Acceptance:** Proposed, Accepted, Rejected, Superseded documented with dates. **Required verification:** ADR governance audit. **Implementation:** Implemented; every Flow ADR records its decision state with a date, and the policy defines Proposed, Accepted, Rejected and Superseded with date and rationale; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/selecta-flow-implementation-checklist.md` Status update policy; `tests/test_flow_cross_cutting.py` 'test_every_flow_adr_records_a_dated_decision_and_counted_implementation' (passed 2026-11-10).
2. **SF-0247-02 - Define implementation state transitions.** **Acceptance:** Not started/In progress/Implemented require source evidence. **Required verification:** Ledger check. **Implementation:** Implemented; Not started, In progress and Implemented are the only implementation states, and a ticked task without evidence fails the audit; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `src/selecta/audit/checklist_evidence.py`; `tests/test_checklist_evidence.py`; `tests/test_flow_cross_cutting.py` 'test_every_flow_adr_records_a_dated_decision_and_counted_implementation'; passed 2026-11-10.
3. **SF-0247-03 - Define independent verification.** **Acceptance:** Reviewer, environment, media and SHA traceable. **Required verification:** Evidence template audit. **Implementation:** Implemented; the evidence ledger keeps reviewer apart from implementer, and each release slice needs reviewer, date, exact SHA, OS, browser, device and real-audio result; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/selecta-flow-implementation-evidence.md` (Independently Verified and reviewer columns); `docs/adr/selecta-flow-release-gates.md` Evidence needed item 3; `docs/research/flow-research-protocol.md` Reproducible findings.
4. **SF-0247-04 - Set P0/P1/P2 rules.** **Acceptance:** Audio/data/privacy/access failures block release. **Required verification:** Failure triage review. **Implementation:** Implemented; P0 blocks release for audio, data, privacy and access failures; P1 needs a documented disposition; P2 is cosmetic; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/selecta-flow-release-gates.md` Blocking severity; `tests/test_flow_cross_cutting.py` 'test_release_gates_block_audio_data_privacy_and_access_failures' (passed 2026-11-10).
5. **SF-0247-05 - Require full parity checks.** **Acceptance:** Every core feature maps to source and tested journey. **Required verification:** Feature parity matrix. **Implementation:** Implemented; every capability in the feature parity matrix names its source and an end-to-end journey, and each named journey is checked to exist in its spec; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Feature parity: each capability's tested journey; `docs/adr/selecta-flow-feature-parity.md`; `tests/test_flow_cross_cutting.py` 'test_every_parity_capability_has_a_tested_journey_that_exists' (passed 2026-11-11).
6. **SF-0247-06 - Define visual sign-off protocol.** **Acceptance:** Candidate images separate from approved baselines. **Required verification:** Reviewer approval record. **Implementation:** Implemented; screens from test runs are candidates; only a named reviewer with date, device and SHA approves one, and only the Verified field changes; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/adr-0199-historical-status-reconciliation.md` Screen review protocol; `docs/adr/completion/visual-evidence.md`.
7. **SF-0247-07 - Prove safe rollback.** **Acceptance:** Old/current/new state preserved without migration loss. **Required verification:** Rollback E2E. **Implementation:** Implemented; old, current and new state are preserved without migration loss: the current build saves drafts, mix settings, a correction, requests, ratings and an export record; the Flow baseline build reads them unchanged; the current build reads them again unchanged; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `tests/rollback_check.py` against `git archive c3715b14 src`: 'identical across all three', exit 0, 2026-11-11; `web/src/state/prefsRollback.test.ts`; `tests/test_flow_release_safety.py` (2 passed 2026-11-11).
8. **SF-0247-08 - Publish final release verdict.** **Acceptance:** No GO without signed exact-SHA gate and music evaluation. **Required verification:** Independent release report. **Implementation:** Not started; Needs a person: an independent release report and signed exact-SHA GO/NO-GO with music evaluation; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0184/0164/0030; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 7/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
