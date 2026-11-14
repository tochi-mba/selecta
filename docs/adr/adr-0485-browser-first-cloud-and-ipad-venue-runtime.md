# ADR-0485 — Browser-first Cloud playback, iPad venues, and capability-based DSP

- **Decision:** Owner-directed architecture correction, 2026-11-14; accepted target, **not a claim of completed implementation or hardware verification**.
- **Supersedes:** The mandatory installed Cloud engine/service, mandatory paired desktop/venue computer, and universal unattended playback assumptions wherever stated in ADR-0455–0484. Historical standalone Python behavior remains unchanged.
- **Primary contracts:** [Device and DSP research matrix](selecta-browser-device-capability-matrix.md), [LF checklist](selecta-local-first-implementation-checklist.md), [LF roadmap](selecta-local-first-roadmap.md).
- **Implementation status:** Browser Cloud DSP is **unverified**; PR #64 contains local-first Python/TypeScript components, not a proved portable browser DSP engine.

## Product decision

**Selecta Cloud must work directly in a supported browser, including on a venue's only iPad.** No Python installation, FFmpeg executable, Windows service, loopback API, second computer or companion app may be a prerequisite for standard Cloud personal or venue playback. The website/PWA is the primary product; install-to-home-screen is optional and does not create an always-on daemon. Existing standalone Selecta can continue running its Python/FFmpeg API independently, without an account.

A device can be (a) an **active local browser player**, with source-file permission, an unlocked audio context, permitted local DSP and a real output; (b) a **remote browser controller** of another active player; (c) a **metadata-only editor** with missing recordings; or (d) **temporarily unsupported/degraded**. A phone, iPad or desktop browser may fulfil more than one role; role is determined by *live capability and source preflight*, not user agent alone. Venue iPads are first-class players, not remote-controller-only devices.

Cloud provides identity, workspaces, recipe revisions, permitted catalogue metadata, business schedules and policies, Rooms, requests, billing, AI planning and scoped control messages. It does **not** receive, store, render, proxy, relay, reconstruct or redistribute user music, stems, PCM or rendered mixes. Locally generated audio stays on the actual playback browser/device. Do not infer that a file on one signed-in device can play on another; remote playback requires a separate authorised media binding at the target device. Spotify/Apple Music streaming libraries are not automatically usable local files.

## Browser runtime design

1. **Real-time audio path:** Web Audio with `AudioWorklet` for bounded, allocation-free time-critical processing; prepare audio ahead in dedicated workers/WebAssembly. Avoid network calls, blocking code, GPU inference, model downloads and garbage-collection pressure in the audio callback. Permit MediaElement fallback only where a deliberately simpler non-DSP technique is explicitly validated.
2. **DSP adaptation, not Python-in-Safari:** preserve current algorithm *outcomes* where technically possible by porting/testing deterministic render, filters, time stretch, transient repair, beat/key/spectral analysis, loudness, cues, FLAC encoding and output validation to browser-compatible JS/WASM/WebGPU. Browser execution cannot directly import `torch`, `librosa`, `pedalboard`, native `soxr` or CLI `demucs`. Maintain golden synthetic fixtures, listening tests, perceptual tolerance and provenance/version differences.
3. **Machine learning:** lightweight/optimised model inference may use ONNX Runtime Web/WASM or available WebGPU, after per-model import, licensing and device benchmarks. Existing Beat This, neural key, wav2vec2 forced lyric alignment and Demucs/HTDemucs **are not browser ports today**; no claim of universal stems/wordplay on mobile. If the only venue device lacks a feature, show a supported transition option and state the difference; do not secretly process the audio in Cloud.
4. **Local media:** `<input type=file multiple>` works as the baseline user-mediated import. Use `webkitdirectory` where actually supported, and advanced `showDirectoryPicker` only where present; it is not a universal Safari solution. On iPad, explicit file import/OPFS cache may be needed for durable re-access, subject to quota/eviction and user consent. Never automatically upload/copy music into Cloud; never silently delete originals.
5. **Caching and export:** IndexedDB/OPFS/Cache storage is quota- and eviction-sensitive. Sync recipes/metadata, not audio. Inspect available quota, store only necessary working sets and versioned artifacts, require local reauthorisation when a picker cannot restore access. Browser downloads/FLAC must be separately encoded, tested and user-initiated. Do not promise unattended filesystem watch, arbitrary filesystem paths or automatic export to a chosen folder on every platform.
6. **Device output:** use supported system speaker/USB/Bluetooth/AirPlay routes and appropriate user-visible output tests. On Safari/iPadOS, programmatic `AudioContext.setSinkId` / multiple independent output zones cannot be assumed. A typical iPad drives **one** real output/zone unless independently verified. Audio meter != confirmed speaker audibility; audible output requires operator check or an independently verified physical monitor.
7. **Security:** local file handles and media bytes never enter Cloud requests, URLs, logs, telemetry, AI or crash reports. Scoped, revocable HTTPS/WSS browser player sessions, expiring idempotent commands, generation/revision fencing, replay defense, strict workspace isolation; remote controllers do not gain file access. Review COOP/COEP and third-party integrations before enabling SharedArrayBuffer and threaded WASM.
8. **Responsiveness:** all devices can browse, edit recipes, manage Rooms/requests, and remotely control an eligible player (with network/auth). Actual Play Here and advanced DSP require local media and verified capability, not a subscription upsell. Use adaptive work budgets, thermal/battery/low-memory cancellation, and queue deadlines; a feature not feasible on the active device is `unsupported_here`, not silently hosted or magically completed.

## iPad-only venue service contract

A venue may use **one powered iPad with accessible licensed tracks, a connected speaker and an awake, foreground Selecta web app**. First-run: sign in, select/import music, verify storage and policy, perform baseline local analysis/preparation, select the system output, tap Start to unlock audio, perform a *physical sound check*, start the programme and keep the screen/app active. Allow another phone to act as a remote controller while the iPad is active. Screen Wake Lock can be requested and reacquired if available; optional Guided Access and external power improve operations, but neither guarantees survival of OS termination or iPadOS background suspension.

**Never market this setup as guaranteed locked-screen, unattended, 24/7 or reboot-autoresuming playback.** Explicitly detect hidden/suspended/closed/unreachable sessions and label the authority unknown; a green heartbeat or `AudioContext.state === 'running'` does not prove audible output. If music is interrupted, the UI should expose safe/manual resumption and avoid replaying expired commands. Preserve locally cached authorised schedules through temporary internet loss **only while the browser remains executing**. An inactive browser cannot promise periodic jobs, automatic reopen, offline telemetry or recovery after reboot.

Offer a **separately evaluated optional** installed/kiosk/native runtime *only* where a customer's desired operating requirement cannot be fulfilled in the browser (always-on, unattended restart, guaranteed lock-screen operation, hardware multi-zone, unsupported heavy DSP). That optional product must never become a hidden prerequisite for ordinary iPad-only/Cloud venues.

## Explicit capability/reliability boundaries

- **Supported on modern browsers in principle, not necessarily yet implemented in Selecta Cloud:** basic decoding, playback, crossfades, EQ, gain/limiting, local preview, recipe editing, light spectral analysis and short prepared transitions.
- **Needs validated browser implementations and device benchmarks:** beat tracking, key estimation, time-stretch/warps, stem separation, forced lyric alignment, stem-based wordplay, FLAC export, large-library scans, offline caches, multiple independent decks, true peak, interruption handling.
- **Not safe to promise as a universal website guarantee:** access to subscription-service DRM audio as raw PCM, unattended source-folder watching, direct programmatic output selection on Safari/iPadOS, arbitrary multi-zone hardware routing, hidden/locked iPad 24-hour DSP, background processing after tab termination, automatic audio restart after reboot, persisted original files without user action, direct execution of the Python/PyTorch engine in the browser.

## Acceptance gates

The Cloud player cannot be called production-ready before:

1. Real iPadOS Safari **and home-screen PWA** clean-device start without installing Selecta or using any other computer; local music selected, transition rendered/audible, output recovered after a Bluetooth disconnect, and remote staff phone control confirmed.
2. Desktop Chrome/Edge, desktop Safari, Firefox, Android Chrome, iPadOS Safari and iPhone Safari functional capability matrix with precise OS/model/browser/RAM and time/thermal results; slower devices degrade deliberately.
3. Playback soak on actual powered venue iPads (minimum six hours **foreground/awake**) with silence detection procedures, documented sound checks, source loss, Wi-Fi loss, app switching, phone calls/alarms, screen lock, page reload, storage eviction, power cut, crash and speaker routing.
4. Audio parity for each *advertised* DSP feature against standalone golden fixtures; document any device-specific unsupported features and use-case eligibility. Heavy models require a separate pass on device; WebGPU presence is not sufficient proof.
5. Zero cloud media transfer, credential/tenant/fencing tests, bounded caches, GDPR/privacy review, music-rights review, accessibility/touch 320px/large zoom and battery/thermal/responsiveness tests.
6. No incorrectly green `playing`/output state under silent WebKit audio failures; application cannot detect physical sound solely through browser APIs, so operator or external verification is required where critical.

## Sources checked 2026-11-14

- [WebKit Safari 26 — WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/); [AudioWorklet support](https://caniuse.com/mdn-api_audioworklet); [WebKit silent Web Audio case](https://bugs.webkit.org/show_bug.cgi?id=323104).
- [Web platform file picker support](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access/), [mobile directory input support](https://caniuse.com/input-file-directory), [WebKit storage quotas/persistence](https://webkit.org/blog/14403/updates-to-storage-policy/).
- [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), [AudioContext output selection](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId), [Apple Guided Access](https://support.apple.com/en-gb/111795).
- [WebCodecs audio codec support](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection), [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [Spotify policy prohibiting mixing and business use](https://developer.spotify.com/policy).

## Implementation tasks

Track the browser/device-specific tasks as **LF-0485-01 through LF-0485-16** in the authoritative local-first checklist. All remain unticked until cited implementation, automated tests and independent real-device evidence exist. This ADR supersedes contradictory mandatory native Cloud runtime goals; it does **not** mark any implementation complete.
