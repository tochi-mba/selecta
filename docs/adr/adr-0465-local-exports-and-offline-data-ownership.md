# ADR-0465 - Local exports and offline data ownership

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0127, ADR-0399, ADR-0412; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/routes/exports.py`, `src/selecta/routes/cloud_export.py`, `web/src/views/`, `web/src/cloud/AccountData.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

A device can create a fully validated export without providing a cloud download URL; account data export must not claim to include locally held music.

## Accepted decision

1. Keep local FLAC rendering, frozen revisions, progress, validation, cancellation and user-controlled destination; preserve export formats and creative workflows.
2. Cloud metadata may record a completed export on a named authorised device with non-sensitive status, never the file bytes, raw path or signed media URL.
3. Account archive exports include cloud recipes, preferences and relevant metadata; local data export is a separate operation that runs on the owning device.
4. Removing an account, disconnecting a folder or clearing cache must not delete source recordings or user-selected exports.

## Operational edge cases

An export finishes after cloud sign-out; destination filesystem is read-only; export dies during rename; same recipe is exported from two devices; cloud archive restored without media files.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Keep existing local exports; replace cloud data ZIP's audio inclusion only after hosted-audio migration closes. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

FLAC checks, interrupted writes, deletion boundary, no remote download, privacy copy and device-inaccessible UX. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0465-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of local exports and offline data ownership. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0465-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0465-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0465-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
