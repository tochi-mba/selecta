# ADR-0474 - Venue catalogues, lawful local provisioning and rights

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0442, ADR-0449, ADR-0450, ADR-0453; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/business/crates.py`, `src/selecta/business/licensing.py`, `src/selecta/business/content/`, `web/src/business/library/OrgLibrary.tsx`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

The previous shared organisation library includes hosted originals. Headquarters must be able to share programme recipes without supplying recordings or bypassing venue-specific rights.

## Accepted decision

1. Represent organisation-approved metadata/collections, venue-authorised catalogue, local device inventory, and zone/time-specific readiness separately.
2. Venue setup requires rights attestation, supported hardware, attached authorised local source, output check, fallback, schedule and real offline playback rehearsal before unattended Ready.
3. Music provisioning comes from files already lawfully available at the venue or separately approved local/contracted supply; no default Selecta audio cloud transfer or unlicensed P2P replication.
4. Prevent auto-substituting explicit versions for clean edits, bypassing blocked artists, or treating a licence attestation as blanket permission for all copies/processing.

## Operational edge cases

Programme pushed to 20 venues but 3 lack media, shared ISRC but different remaster, venue drive fails on Saturday, acquisition or venue transfer, expired rights.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Migrate organisation audio asset refs to metadata catalogue and local source-binding workflows; gate rollout by each zone's readiness. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Multi-venue divergent inventory test, source linking, licensing and content restrictions, HQ UI, offline play log and real-device sound check. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0474-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of venue catalogues, lawful local provisioning and rights. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0474-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0474-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0474-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
