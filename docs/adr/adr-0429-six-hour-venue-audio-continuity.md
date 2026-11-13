# ADR-0429 - Six-hour venue audio continuity

- **Decision:** Proposed (2026-11-12; owner acceptance pending).
- **Implementation:** 5/5 Implemented (1 tooling only); 0/5 Not started; 5/5 need a person.
- **Independent verification:** 0/5 Verified.
- **Programme:** Autopilot and UX integration (AV), on PR #56.
- **Owner / implementing SHA:** autopilot-b / PR #56 (uncommitted).
- **Related authority:** Local experience ADR-0114 and ADR-0389; Cloud ADR-0391 through ADR-0416; see [overlap map](selecta-autopilot-feature-parity.md).

## Context and evidence boundary

This proposal extends the current product without removing existing capabilities. Source observations and usability concerns are not automatically confirmed bugs, completed implementation or live venue proof.

## Decision

Require a dedicated long-lived speaker owner, pre-buffered authorized successors, idempotent controls, fenced leases, safe fallback and real six-hour endurance evidence.

## Non-negotiable constraints

- Preserve existing Local, Cloud, Room, guest, admin and advanced creative features. No original song is modified. Current/draft/revision and directed seam identities, consented atomic request bridges, explicit Pause and one audio authority remain intact.
- Retain all fifteen visualizers, eight Studio lanes, exports, Lucy, editable mixes, discovery, billing, resumable uploads, guest moderation, devices and local account-free privacy.
- New runtime and venue functionality uses feature flags, compatible adapters and proven non-destructive rollback. Never assert an unimplemented future capability is currently offered.
- Human audio, UX, accessibility and commercial rights checks are distinct from passing automated tests.

## Tradeoffs

An additive integration creates more compatibility work than replacing existing paths but avoids destroying valuable user capabilities. Do not deprecate a previous interface merely because the future design looks simpler; improve it while keeping the full feature set accessible.

## Implementation checklist

- [ ] **AV-0429-01 - Define gap and duplicate SLOs.** Acceptance: Define gap and duplicate SLOs; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: measure the targets against a real venue night log and loopback recording (docs/autopilot/six-hour-soak-protocol.md). Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/continuity.py (seven numeric SLOs, evaluator for gaps, overlaps, duplicates); tests/test_apb_continuity.py::test_slos_have_numeric_targets_and_units, test_clean_timeline_with_planned_blends_passes, test_evaluator_reports_gaps_overlaps_and_duplicates, test_blend_longer_than_planned_counts_as_overlap_and_tiny_gap_does_not, test_booked_zone_with_no_plays_is_one_long_gap (28 passed 2026-11-13).
- [ ] **AV-0429-02 - Prefetch playable fallbacks.** Acceptance: prefetch playable fallbacks; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: real-audio check that prefetched fallbacks play cleanly on venue hardware. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/fallback_cache.py (rights, render, analysis, audio-header and hash checks, read-only, no-repeat window, flag venue.continuity); tests/test_apb_continuity.py::test_prefetch_counts_only_verified_playable_songs, test_take_reverifies_never_mutates_and_never_repeats, test_fallback_cache_needs_its_flag (28 passed 2026-11-13).
- [ ] **AV-0429-03 - Enforce speaker leases.** Acceptance: enforce speaker leases; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: two real speaker devices showing no echo on transfer (runbook step 6). Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/leases.py (monotonic fencing tokens, expiry, renewal, takeover, restore); tests/test_apb_continuity.py::test_lease_tokens_only_go_up_and_takeover_fences_old_holder, test_lease_expires_without_renewal_and_is_not_revived, test_only_one_fenced_speaker_plays_and_restore_keeps_counting (28 passed 2026-11-13).
- [ ] **AV-0429-04 - Inject network/model/render faults.** Acceptance: inject network/model/render faults; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: rehearse real network pulls on venue hardware (soak protocol fault steps). Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/faults.py (seeded network/model/render/speaker-drop schedule behind venue.fault_injection, simulated six-hour night checked against the SLOs); tests/test_apb_continuity.py::test_fault_schedule_is_deterministic_and_flag_gated, test_six_hour_simulated_night_meets_every_slo_through_faults, test_seeded_rehearsals_pass, test_without_fallbacks_the_same_faults_fail_the_targets (28 passed 2026-11-13).
- [ ] **AV-0429-05 - Run named-hardware six-hour soak.** Acceptance: run named-hardware six-hour soak; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented (tooling); Needs a person: run docs/autopilot/six-hour-soak-protocol.md for six hours on named hardware and record the evidence table. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: docs/autopilot/six-hour-soak-protocol.md; src/selecta/venueops/faults.py simulated soak; tests/test_apb_continuity.py::test_six_hour_simulated_night_meets_every_slo_through_faults; tests/test_apb_speakers.py::test_soundcheck_runbook_and_soak_protocol_are_published (28 passed 2026-11-13).

## Governance

The task lines begin Not started and the ADR begins Proposed. Separate source implementation, owner acceptance and independent verification; update [checklist](selecta-autopilot-implementation-checklist.md) and [evidence ledger](selecta-autopilot-implementation-evidence.md) when proof exists. Nothing here supersedes an older accepted ADR.
