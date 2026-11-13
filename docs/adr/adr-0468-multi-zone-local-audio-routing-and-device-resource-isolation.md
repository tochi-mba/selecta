# ADR-0468 - Multi-zone local audio routing and device resource isolation

- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0429, ADR-0433, ADR-0443, ADR-0445; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/playback/zones.py`, `src/selecta/business/zones.py`, `web/src/kiosk/`, `src/selecta/scheduling/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

One physical venue computer may execute several independent zones; naive local processing and output selection can starve or mix zones.

## Accepted decision

1. Represent each zone as a distinct audio session with explicit output binding and unique playback-generation authority.
2. Admission-check sample rate, exclusive output modes, device load, output latency and aggregate resource budgets before adding zones.
3. Priority scheduling guarantees near-term seams for every active zone while long stems, analysis and exports cannot cause audible underruns.
4. Refuse accidental mappings to the same exclusive speaker; one shared amplifier serving two physical areas is generally one zone unless explicit multichannel routing is configured.

## Operational edge cases

USB DAC removed, zones start simultaneously, staff swaps output labels, two zones race, CPU overheats, shared decoder stalls.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Migrate one-zone devices first, then prove measured multi-zone concurrency before enabling shared-host zones. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Physical output tests, injected failures, simulated CPU saturation, latency calibration, restart and no-cross-zone-media verification. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0468-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of multi-zone local audio routing and device resource isolation. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0468-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0468-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0468-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
