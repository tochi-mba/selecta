# ADR-0473 - Rooms and guest requests resolved against the speaker device

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0416, ADR-0422, ADR-0431, ADR-0451; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/rooms/`, `web/src/rooms/`, `web/src/guest/`, `src/selecta/requests.py`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

A guest should be shown requestable catalogue entries actually eligible for the assigned zone, not a cloud media catalogue the speaker cannot play.

## Accepted decision

1. Guest room catalogue exposes minimal permitted metadata from zone policy and fresh local availability; no audio URLs, privileged staff data or internal file paths.
2. Request lifecycle distinguishes requested, moderated, accepted by host, locally scheduled, prepared, played, rejected, withdrawn and expired.
3. Cloud acceptance is not evidence of local scheduling. Local request planner checks eligible media, bridges, current sequence and committed transition window.
4. Offline hosts reject or defer new cloud guest requests; never falsely claim played or silently insert a blocked explicit recording.

## Operational edge cases

Same song requested twice, stale local availability, guest in Wi-Fi outage, room code rotated, blocked artist, host changes venue zone.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Keep request and moderation semantics while migrating catalogue source and local planner acknowledgement. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

500-guest flood, moderation, multiple requests, stale mapping, permission and no-audio route tests. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0473-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of rooms and guest requests resolved against the speaker device. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0473-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0473-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0473-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
