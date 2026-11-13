# ADR-0433 - Venue speakers, leases and zones

> **Local-first architecture supersession (2026-11-13):** Future media ownership, plan/venue execution and UI contracts are governed by ADR-0468 and [the LF parity matrix](selecta-local-first-overlap-and-parity.md). This older decision remains a historical record; past status and evidence are not erased. LF implementation is not started.

- **Decision:** Proposed (2026-11-12; owner acceptance pending).
- **Implementation:** 5/5 Implemented (2 tooling only); 0/5 Not started; 5/5 need a person.
- **Independent verification:** 0/5 Verified.
- **Programme:** Autopilot and UX integration (AV), on PR #56.
- **Owner / implementing SHA:** autopilot-b / PR #56 (uncommitted).
- **Related authority:** Local experience ADR-0114 and ADR-0389; Cloud ADR-0391 through ADR-0416; see [overlap map](selecta-autopilot-feature-parity.md).

## Context and evidence boundary

This proposal extends the current product without removing existing capabilities. Source observations and usability concerns are not automatically confirmed bugs, completed implementation or live venue proof.

## Decision

Keep current one-session-per-account semantics; add explicit venue-zone identities only with entitlement, distinct lease ownership, rights-bounded caches and supported speaker hardware.

## Non-negotiable constraints

- Preserve existing Local, Cloud, Room, guest, admin and advanced creative features. No original song is modified. Current/draft/revision and directed seam identities, consented atomic request bridges, explicit Pause and one audio authority remain intact.
- Retain all fifteen visualizers, eight Studio lanes, exports, Lucy, editable mixes, discovery, billing, resumable uploads, guest moderation, devices and local account-free privacy.
- New runtime and venue functionality uses feature flags, compatible adapters and proven non-destructive rollback. Never assert an unimplemented future capability is currently offered.
- Human audio, UX, accessibility and commercial rights checks are distinct from passing automated tests.

## Tradeoffs

An additive integration creates more compatibility work than replacing existing paths but avoids destroying valuable user capabilities. Do not deprecate a previous interface merely because the future design looks simpler; improve it while keeping the full feature set accessible.

## Implementation checklist

- [ ] **AV-0433-01 - Certify primary speaker platforms.** Acceptance: Certify primary speaker platforms; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented (tooling); Needs a person: run each check on the named primary hardware (Windows Chrome/Edge, Mac) and record results; every platform is 'not certified' until then. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/speaker_platforms.py; tests/test_apb_speakers.py::test_every_platform_starts_not_certified_and_iphone_is_remote_only, test_certification_needs_person_hardware_and_evidence_for_every_check (28 passed 2026-11-13).
- [ ] **AV-0433-02 - Define scoped zones.** Acceptance: define scoped zones; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: staff define zones on real venue devices once the speaker screens are mounted. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/zones.py (venue-scoped zones, entitlement cap default 1, one speaker per zone, one lease per zone, flag venue.speakers); tests/test_apb_speakers.py::test_zones_are_scoped_by_entitlement_and_own_their_speakers, test_zones_need_their_flag (28 passed 2026-11-13).
- [ ] **AV-0433-03 - Test transfer and reconnection.** Acceptance: test transfer and reconnection; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: transfer and reconnect on two real devices (runbook steps 6 and 8). Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/zones.py transfer/drop/reconnect/failover with resume position; tests/test_apb_speakers.py::test_transfer_fences_old_speaker_and_resumes_from_position, test_dropped_speaker_reconnects_and_resumes_where_it_stopped, test_failover_then_returning_speaker_stays_quiet (28 passed 2026-11-13).
- [ ] **AV-0433-04 - Gate offline media rights.** Acceptance: gate offline media rights; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented; Needs a person: legal confirmation of which licences allow offline copies and the 30-day re-check cap. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: src/selecta/venueops/offline_rights.py; tests/test_apb_speakers.py::test_offline_copy_needs_cleared_offline_licence, test_offline_copy_expires_and_withdraws_without_touching_original (28 passed 2026-11-13).
- [ ] **AV-0433-05 - Publish venue soundcheck runbook.** Acceptance: publish venue soundcheck runbook; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented (tooling); Needs a person: venue staff run the runbook at a real venue; the remote speaker screens it names are not mounted yet. Independently verified: No. Owner: autopilot-b. Implementing PR/SHA: PR #56 (uncommitted; coordinator commits). Evidence: docs/autopilot/venue-soundcheck-runbook.md; tests/test_apb_speakers.py::test_soundcheck_runbook_and_soak_protocol_are_published (28 passed 2026-11-13).

## Governance

The task lines begin Not started and the ADR begins Proposed. Separate source implementation, owner acceptance and independent verification; update [checklist](selecta-autopilot-implementation-checklist.md) and [evidence ledger](selecta-autopilot-implementation-evidence.md) when proof exists. Nothing here supersedes an older accepted ADR.
