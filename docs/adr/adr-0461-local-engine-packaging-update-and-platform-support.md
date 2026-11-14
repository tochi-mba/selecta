# ADR-0461 - Local engine packaging, update and platform support

> **Controlling browser-first update — 2026-11-14:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes any mandatory Python/FFmpeg installer, native agent, separate venue computer, or guaranteed background/reboot browser playback in this historical decision. **Cloud runs DSP and plays locally in the supported browser** (including a venue's sole Android tablet or iPad; capable phones also render). Standalone Python Selecta remains independent. [Device/DSP feasibility](selecta-browser-device-capability-matrix.md) · [Full product/repository plan](selecta-browser-first-master-plan.md). Implementation status counts below are an older snapshot and do not certify browser parity; tests and real-device verification remain required.


- **Decision:** Accepted by owner (2026-11-13); implementation not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Prior decisions:** ADR-0392, ADR-0396, ADR-0445, ADR-0446; conflicting hosted-media assumptions superseded by ADR-0455 and this decision, not historical statuses.
- **Source touchpoints:** `src/selecta/dev_server.py`, `src/selecta/api.py`, `src/selecta/cli.py`, `web/src/devices/`, `web/src/kiosk/`.
- **Programme:** [Roadmap](selecta-local-first-roadmap.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Context

Reliable multi-hour venue playback cannot depend on a developer command, browser tab, arbitrary file permissions or an untested Python environment.

## Decision and invariants

1. **Cloud is a no-install browser audio application.** The site and optional PWA execute local file selection, Web Audio/AudioWorklet DSP and permitted workers/WASM. No installed Python process, FFmpeg binary, local service or desktop is required.
2. A venue may have **only an iPad or Android tablet**. It opens the website, chooses accessible licensed local music, taps Start, checks real output and remains foreground/awake while DJing. Phones can run local renders too when qualified.
3. PWA installation may give an icon or separate window but **does not grant an always-on process**, guaranteed lock-screen audio or automatic restart after reboot. Wake lock can be rejected or revoked.
4. Existing Python/FFmpeg packaging, native diagnostics, upgrades and services remain relevant for **standalone local mode or a separately evaluated optional unattended/kiosk edition**, not ordinary Cloud onboarding.
5. Device-specific files, codecs, storage, power, model inference, Bluetooth/USB/HDMI outputs and render quality are independently tested on Safari, Chrome/Edge, Firefox, Samsung Internet and Android browsers. The browser engine is not a toy reduced replacement: retain native musical features as a porting/parity programme.
6. If a customer requires guaranteed unattended 24/7, auto-reboot playback or certified multi-zone hardware, offer a **separate optional deployment** after qualification, not a hidden Cloud prerequisite.

## Edge cases and rejection semantics

Power loss, OS sleep, failed installer, missing dependency/model, no audio interface, macOS permission prompt, unsupported Android hardware and disk-full update.

Unknown device readiness, stale metadata, unavailable media, forbidden sources and failed local execution must never be turned into a false successful cloud state. Preserve original media and immutable user work.

## Migration and compatibility

First wrap existing local app non-destructively; do not replace standalone startup before parity gate. Standalone local mode retains all existing guarantees. Do not remove an old route, flag, screen or worker before its functionality is either replaced with verified parity or explicitly retired by a separate approved record.

## Verification requirements

Cold install, reboot, unattended start, update rollback, audio-output loopback, hardware baseline and offline operation tests. Assert no user audio traverses the cloud boundary. Cover successful and failing states, retries, stale command/revision handling, accessibility and device-specific visibility where appropriate. Synthetic recordings only in automated tests.

## Rejected alternatives

- Preserve old cloud-audio assumptions under renamed UI copy.
- Silently weaken existing features to make the new architecture easier to implement.
- Mark a proposed feature implemented based solely on documentation.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0461-01 - Contract and owner mapping.** **Acceptance:** document exact schema, source consumers, old contract mapping and safety boundaries for local engine packaging, update and platform support. **Required verification:** architecture/code review. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0461-02 - Implementation and parity.** **Acceptance:** implement the new contract with no loss of existing user-facing capability; stale old dependencies are removed after compatibility is proven. **Required verification:** focused unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0461-03 - Negative and edge tests.** **Acceptance:** exercise the failures specified above, multi-device isolation and no cloud audio egress. **Required verification:** deterministic failure-injection tests and relevant browser tests. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0461-04 - Migration and release evidence.** **Acceptance:** record backfill, rollback, upgrade/downgrade and independent verification before replacing the previous contract. **Required verification:** compatibility drill and evidence ledger. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR is an accepted design decision, **not implemented functionality**. All corresponding LF tasks remain Not started until code, tests and required human checks exist.
