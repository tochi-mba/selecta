# ADR-0460 - Device and venue capability, and single-tablet venues

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 0/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF3 (devices and venues). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0415 (playback devices and sessions): unchanged, extended. ADR-0417 to ADR-0440 (Venue Autopilot): unchanged; Autopilot consumes the browser player once qualified. Sibling BF ADRs: ADR-0457, ADR-0461, ADR-0463, ADR-0466.
- **Source touchpoints:** new `web/src/engine/probe.ts` (capability probe); `web/src/devices/` (DeviceCheck, wakeLock); new `cloud.venue_tablet` and existing `devices` flags in `src/selecta/flags/cloud.json`; `docs/verification/` (device records).
- **Proposal chapter:** [docs/saas/11a-devices-and-rooms.md](../saas/11a-devices-and-rooms.md).

## Context and evidence boundary

Research checked on 2026-11-14 (re-verify on hardware): AudioWorklet is available across modern Chrome/Edge, Firefox, Safari, Chrome Android, Samsung Internet and Firefox Android, but audio glitches remain device-specific. `AudioContext.setSinkId` is Chromium-only and absent on Chrome for Android media elements; most output routing belongs to the OS. Android Doze, OEM battery killers and audio focus can stop or mute a tab; iPadOS auto-lock and audio-session rules interrupt; one 2026 WebKit bug class has Web Audio running with nonzero signal while nothing is audible. Chromecast is a receiver that fetches streams, not a Web Audio sink. Budget devices share APIs with flagships while differing hugely in RAM, thermal headroom and latency.

No device has been qualified. Every row of the eventual capability record starts empty; an OS/browser tuple without a test result is unknown, never claimed.

## Decision

- **Capability by measured probe, never identity.** A device's abilities come from runtime probes and benchmarks: worklet execution (ADR-0457), storage and codec probes, a calibrated synthetic DSP benchmark for tier admission (ADR-0459). User agent, brand, price and model name never gate a feature. Results are recorded per `device_model + os_version + browser_engine/version + engine_version + codec + media_source + output_type`.
- **The supported venue posture, flag `cloud.venue_tablet`:** one iPad or Android tablet, in the foreground, awake (wake lock plus guidance), on power, after an **audible human sound check**. Analyser data never proves sound; only a person confirming they heard the check tone flips output status to verified. Loss of any posture element downgrades status honestly (`output_unverified`, `uncertain`) and tells the operator what to fix.
- **Output routing.** System default output first, with guided physical route tests; `setSinkId` selection only where the API exists and the route was tested. Bluetooth, USB-C DAC, 3.5 mm, HDMI and dock routes are tested per device class, including disconnect and reconnect. Casting locally mixed PCM via Chromecast is not promised.
- **Explicit non-promises**, stated in product copy and docs: no locked-screen or background continuance, no reboot auto-resume, no unattended 24/7 claim, no multi-zone from one tablet, no playback from DRM streaming subscriptions. An optional unattended or kiosk deployment, if ever wanted, is a separate future ADR and never Cloud's prerequisite.
- **Everything else is a controller.** WebView and in-app browsers, TVs and unqualified devices get controller, guest and library surfaces with the reason recorded, never a player claim.

## User outcome and acceptance contract

A bar owner props a tablet on the shelf, taps Start, hears the check tone, confirms it, and the night runs from that tablet with truthful status on their phone. When something changes (someone locks the screen, the Bluetooth speaker drops), the status says so in plain words with the fix. Nobody is told their device can do something it has not demonstrated.

## Edge cases

- **Wake lock revoked** (OS policy, battery saver): the runtime detects it, warns on the device and to controllers, and the venue flow explains re-enabling before status degrades further.
- **Phone call on the venue tablet.** Audio focus loss pauses playback safely; recovery needs the posture restored and, where the platform demands it, a fresh gesture; remote staff see `interrupted`, not silence with a green light.
- **Doze or OEM killer stops the tab.** The heartbeat lapses, the lease expires, controllers see `uncertain`; the recovery flow on the tablet resumes from the saved local state (ADR-0461 reconciliation).
- **Speaker dies but the tab runs.** The inaudible-output class: periodic re-checks are offered at natural boundaries; status shown as last verified at a time, never a standing guarantee.
- **A capable phone wants to be the venue player.** Posture, not form factor, decides: a phone passing probes and the sound check may play; the venue flow still recommends a powered tablet.
- **Split screen or multi-window.** Visibility heuristics differ; the probe and runtime treat partially visible as foreground only where measured; otherwise the posture warns.
- **Device record missing.** A member on an untested tuple gets conservative defaults (Tier 1 if probes pass), with the record marked unknown and the measurement offered, never a block on a passing device.

## Rejected alternatives

- **User-agent allowlists.** They misclassify budget devices and new browsers both ways and rot instantly; probes measure the truth.
- **Trusting analyser output as proof of sound.** Directly contradicted by the known WebKit failure class; only humans hear.
- **Promising background venue playback with a service worker.** Browsers kill it; an honest product cannot promise it.
- **Multi-zone from one tablet.** Concurrent independent physical outputs from one browser are unproven; one zone per device until real hardware shows otherwise.

## Implementation checklist - 0/8 Not started; 0/8 independently Verified

1. **BF-0460-01 - Probe suite.** **Acceptance:** Worklet, storage, codec and benchmark probes produce a signed-shape capability record keyed by the full tuple; no feature gate reads the user agent (asserted by test). **Required verification:** Unit tests, a static check banning UA gates. **Implementation:** Not started. **Independently Verified:** No.
2. **BF-0460-02 - Venue posture flow.** **Acceptance:** The `cloud.venue_tablet` flow walks power, wake, output choice, Start tap, audible check and confirmation; every posture loss downgrades status with the fix named; registered flag, `docs/flags.md` regenerated. **Required verification:** Playwright flow tests plus device-lab runs. **Implementation:** Not started. **Independently Verified:** No.
3. **BF-0460-03 - Sound-check truth.** **Acceptance:** Output status becomes verified only through human confirmation of the check tone; analyser data alone cannot set it (asserted by test); re-check offers appear at natural boundaries and after route changes. **Required verification:** Unit and Playwright tests; the ADR-0466 audible gate. **Implementation:** Not started. **Independently Verified:** No.
4. **BF-0460-04 - Output route matrix.** **Acceptance:** Built-in, Bluetooth, USB-C DAC, 3.5 mm and HDMI routes tested per reference device with disconnect/reconnect behaviour recorded; `setSinkId` used only on tuples where it passed. **Required verification:** Recorded device-lab results in `docs/verification/`. **Implementation:** Not started. Needs a person: physical speakers. **Independently Verified:** No.
5. **BF-0460-05 - Android qualification programme.** **Acceptance:** The Android matrix (Chrome, Samsung Internet, Firefox Android; low/mid/high RAM bands; Doze, battery saver, calls, focus, posture changes) is scripted as a repeatable protocol with per-run records. **Required verification:** First completed protocol run on real hardware. **Implementation:** Not started. Needs a person: devices in hand. **Independently Verified:** No.
6. **BF-0460-06 - iPadOS qualification programme.** **Acceptance:** The iPadOS matrix (Safari tab and Home Screen app, auto-lock, app switch, interruption, external outputs, the silent-output regression check) scripted likewise. **Required verification:** First completed run on real hardware. **Implementation:** Not started. Needs a person: devices in hand. **Independently Verified:** No.
7. **BF-0460-07 - Controller fallback surfaces.** **Acceptance:** Unqualified devices get controller/guest/library surfaces with the recorded reason shown; no dead ends; deep links to player-only features degrade politely. **Required verification:** Playwright with forced probe failures. **Implementation:** Not started. **Independently Verified:** No.
8. **BF-0460-08 - Non-promise copy audit.** **Acceptance:** Product copy, onboarding and marketing surfaces carry none of the banned claims (background continuance, auto-resume, 24/7 unattended, multi-zone, streaming-service audio); the banned list is testable and tested. **Required verification:** Copy audit test plus owner review. **Implementation:** Not started. Needs a person: the owner approves public phrasing. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. Public venue phrasing is marketing-sensitive while every hardware gate is open: the owner approves exact wording (BF-0460-08) separately from this acceptance, and no capability claim ships ahead of its ADR-0466 evidence.
