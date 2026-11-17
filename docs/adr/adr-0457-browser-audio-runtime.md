# ADR-0457 - Browser audio runtime

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 0/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF1 (runtime). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0415 (playback devices and sessions) and ADR-0419 (cloud single audio owner): unchanged, extended to browser-owned sessions here and in ADR-0461. ADR-0392 (two runtime modes): unchanged. Sibling BF ADRs: ADR-0458 (media), ADR-0459 (DSP tiers), ADR-0460 (devices), ADR-0466 (gates).
- **Source touchpoints:** new `web/src/engine/` (runtime, worklets, probe); `web/src/devices/audioSpeaker.ts` and `web/src/devices/usePlaybackDevice.ts` (replaced source); `web/src/cloud/useCloudPlayer.ts` and `web/src/rooms/CloudListen.tsx` (hosted-only after this); `web/src/player.ts` (local-mode reference, unchanged); `src/selecta/flags/cloud.json` (new `devices.browser_player`, new `cloud.local_export`).
- **Proposal chapter:** [docs/saas/10-audio-engine-in-cloud.md](../saas/10-audio-engine-in-cloud.md) (superseded in direction for default accounts).

## Context and evidence boundary

Cloud playback on `main` streams presigned proxy URLs through an HTMLAudioElement (`web/src/cloud/useCloudPlayer.ts`, `web/src/devices/audioSpeaker.ts`); the browser never decodes or mixes. The local web app has a real player (`web/src/player.ts`) but it is driven by the local Python server. The docs/saas/05 section 5.8 description of browser `decodeAudioData` playback is aspirational, not what the code does.

The decision below creates the first actual audio engine that runs entirely in the member's browser. No browser audio engine exists on `main`; nothing here is implemented or measured. Device and OS behaviour claims come from the research checked on 2026-11-14 (AudioWorklet availability, WebCodecs limits, the WebKit 2026 silent-output class of failure) and must be re-verified on real hardware under ADR-0466.

## Decision

- **One runtime, flag `devices.browser_player`.** A browser engine layer in `web/src/engine/`: an AudioContext and AudioWorklet graph for real-time playback, deterministic DSP in workers (WASM where measured), and decode through the browser codec stack plus vetted WASM decoders where a needed codec is missing. It registers with Cloud as a playback device through the existing device and session machinery (ADR-0415), so Rooms, remote control and take-over treat it like any speaker.
- **Foreground, gestured, single owner.** Audio starts only from a fresh user gesture. Exactly one tab owns the account's (or zone's) audio at a time: the ADR-0419 single-audio-owner contract extends to browser sessions, with fencing in ADR-0461. The runtime watches visibility, wake-lock revocation, interruptions and device changes, and reports them truthfully; a hidden or suspended tab never claims to be playing.
- **Capability probe before any claim.** At startup the runtime loads a test worklet and processes a synthetic block at the target rate. Only a passing probe lets the device present itself as a player; failing devices get controller and library surfaces with the reason shown (ADR-0460). A probe pass is still not an audibility claim: physical output needs the sound check.
- **Local render and export, flag `cloud.local_export`.** Offline rendering runs in the browser (OfflineAudioContext or worker DSP) and exports WAV always; FLAC through a vetted WASM encoder, since WebCodecs AudioEncoder does not produce FLAC or MP3. Exports are chunked, checksummed, duration-validated and cancellable, and download through an explicit member action (mobile Safari needs the explicit tap).
- **No hidden fallback.** When a default account's device cannot do something, the answer is `unsupported_here` with a reason. The runtime never uploads audio, never proxies PCM through Cloud, and never runs a member's protected recordings on cloud workers to fill a gap.
- **Hosted playback unchanged.** `useCloudPlayer.ts`, `CloudListen.tsx` and the presigned-proxy path remain the hosted mode's player (ADR-0456); this runtime replaces them only for local-first accounts.

## User outcome and acceptance contract

A member taps play and hears their own file mixed in the browser with no install, no upload and no spinner waiting on a worker. When their device cannot do something, the interface says so plainly and offers what does work. An export is a real file on their device whose checksum and duration were validated before they were told it succeeded.

## Edge cases

- **Context interrupted.** Phone call, assistant, another app taking audio focus, or an OS interruption: the runtime pauses, reports `interrupted`, and resumes only from a fresh gesture where the platform requires one.
- **Output route changes.** Headset unplug, Bluetooth disconnect, USB DAC removal: playback pauses safely (no blast on route change), state downgrades to `output_unverified` until re-checked.
- **Tab discarded or crashed.** The session lease (ADR-0415 heartbeat) expires; remote controllers see `uncertain`, never a stale `playing` (ADR-0461).
- **Running but inaudible.** The WebKit 2026 class of failure where the graph runs with signal and nothing is audible: analyser data never upgrades status; only the human sound check does (ADR-0460).
- **Decode failure.** An unsupported or corrupt file reports a clear per-file error and is excluded from mixes; the engine never substitutes silence inside a seam.
- **Memory pressure.** Decoded PCM is capped and evicted least-recently-needed; a long queue cannot grow unbounded; the prepared horizon shrinks before the tab dies.
- **Two tabs race.** The second tab asking to play gets a take-over prompt, not concurrent audio (fencing in ADR-0461).
- **Export interrupted.** A cancelled or failed export leaves no half-written file presented as complete; partial state is discarded and reported.

## Rejected alternatives

- **HTMLAudioElement playback for local files.** Media elements cannot run transitions, EQ or a limiter; the whole point is a mixing engine. Kept only as the hosted mode's player.
- **A service worker as the DSP engine.** Service workers are killable and throttled; they may cache the shell but cannot promise uninterrupted audio. The engine lives in the page and its workers, foreground.
- **Requiring SharedArrayBuffer threads at launch.** Cross-origin isolation interacts with login and third-party resources; first launch is single-thread-safe, threads and SIMD enabled only when detected and validated.
- **Transparent cloud compute fallback.** Explicitly rejected: it would silently break the no-audio-egress contract (BF-0455-04) and the member's privacy expectation.

## Implementation checklist - 0/8 Not started; 0/8 independently Verified

1. **BF-0457-01 - Engine skeleton and flag.** **Acceptance:** `web/src/engine/` holds the runtime (context lifecycle, graph, worklet loader, state machine) behind `devices.browser_player` (registered, default off, `docs/flags.md` regenerated); with the flag off nothing loads. **Required verification:** Vitest unit tests, `tests/test_flags.py`. **Implementation:** Not started. **Independently Verified:** No.
2. **BF-0457-02 - Capability probe.** **Acceptance:** The probe loads a worklet, processes a synthetic block at target sample rate, measures scheduling misses, and gates the player surface; failures render the controller experience with the recorded reason. **Required verification:** Vitest plus Playwright runs in Chromium, Firefox and WebKit engines asserting real (not mocked) worklet execution. **Implementation:** Not started. **Independently Verified:** No.
3. **BF-0457-03 - Gesture, focus and visibility truth.** **Acceptance:** Playback starts only from a fresh gesture; visibility loss, wake-lock revoke, interruption and route change each produce the correct state (`interrupted`, `output_unverified`, `uncertain`) visible to the member and to remote controllers. **Required verification:** Playwright interruption tests; device-lab evidence under ADR-0466. **Implementation:** Not started. **Independently Verified:** No.
4. **BF-0457-04 - Decode and memory budget.** **Acceptance:** Decode through the codec stack with per-file error reporting; decoded PCM capped with eviction; a 5,000-track queue session stays inside the measured budget on the reference devices. **Required verification:** Unit tests plus recorded device measurements. **Implementation:** Not started. **Independently Verified:** No.
5. **BF-0457-05 - Device registration.** **Acceptance:** The runtime registers as an ADR-0415 playback device (lease, heartbeat, reconnect); `web/src/devices/usePlaybackDevice.ts` drives it; hosted and browser players never both claim one session. **Required verification:** `tests/test_cloud_playback_*.py` extensions, vitest. **Implementation:** Not started. **Independently Verified:** No.
6. **BF-0457-06 - Offline render and export.** **Acceptance:** Chunked offline render with cancel; WAV export always; FLAC via WASM encoder with checksum and duration validation; explicit download action; failures never present a partial file as complete; behind `cloud.local_export`. **Required verification:** Vitest, Playwright export specs including a long synthetic mix. **Implementation:** Not started. **Independently Verified:** No.
7. **BF-0457-07 - No-egress proof for the engine.** **Acceptance:** An authenticated network capture during import, play, mix and export on a local-first account shows zero audio bytes leaving the device; the capture procedure is scripted and repeatable. **Required verification:** The ADR-0466 egress gate. **Implementation:** Not started. **Independently Verified:** No.
8. **BF-0457-08 - Reference parity harness.** **Acceptance:** The engine renders the ADR-0459 golden set and the comparison harness (synthetic owned audio, LUFS, true peak, seam timing) runs in CI on all three browser engines. **Required verification:** CI runs with recorded numbers, not mocks. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The runtime makes no venue or device claim by itself: every public capability statement routes through ADR-0460 qualification and ADR-0466 gates. The standalone local engine remains the musical reference and is unchanged.
