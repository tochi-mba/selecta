# ADR-0466 - Playback ownership, takeovers and network partitions

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0415, ADR-0419, ADR-0443, ADR-0446; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/playback/`, `web/src/cloud/CloudTransportDock.tsx`, `web/src/devices/usePlaybackDevice.ts`, `web/src/business/offline/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

A cloud lease does not prove that a new device has music or that a disconnected old speaker can be silenced. Single-owner safety and offline continuity can conflict during partitions.

## Accepted decision

1. Prepare destination media, transitions, output, permissions and engine before changing owner; failure leaves current speaker playing.
2. Execute fenced prepare/stop-confirm/acquire/start transition with unique attempt ID and deadlines. Prevent two tabs or repeated commands from creating duplicate ownership.
3. Business offline designated speaker retains local authority; refuse unsafe takeover while it cannot be fenced or physically isolated. Use an explicit emergency/manual isolation path.
4. On reconnection reject stale generations, reconcile old speaker, report any audible handoff gap honestly; never claim inherently gapless cross-hardware takeover.

## Operational edge cases

Two devices request takeover simultaneously; old device stops and new one crashes; old is partitioned; staff phone emergency output; mix has 5/8 songs locally; Bluetooth output missing.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Keep current speaker leases until preparation and partition tests pass; introduce verified device readiness before UI offers Play Here. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Multi-context E2E and hardware sound tests for partitions, retries, stale generations, crash points, wrong output and no-double-audio. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0466-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of playback ownership, takeovers and network partitions. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0466-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0466-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0466-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
