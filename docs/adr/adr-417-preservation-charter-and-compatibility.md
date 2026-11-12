# ADR-417 - Preservation charter and compatibility

- **Decision:** Proposed (2026-11-12; owner acceptance pending).
- **Implementation:** 0/5 Implemented; 5/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme:** Autopilot and UX integration (AV), on PR #56.
- **Owner / implementing SHA:** Unassigned / none.
- **Related authority:** Local experience ADR-0114 and ADR-0389; Cloud ADR-0391 through ADR-0416; see [overlap map](selecta-autopilot-feature-parity.md).

## Context and evidence boundary

This proposal extends the current product without removing existing capabilities. Source observations and usability concerns are not automatically confirmed bugs, completed implementation or live venue proof.

## Decision

Guard every Local, Cloud, guest, admin and creative feature against removal; no change to original audio bytes, current/draft/revision/song/seam identity, Undo or consent.

## Non-negotiable constraints

- Preserve existing Local, Cloud, Room, guest, admin and advanced creative features. No original song is modified. Current/draft/revision and directed seam identities, consented atomic request bridges, explicit Pause and one audio authority remain intact.
- Retain all fifteen visualizers, eight Studio lanes, exports, Lucy, editable mixes, discovery, billing, resumable uploads, guest moderation, devices and local account-free privacy.
- New runtime and venue functionality uses feature flags, compatible adapters and proven non-destructive rollback. Never assert an unimplemented future capability is currently offered.
- Human audio, UX, accessibility and commercial rights checks are distinct from passing automated tests.

## Tradeoffs

An additive integration creates more compatibility work than replacing existing paths but avoids destroying valuable user capabilities. Do not deprecate a previous interface merely because the future design looks simpler; improve it while keeping the full feature set accessible.

## Implementation checklist

- [ ] **AV-417-01 - Audit route/API/feature inventory.** Acceptance: Audit route/API/feature inventory; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Not started. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: None.
- [ ] **AV-417-02 - Protect local no-account mode.** Acceptance: protect local no-account mode; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Not started. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: None.
- [ ] **AV-417-03 - Preserve all creative controls.** Acceptance: preserve all creative controls; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Not started. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: None.
- [ ] **AV-417-04 - Test migration rollback.** Acceptance: test migration rollback; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Not started. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: None.
- [ ] **AV-417-05 - Independently sign parity.** Acceptance: independently sign parity; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Not started. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: None. Evidence: None.

## Governance

The task lines begin Not started and the ADR begins Proposed. Separate source implementation, owner acceptance and independent verification; update [checklist](selecta-autopilot-implementation-checklist.md) and [evidence ledger](selecta-autopilot-implementation-evidence.md) when proof exists. Nothing here supersedes an older accepted ADR.
