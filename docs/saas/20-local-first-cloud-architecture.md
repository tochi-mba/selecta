# Selecta Cloud — browser-native local-first architecture

**Owner correction accepted 2026-11-14:** [ADR-0485](../adr/adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes the prior **mandatory native local-engine** design. The Cloud experience runs directly in supported browsers including **iPad-only and Android-tablet-only venues**. No installed Python/FFmpeg process, companion computer or local API is required. [Full device/browser/DSP feasibility research](../adr/selecta-browser-device-capability-matrix.md). **Implementation not verified** on actual browsers yet.

## Product contract

Selecta Cloud authenticates a browser-based DJ that processes **the user's locally accessible and authorised recordings** without uploading music or derived audio. Cloud retains identity, tenancy, metadata, immutable recipes, schedules, policy, Rooms/requests, bounded metadata-only Lucy AI, Stripe and remote control. The existing standalone Python/FFmpeg Selecta is a separate installable product. No browser Cloud endpoint may decode, stream, store or proxy user PCM, stems, entire waveforms or raw source files.

## Execution and deployment

| Component | Where it runs | What it does |
|---|---|---|
| Browser real-time player | Desktop Chrome/Edge/Safari/Firefox; qualified iPad/iPhone; Android Chrome/Samsung Internet/Firefox | Web Audio, AudioWorklet transport, gain, EQ, mixes and time-critical output; active browser owns audible speaker |
| Browser offline DSP workers | Same actual playing device | WASM/JS analysis and transitions, cache, optional model inference, local export and FLAC encoder if implemented |
| Browser local media and artifacts | User selected File handles/files, safe OPFS/IndexedDB cache | Actual source permission and per-device media binding; immutable user originals remain local |
| Browser remote controller | Staff phone, personal browser or guest UI | Reads authorised metadata, sends scoped command to actual online speaker, **no access to other device's music** |
| Cloud control API/Postgres | Hosted | Workspace identity, catalogue/recipe/zone metadata, policies, command state, guest requests, billing, audit |
| Approved hosted AI | Hosted | Bounded *metadata/text-only* planning; no user audio, reconstructible features, raw local paths, protected lyrics |
| Separate standalone local app | User installs independently if desired | Existing Python/FFmpeg full engine; **not Cloud runtime prerequisite** |
| Optional future unattended/kiosk product | Separate approval only | May support hard always-on/multi-zone/reboot requirements browser cannot guarantee; never silently required |

## Browser and device behavior

**iPad venue:** Safari or Home Screen browser, user-selected local music, tap Start, output test, foreground/awake and power recommended; browser/DSP qualifications for exact model. **Android tablet venue:** same, additionally Android Doze, Chrome vs Samsung Internet vs Firefox, OEM battery management and USB/BT output qualification. **Phones:** full controller/editor; local player when codec/source/DSP/thermal tests allow. **Desktop:** richer DSP target; not a prerequisite to run the tablet venue.

Unsupported heavy neural features are explicit. Current PyTorch Beat This, neural key, torchaudio wav2vec2 and Demucs/HTDemucs cannot simply run as Python in browser; need independent model conversion/quality/performance benchmarks. Port SciPy/librosa, pedalboard stretch/FX, soxr and soundfile/FLAC behavior where possible using JS/WASM. A GPU API existing is not proof a model can run.

On tablet browser, *offline while page active* can continue prepared local playback. Screen lock, app switch, tab discard, process kill, OS update or restart may stop it. Do **not** claim 24/7 unattended or automatic restart. Output metering and AudioContext running never independently prove speakers audible; operator sound check required where it matters. Output routing/multi-zone/Chromecast require special tests and cannot be inferred from system Bluetooth.

## Canonical recording and recipe safety

A Cloud recipe references canonical catalogue recording IDs and immutable occurrences, not hosted original URLs. A destination browser resolves exact local recordings independently. Different master, clean edit, wrong codec, permission revoked and missing media remain explicit. Browser storage quotas/eviction can lose cached analysis and demand file reauthorisation, **not** erase original user files. Remote controllers cannot play another device's music just by signing in.

## Release gates

Browser JS/WASM/WebAudio engine, audible source-local transitions on iPad and Android, music analysis/quality parity, controller-to-player authenticated fencing, local media privacy and negative Cloud audio egress, real six-hour powered/awake tablet venue soak, Android OEM/Samsung Internet/Firefox and iPadOS/Safari state matrix, rights/model-licence checks, remote controls, billing, accessibility, and safe rollback. See [checklist](../adr/selecta-local-first-implementation-checklist.md) and [gates](../adr/selecta-local-first-release-gates.md).
