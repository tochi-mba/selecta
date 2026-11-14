# ADR-0467 - Offline-first venue execution and restart recovery

> **Controlling browser-first update — 2026-11-14:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes any mandatory Python/FFmpeg installer, native agent, separate venue computer, or guaranteed background/reboot browser playback in this historical decision. **Cloud runs DSP and plays locally in the supported browser** (including a venue's sole Android tablet or iPad; capable phones also render). Standalone Python Selecta remains independent. [Device/DSP feasibility](selecta-browser-device-capability-matrix.md) · [Full product/repository plan](selecta-browser-first-master-plan.md). Implementation status counts below are an older snapshot and do not certify browser parity; tests and real-device verification remain required.


- **Decision:** Accepted by owner (2026-11-13), implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; main `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Earlier owners:** ADR-0424, ADR-0426, ADR-0427, ADR-0429, ADR-0444, ADR-0446; historical statuses unchanged, affected hosted-audio assumptions superseded by ADR-0455.
- **Source touchpoints:** `src/selecta/autopilot/`, `src/selecta/business/offline.py`, `web/src/kiosk/audio.ts`, `web/src/business/offline/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Checklist](selecta-local-first-implementation-checklist.md).

## Context

The old venue design downloads four hours of R2 audio into browser cache; the new venue already has authorised local files and must prepare seams locally.

## Accepted decision

1. **A sole iPad or sole Android tablet is a supported venue player** using authorised local files, browser DSP, a verified system output and an active foreground/awake browser. No Python service or dedicated computer can be required.
2. Maintain a compact prepared/committed/planned musical horizon with browser workers and locally cached source material where permitted. Prioritise real-time sound against heavy stem/analysis tasks.
3. When Wi-Fi fails, current active tab may continue from locally prepared audio/schedule/policy and journal permitted changes as storage permits. **A closed, suspended or killed browser cannot promise scheduled playback**.
4. Screen Wake Lock, Home Screen installation or guided/kiosk mode improve usability but do not guarantee indefinite locked-screen audio, background execution, recovery from power loss or automatic reopening.
5. Require explicit tap-to-activate audio, operator sound check, local-source/rights verification, Bluetooth/USB output test, six-hour powered/awake real iPad and Android tablet soaks, and honest interruption/recovery status.
6. Native unattended 24/7 and reboot-autoresume remain a **separately evaluated optional product capability**, never a prerequisite for a browser-only venue.

## Operational edge cases

DST and overnight openings, server clock skew, low disk, source drive removed, 24-hour venue with no close, expiring permit mid-service, repeated offline play-log uploads.

**Safety interpretation:** never report an action successfully applied before the authoritative local engine has acknowledged execution; never infer playable audio from cloud metadata alone. Where a missing recording or device is involved, preserve the original recipe and current playback.

## Implementation and backward compatibility

Replace browser-only stub KioskAudio with real local audio process; maintain separate customer-facing display and manager diagnostics. Rollout must preserve standalone local mode and existing creative features. Staged dual compatibility is permitted only for metadata/control; audio cannot be sent through a legacy cloud path after the no-hosted-audio gate is enforced.

## Required verification

Six-hour real-device soak, internet outage, power-cycle, DST time travel, offline rights/policy and silent-output detection. Synthetic audio for tests; negative assertions that forbidden media cannot leave the device. Test all relevant cloud roles and responsive UI states. Record source/test evidence and an independent review.

## Rejected alternatives

- Continue hosted-audio transport under a different endpoint name.
- Remove the user-facing feature instead of migrating its implementation.
- Use an expired device heartbeat or title-only match as proof of successful playback.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0467-01 - Detailed contract.** **Acceptance:** define schema, invariants, source touchpoints and migration of offline-first venue execution and restart recovery. **Required verification:** reviewed source-to-decision map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0467-02 - End-to-end implementation.** **Acceptance:** existing functionality and required state transitions work through local and cloud ownership boundaries. **Required verification:** unit and integration tests with parity baseline. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0467-03 - Failure and security coverage.** **Acceptance:** cover all edge cases above, stale state, workspace isolation and forbidden cloud media. **Required verification:** fault-injection, security and browser checks. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0467-04 - Migration and gate.** **Acceptance:** evidence of safe rollout, rollback and independent testing recorded before legacy flows retire. **Required verification:** migration drill and release report. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted design; no application implementation is implied by this document.
