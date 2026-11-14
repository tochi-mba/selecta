# ADR-0469 - Control-plane commands and offline synchronization protocol

> **Controlling browser-first update — 2026-11-14:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes any mandatory Python/FFmpeg installer, native agent, separate venue computer, or guaranteed background/reboot browser playback in this historical decision. **Cloud runs DSP and plays locally in the supported browser** (including a venue's sole Android tablet or iPad; capable phones also render). Standalone Python Selecta remains independent. [Device/DSP feasibility](selecta-browser-device-capability-matrix.md) · [Full product/repository plan](selecta-browser-first-master-plan.md). Implementation status counts below are an older snapshot and do not certify browser parity; tests and real-device verification remain required.


- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0407, ADR-0415, ADR-0417, ADR-0446; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/playback/commands.py`, `src/selecta/work/outbox.py`, `web/src/cloud/events.ts`, `web/src/business/offline/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

Separate cloud authority and local execution require an explicit data ownership and consistency model.

## Accepted decision

1. Every browser Cloud command has actor, workspace, zone, target browser session, operation, expected revision/generation, TTL, idempotency key and version; metadata Cloud authority does not imply physical audio authority.
2. The active browser acknowledges applied operations only after its local Web Audio/source checks; if hidden, killed, sleeping, output-lost or unreachable it becomes uncertain, interrupted or rejected.
3. Browser local outbox/checkpoints survive only according to actual IndexedDB/OPFS durability and active execution; Service Workers are not guaranteed audio engines.
4. Expire transport commands rather than replaying them after mobile OS suspension; preserve immutable recipe/settings edits and explicit conflict resolution.
5. Controller-only phones have no file privileges over an iPad/Android speaker; phones with own recordings may independently be players and renderers.

## Operational edge cases

Duplicate deliveries, reorder, lost ack, 10k-device reconnect storm, restored Postgres backup, split-brain owner, offline recipe edits, clock skew.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Dual-read/dual-write only for specific validated metadata; keep old clients behind capability negotiation until versioned protocol roll-out passes. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Network fault-injection, exact-once effects by idempotency, stale commands, restored backup, order, 30-day offline and tenant isolation. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0469-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of control-plane commands and offline synchronization protocol. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0469-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0469-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0469-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
