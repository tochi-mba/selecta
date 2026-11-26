# ADR-0418 - Cloud intelligent mixing parity

- **Decision:** Proposed (2026-11-12; owner acceptance pending).
- **Implementation:** 4/5 Implemented; 1/5 In progress.
- **Independent verification:** 0/5 Verified.
- **Programme:** Autopilot and UX integration (AV), on PR #56.
- **Owner / implementing SHA:** Unassigned / none.
- **Related authority:** Local experience ADR-0114 and ADR-0389; Cloud ADR-0391 through ADR-0416; see [overlap map](selecta-autopilot-feature-parity.md).

## Context and evidence boundary

This proposal extends the current product without removing existing capabilities. Source observations and usability concerns are not automatically confirmed bugs, completed implementation or live venue proof.

## Decision

Extend Cloud library/device playback to genuine planned and rendered mixes without replacing the local engine or pretending plain library sequencing is DJ mixing.

## Non-negotiable constraints

- Preserve existing Local, Cloud, Room, guest, admin and advanced creative features. No original song is modified. Current/draft/revision and directed seam identities, consented atomic request bridges, explicit Pause and one audio authority remain intact.
- Retain all fifteen visualizers, eight Studio lanes, exports, Lucy, editable mixes, discovery, billing, resumable uploads, guest moderation, devices and local account-free privacy.
- New runtime and venue functionality uses feature flags, compatible adapters and proven non-destructive rollback. Never assert an unimplemented future capability is currently offered.
- Human audio, UX, accessibility and commercial rights checks are distinct from passing automated tests.

## Tradeoffs

An additive integration creates more compatibility work than replacing existing paths but avoids destroying valuable user capabilities. Do not deprecate a previous interface merely because the future design looks simpler; improve it while keeping the full feature set accessible.

## Implementation checklist

- [ ] **AV-0418-01 - Map local versus Cloud capabilities.** Acceptance: Map local versus Cloud capabilities; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: c52a5e85, 31019650. Evidence: docs/engineering/cloud-device-features.md (music on the device against Desktop); docs/engineering/cloud-library-walkthrough.md section 2 (the cloud library against Desktop).
- [ ] **AV-0418-02 - Share immutable mix contracts.** Acceptance: share immutable mix contracts; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: 3728c9d4. Evidence: a Cloud account's mixes and drafts are kept in the Desktop's own form and answer the Desktop's mix routes (`cloud.account_mixes`, docs/engineering/engine-store-mixes.md).
- [ ] **AV-0418-03 - Implement real Cloud mix creation.** Acceptance: implement real Cloud mix creation; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: 31019650, 3728c9d4. Evidence: server mixes of uploaded songs planned and rendered on the cloud studio (`cloud.hosted_render`); the account's planner makes mixes for music on the device (`cloud.brain`).
- [ ] **AV-0418-04 - Expose gated creation and editing.** Acceptance: expose gated creation and editing; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: Implemented. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: 31019650, 3728c9d4. Evidence: creation and editing behind `cloud.hosted_render`, `cloud.brain` and `cloud.account_mixes`, each off returning the page to what it was.
- [ ] **AV-0418-05 - Verify existing Local and Cloud paths.** Acceptance: verify existing Local and Cloud paths; existing features and media identities in scope remain intact. Required verification: focused source tests, relevant real-audio/browser/device or human checks and rollback evidence. Implementation: In progress. Independently verified: No. Owner: Unassigned. Implementing PR/SHA: 525076ed. Evidence: the Desktop suite runs in CI with the engine store forced on; the owner's listening stops for the Cloud paths are still to come (ADR-0479).

## Governance

The task lines begin Not started and the ADR begins Proposed. Separate source implementation, owner acceptance and independent verification; update [checklist](selecta-autopilot-implementation-checklist.md) and [evidence ledger](selecta-autopilot-implementation-evidence.md) when proof exists. Nothing here supersedes an older accepted ADR.
