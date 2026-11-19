# ADR-0440 - Phased rollout and independent GO NO-GO

- **Decision:** Proposed (2026-11-12; owner acceptance pending).
- **Implementation:** 4/5 Implemented; 1/5 In progress (AV-0440-05: the signed release decision is the owner's).
- **Independent verification:** 0/5 Verified.
- **Programme:** Autopilot and UX integration (AV), on PR #56.
- **Owner / implementing SHA:** Unassigned / branch `feat/finish-unwired-work` (uncommitted at audit, 2026-11-19).
- **Related authority:** Local experience ADR-0114 and ADR-0389; Cloud ADR-0391 through ADR-0416; see [overlap map](selecta-autopilot-feature-parity.md).

## Context and evidence boundary

This proposal extends the current product without removing existing capabilities. Source observations and usability concerns are not automatically confirmed bugs, completed implementation or live venue proof.

## Decision

Sequence preservation, Cloud correctness, autonomous musical core, supported speaker, legal clearance and pilots through reversible feature flags with separately signed evidence.

## Non-negotiable constraints

- Preserve existing Local, Cloud, Room, guest, admin and advanced creative features. No original song is modified. Current/draft/revision and directed seam identities, consented atomic request bridges, explicit Pause and one audio authority remain intact.
- Retain all fifteen visualizers, eight Studio lanes, exports, Lucy, editable mixes, discovery, billing, resumable uploads, guest moderation, devices and local account-free privacy.
- New runtime and venue functionality uses feature flags, compatible adapters and proven non-destructive rollback. Never assert an unimplemented future capability is currently offered.
- Human audio, UX, accessibility and commercial rights checks are distinct from passing automated tests.

## Tradeoffs

An additive integration creates more compatibility work than replacing existing paths but avoids destroying valuable user capabilities. Do not deprecate a previous interface merely because the future design looks simpler; improve it while keeping the full feature set accessible.

## Implementation checklist

- [ ] **AV-0440-01 - Approve dependency order.** Acceptance: Approve dependency order; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. `src/selecta/venueops/rollout.py` `PHASES` and `order_problems()` hold the roadmap order as data (no cycles, every ADR once, only real flags, no backward flag needs); the SelectaDJ for Business phases B0 to B3 are `src/selecta/business/rollout.py` `PHASES`. Owner approval of the order is still the owner's. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: `uv run pytest tests/test_apb_rollout.py tests/test_business_rollout.py -q` (24 and 29 passed, 2026-11-19).
- [ ] **AV-0440-02 - Keep honest task status.** Acceptance: keep honest task status; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. `honest_status_problems()` fails a ticked line without evidence, a ticked Not started line and a Verified claim without a named independent reviewer; the business gate register refuses a PASS recorded by an agent (`business.rollout.parse_register`). Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: `tests/test_apb_rollout.py`, `tests/test_business_rollout.py::test_an_agent_can_never_pass_a_gate`.
- [ ] **AV-0440-03 - Test flag-off rollback.** Acceptance: test flag-off rollback; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. `rollback_flags()` and `ROLLBACK_SPEC` build the app with every `venue.*` and `autopilot.*` flag off and on and prove existing routes and flags unchanged; business features ship dark behind `business.*` and the selling switch is guarded (BZ-0441-09). A rollback drill on staging is an owner item. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: `tests/test_apb_rollout.py::test_turning_every_venue_flag_off_leaves_existing_features_unchanged`.
- [ ] **AV-0440-04 - Enforce P0 no-go gates.** Acceptance: enforce P0 no-go gates; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. `decide()` returns NO-GO with every P0 reason or ELIGIBLE FOR SIGNED GO, never GO; the business gates (Gate P, Gate S) use the same rule in `business.rollout.decide`, and the Flags page refuses opening `business.signups` beyond named pilots until Gate S is eligible and signed. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: `tests/test_apb_rollout.py`, `tests/test_business_rollout.py`.
- [ ] **AV-0440-05 - Obtain signed release decision.** Acceptance: obtain signed release decision; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: In progress. The records exist: docs/autopilot/go-no-go-record.md (Autopilot) and docs/verification/bz-go-no-go-record.md (Business), both templates the code can read but never fill; the signed decision itself needs a person: the owner and an independent reviewer sign it. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: `tests/test_apb_rollout.py::test_the_go_no_go_record_template_needs_signatures`.

## Governance

The task lines begin Not started and the ADR begins Proposed. Separate source implementation, owner acceptance and independent verification; update [checklist](selecta-autopilot-implementation-checklist.md) and [evidence ledger](selecta-autopilot-implementation-evidence.md) when proof exists. Nothing here supersedes an older accepted ADR.
