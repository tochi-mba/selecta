# Selecta Cloud browser-first product and repository delivery plan

**Architecture owner correction:** 2026-11-14. **Authority:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md); [cross-device feasibility research](selecta-browser-device-capability-matrix.md); [136-task implementation checklist](selecta-local-first-implementation-checklist.md).
**Baseline reviewed:** PR #64 `docs/local-first-cloud-rearchitecture-20261113` at `f6ed738af07f3532635c0135a6f4fe39c01d44a0`.
**State:** delivery proposal, not a claim that browser DSP or real tablet audio has been implemented or certified.

## One product promise

1. Open Selecta Cloud directly on a modern supported desktop/laptop, Chromebook, iPad, iPhone, Android tablet or Android phone. **Do not require a local Python process, FFmpeg binary, installer, second computer or local API** for ordinary Cloud.
2. Every capable device may **play and render** from music that it is authorised to access locally. Mobile is **not** permanently controller-only. Phones can render locally, including offline chunks and local exports where codec, memory, battery and storage benchmarks allow.
3. Separate operation roles from form factor: **Player**, **remote controller**, **metadata-only recipe editor**, **guest/staff**, or **temporarily unsupported**. A phone can be a venue player; a laptop with no music can be controller-only. Capability probe + media preflight determines availability.
4. Support **sole-iPad and sole-Android-tablet venues**, powered and awake with the browser in the foreground, source-ready, music-policy-ready and output verified. Staff phone remote control is optional. A browser is **not an unattended system service**; never promise automatic restart after reboot, reliable background processing or guaranteed locked-screen DJ audio.
5. Cloud receives only accounts, permitted metadata, recipe revisions, approved AI planning, schedules, requests, subscriptions and scoped commands. **No original, PCM, stems, render or reconstruction audio is sent to Cloud**, including hidden fallbacks, crash reports, analytics, cache or AI prompts.
6. Preserve mature standalone Python/FFmpeg Selecta as a separate account-free product and the **audio quality reference**. Reimplement meaningful outcomes in browser JS/WebAudio/WASM/optional GPU; do not simply delete features or claim Python dependencies work in Safari.

## Core experience and user journeys

### A. First visit — any personal device

- Landing: **Play music on this device**, **Control another player**, **Open/edit saved mixes**. Never make the user choose desktop vs mobile first.
- Play here: connect files or a supported folder; explain source location and permission; verify supported format, media access and local space; run a brief capability calibration; let user choose reasonable quality/advanced presets; unlock Web Audio with **Tap Start**; request/verify actual speaker output with a sound check; begin mixing.
- If a source has only partial files (e.g. 5/8), show exact missing/candidate/master-mismatch rows, allow recipe editing and local reattachment, and never mark fully playable.
- A supported PWA install is an **optional convenience** (icon/standalone window), not a native DSP engine, and not equivalent to reliable background execution. Show an install prompt only after value is demonstrated; use browser-specific instructions, not a fake in-page install button.

### B. Personal browser player and mobile render

- Two-deck streaming decoder + bounded source windows, Web Audio/AudioWorklet for real-time gain, mixing, beat-sync/filters, limiter and output; workers/WASM for analysis, stretch, seams, stem inference and export. **No model inference, file/network I/O, unbounded allocation or UI updates inside audio callback.**
- Render button on phone is real: local chunked rendering to OPFS or verified temporary storage, with checkpoint strategy if feasible, memory/thermal/battery admission, cancellation and resume only after validation, progress per stage, format/space estimates and user-initiated download/share. `OfflineAudioContext` can render graphs but does not solve whole-mix streaming/export memory constraints by itself.
- Support real features when qualified: transition/seam rendering, cue sync, EQ, filters, echo/reverb, precise time-stretch, beat/key/features, LUFS/limiter, stem-based techniques, word cuts/lyric timing, frozen exports. **Separate quality gates** for advanced ML. A lightweight beat detector is not equivalent to Beat This.
- Processing presets: **Automatic** (default: benchmark and choose safe model/quality), **Battery Saver** (bounded CPU), **Best Quality** (only if actually qualified), **Prepare Ahead** (no audible starvation). These are processing strategies, **not paid DSP quotas**.

### C. Switch between devices

- A user's recipes, policies, titles, immutable versions and selected catalogue metadata follow the account. Their audio files do **not** magically follow.
- Show **Play Here** only when target browser owns exact authorised recordings and its output/worklet is qualified. Otherwise show **Control [venue iPad]**, **Locate Music**, **Edit Recipe**, or **Review Alternate**.
- Network partitions: target can preflight but cannot claim takeover while original still may be audibly playing. Use fenced generations, short TTL, unique operation ID, actor/workspace scope, confirmed source-stop or explicit human isolation. A Cloud accepted response is not an audible execution acknowledgment.
- Multi-tabs on one device require an audio owner election. Browser refresh, PWA launch and permission reauthorisation must never create duplicate sound or lose saved recipe revisions.

### D. iPad-only and Android-tablet-only venue

- Setup: create venue and zone, choose local source through platform picker, validate permitted recordings/content rights, preanalyse a safe near-term horizon, connect speaker through OS/system route, ask staff to **tap Start** and confirm physical sound, enable foreground/wake guard and operator recovery.
- Runtime: Now Playing, next transition, local prepared horizon, staff controls, guest QR requests and policy/status. Priority is **continuous, physically audible music**, not a heavyweight neural stem task.
- Internet outage: currently active browser continues from locally authorised media and cached schedule/policy where available; command sync/Rooms/hosted AI unavailable and queued durable edits reconcile later. If browser is killed/backgrounded/locks, make state **interrupted/unknown**, never lie that it is still playing.
- App switching, incoming phone calls (phones), Android audio focus/Doze, iPadOS Safari suspension, OS update, screen lock, wake lock rejection, Bluetooth disconnect, USB-C DAC/HDMI, AirPlay, battery drain, heating and storage eviction need explicit tests and operator guidance. **Wake Lock keeps a visible screen awake where supported; it is not a generic background service.**
- Default **one actual output/zone per mobile browser player**. Multi-zone through `AudioContext.setSinkId`, exclusive DAC hardware, or casting cannot be inferred; require physical output test. Multiple tablets are valid multiple player devices. Chromecast/Sonos require a dedicated lawful receiver architecture and are not trivial Web Audio sinks.
- Optional future **Selecta Venue Pro** native/kiosk/reliable appliance edition may satisfy genuinely unattended 24/7, reboot auto-start, lock-screen or multi-zone requirements, but **must not block or contaminate no-install Cloud venue**.

### E. Guest, staff, business and accessibility

- Staff control from any phone/tablet with scoped permissions; confirmation, pending/applied indicators and a safe manual stop. Guest QR needs no audio access, never exposes catalogue source paths, owner identities, billing or diagnostics.
- Business HQ operates multiple mixed devices and shows *each* venue's verified track count, real output confirmation age, OS/browser compatibility, active/foreground state, prepared horizon, source access, battery/storage risks, remote command outcome, schedule and rights state.
- Touch-focused tablet/phone layout, landscape iPad/Android, keyboard shortcuts on desktop, large-volume controls that do not exceed venue caps, 320 px/400% zoom, reduced-motion, VoiceOver/TalkBack, and accessible live status. Never let technical errors be the only way staff learn that music has stopped.

## Audio architecture and modules to build

```text
HTTPS Cloud (identity, metadata, recipes, schedules, rooms, commands, AI planning)
  ├─ Browser shell (auth, account, navigation, responsive views)
  ├─ Browser player session (roles, commands, owner generation, output state)
  ├─ Browser media source layer (file picker, folder import, handles, relink, cache)
  ├─ Browser engine (WebAudio graph + AudioWorklet mixer/output; no blocking jobs)
  ├─ DSP worker pool (JS/WASM analysis, windowed seams, stretch, effects, encode)
  ├─ Optional on-device model runtimes (WASM/WebGPU/ONNX, isolated/benchmark gated)
  ├─ Browser durable metadata/cache (IndexedDB, OPFS, versioned provenance)
  ├─ Browser mix/Studio/visuals (web UI, gestures, timeline, export, failure states)
  └─ Browser venue controller (schedules, Rooms requests, offline while alive)
Dedicated local Python/FFmpeg standalone mode = independent retained product.
```

### Technical concerns that must be engineered, not assumed

| Problem | Plan |
|---|---|
| Codec support / FFmpeg port | Test MP3/AAC/FLAC/WAV actual decode per browser; use browser-native decoder when possible and independently licensed/benchmarked WASM only if needed |
| Sample-rate/precision | Canonical render timebase, resampling and deterministic versions; test 44.1/48 kHz and device route changes |
| Beat grids and key | Port or replace PyTorch Beat This/key models with measured, versioned JS/WASM or converted browser models; compare confidence and musical error |
| Spectral features, MFCC, chroma | Test FFT/mel/section calculations against Python fixtures, avoid sending reconstructible features Cloud |
| Time stretch and seam warp | Browser DSP port with pitch preservation, bounded memory/latency; compare sound quality and drift against `pedalboard` reference |
| Stem separation | Demucs/HTDemucs conversion is optional until weights/licence/operators/peak RAM/thermal and latency pass per device; no hidden hosted-audio alternative |
| Lyric word alignment | `wav2vec2` browser model conversion + rights/quality gate; no unsafe guessed cut confidence |
| Export formats | Streaming/chunk render + actual encoder (e.g. vetted WASM FLAC) + checksum/duration verification; never label a WAV as FLAC |
| Local storage | Never rely on permanent OPFS/IndexedDB. Respect quota/eviction, versioned artifacts, cache accounting and explicit reimport; protect originals |
| Local source types | Files picker baseline; directories/USB/SD/cloud-backed Files providers where explicitly accessible; do not assume arbitrary NAS paths or streaming DRM libraries can be opened |
| Installed PWA | Same browser engine, convenient app icon/window and perhaps better engagement; not a daemon, codec provider or guaranteed background renderer |
| WebGPU | Browser API presence and ONNX Runtime execution-provider support are distinct; prove each operator/model on actual iOS/Android GPU and WASM fallback |
| Casting/output | System output default + hardware sound check; separate LAN output strategy for Cast/Sonos, no Cloud media relay |
| Browser security | HTTPS/secure contexts, user gesture, safe file handle scope, CSP, COOP/COEP impact on WorkOS/Stripe, RLS, no PCM/logs/AI leakage |
| DRM/legal | Spotify developer terms prohibit mixing Spotify Content and business use; commercial venue playback, music copies, stems and model redistribution all require review |

## UI/UX rebuild by actual repository file

The following targets are **informed by PR #64 source inspection**; use new file owners for browser code and preserve stable routes/deep links where useful.

| Current area | Concrete repository files | Required change |
|---|---|---|
| Cloud app shell and nav | `web/src/cloud/CloudApp.tsx`, `CloudRoot.tsx`, `cloudRoutes.ts`, `cloud.css`, `web/src/copy.ts` | Unified browser-first destinations; remove hosted-audio and native-install assumptions; fix mount conflict hiding player/Studio when local-first flags enabled |
| First-run and device setup | `web/src/cloud/lf-personal/PersonalWorkspace.tsx`, `contract.ts`, `FolderWatches.tsx` | Replace install Python/local HTTP onboarding with Pick Music → Scan → Capability Probe → Output Test → Tap Start → optional PWA |
| Music import, catalogue, source state | `web/src/cloud/Uploads.tsx`, `uploadParts.ts`, `Library.tsx` | Remove Cloud upload UI; build browser file/directory picker, drag/drop, permissions, reimport, source change, mobile Files, devices and local index |
| Persistent player | `web/src/cloud/CloudTransportDock.tsx`, `useCloudPlayer.ts`, `lf-device-control/**`, `web/src/audio/**` | Real AudioWorklet transport, one audio owner, browser player sessions, true output state, foreground/interruptions and remote command ACK; don't use signed Cloud audio URLs |
| Studio and mix repair | `web/src/cloud/MakeCloudMix.tsx`, `lf-mix-repair/**`, `web/src/views/**` | Open any recipe even without audio; responsive timeline, local seam renderer, optional stems, mobile touch, 5/8 missing media, export workflow and version history |
| Player/device browser runtime | **New** `web/src/engine/**`, `web/src/media/**`, `web/src/dsp/**`, `web/src/device-capabilities/**`, `web/src/render/**`, `web/src/venue-player/**` | Build typed, browser-exclusive local media/DSP/adapters, with worker/WASM artifacts, real codecs, caching, model gating, source/format provenance and platform tests |
| Browser/cloud bridge | `src/selecta/lf_control/**`, `src/selecta/lf_api/**`, `src/selecta/routes/lf_v1_api.py`, `web/src/cloud/api.ts` | Register browsers as real player devices; unify envelope, role, expiry, idempotency/ACK, per-device capability and availability; Cloud never asks for source paths |
| Business HQ | `web/src/business/console/**`, `venue/**`, `localFirst/**`, `onboarding/**` | Sole-iPad/Android setup, per-venue readiness and browser state, licenses, sound check, offline/lock warning and staff control |
| Staff, kiosk and guests | `web/src/business/staff/**`, `web/src/kiosk/audio.ts`, `web/src/rooms/**`, `web/src/guest/**` | Replace stub audio with real browser speaker; distinguish guest screen from player; Rooms readiness and accepted/applied reporting; never assume a second computer |
| AI/Lucy | `src/selecta/ai/**`, `src/selecta/lucy/**`, `web/src/views/Lucy*.tsx` | Cloud metadata-only planning; browser-authorised tool executions constrained by local models, sources and policies |
| Business plans/exports | `src/selecta/billing/**`, `src/selecta/usage/**`, `web/src/cloud/Billing.tsx`, `Meters.tsx`, `AccountData.tsx` | Remove hosted-storage/daily-local-DSP sales copy; metadata ZIP excludes media; local download/export separate; ensure legacy account-settings export bug fixed |
| Feature flags/registration | `src/selecta/flags/**`, `src/selecta/api_cloud.py`, `web/src/business/client.ts` | Real browser feature/capability flags; compose routes centrally in integration branch; no flags yielding a missing player |
| Old hosted music infrastructure | `src/selecta/storage/**`, `src/selecta/routes/cloud_proxy.py`, `infra/modal/**`, `services/worker/**`, R2 configs | Remove hosted-media upload, original/derived signing/proxies and audio workers when no-media regression gates pass, retaining metadata infra |
| Dev tool and docs | `dev.cmd`, `src/selecta/devstack/**`, `README.md`, `docs/adr/**`, `docs/saas/**` | Developers still may install Node/Python to work on source; **end users do not**. Document standalone vs browser Cloud vs optional future kiosk. Maintain checklist and CI evidence |

### New app information architecture

**Personal:** Home / Discover / Library / My Mixes / Studio / Player / Devices / Rooms / Lucy / Account.
**Business manager:** Overview / Venues / Programmes / Library readiness / Devices & output / Staff / Rooms / Reports / Billing / Policy.
**Venue player on tablet:** Now Playing / Up Next / Requests / Sound & Readiness / Source / Schedule / Recovery.
**Staff phone:** Now / Skip / Energy / Volume within safe bounds / Requests / Speaker status.
**Guest QR:** Join Room / View approved request catalogue / Request / See real status; never gain source or management access.

On mobile, use bottom navigation, gesture-safe full-width controls and compact Now Playing. On desktops, keep an inspector/timeline layout and powerful keyboard shortcuts. On tablets, landscape split-view is preferred for Studio, with a protected persistent speaker status. One app design system, **different layouts based on viewport and tasks, not separate brands or reduced phone rights**.

## Critical end-user states / failure experience

Every main surface understands: `no_source`, `permission_required`, `media_missing`, `candidate_match`, `version_mismatch`, `codec_unsupported`, `model_unavailable`, `processing_limited`, `preparing`, `ready_to_play`, `audio_activation_required`, `output_unverified`, `playing_confirmed_by_operator`, `foreground_required`, `interrupted`, `remote_unreachable`, `takeover_unsafe`, `cloud_offline`, `storage_pressure`, `export_failed`, `policy_blocked`.

A successful `AudioContext.resume()`, nonzero analyser waveform, green WebSocket or accepted Cloud operation must **not** be presented as proven physical audibility. Only a user sound check or independent physical instrumentation supports a stronger claim. Explain the next action inline.

## Implementation roadmap / work packages

| Order | Workstream | Deliverable and release criterion |
|---|---|---|
| 0 | Preserve + inventory | Baseline all standalone functions, hosted Cloud routes, existing flags, all UI/UX pages, tests and audio algorithms; compare to requested behavior; reject any destructive changes |
| 1 | Browser feasibility spike | Real owned synthetic MP3/AAC/WAV/FLAC play, sample-accurate overlap + crossfade on iPad Safari and Android Chrome, phones and desktop, no engine installer |
| 2 | Browser source + capability | File/folder import, codec detection, provenance, source binding, quota/permission and device profile; Android Chrome/Samsung Internet/Firefox plus iOS Safari |
| 3 | Real-time transport | Single AudioWorklet mixer, interruption/foreground/speaker state, physically audible output, no blocking heavy DSP on audio callback |
| 4 | Portable recipes + Cloud contract | Browser sessions, track identity and 5/8 readiness, immutable recipe edits, metadata only, auth/roles/fencing/ACK |
| 5 | Core DSP parity | Analysis, BPM/key/features, cue scripts, EQ/reverb/limiter, crossfade, seam and time-stretch quality tests vs native reference |
| 6 | Browser export | Phone/tablet/desktop chunk rendering, local FLAC/WAV encoding with validation, cancellation and storage/memory pressure |
| 7 | Advanced AI DSP | Evaluate Demucs, Beat This, neural key, wav2vec2 and more sophisticated wordplay **per model/device**, opt in only after quality/performance/licensing passes |
| 8 | Personal UX | First-run, local library, devices, player, Studio, mix repair, Lucy, plans, copy, responsive/a11y, PWA install |
| 9 | Venue/business UX | Android/iPad-only setup, real output + offline while active, staff phone, guest Rooms, HQ, schedules, rights, one-zone hardware |
| 10 | Hosted media retirement | Retire Cloud audio API/worker/R2 and quotas, update account export and billing; no Cloud audio egress |
| 11 | Reliability, CI and device certification | Full Playwright/unit/WebAudio synthetic test harness, real hardware six-hour tablet tests, security/legal, rollback and independent GO/NO-GO |

**Parallel implementation ownership:** browser core, DSP/analysis, models, file/cache/export, Cloud control/API, personal shell, Studio, device UI, business/Rooms, security/billing/infra, test harness, ADR reconciliation. Use isolated branches from current PR #64 HEAD, non-overlapping files, named interfaces and one integration owner for `api_cloud.py`, flags, shared API client and bundler. Do not merge agents' pre-browser-install assumptions unchecked. Integration PR targets PR #64 branch, **not main** until explicitly approved.

## Device certification strategy

Record actual device model, browser build, OS, RAM/hardware where observable, network, audio route, file source, features, codec, prepared-horizon duration, peak memory, CPU/thermal, storage, wake lock, interruptions and actual output evidence. Do not invent per-browser performance.

Minimum representative test groups:
- **Desktop:** Windows Chrome/Edge/Firefox; macOS Safari/Chrome/Firefox; Linux Chromium/Firefox; Chromebook low-resource.
- **Apple mobile:** at least one older supported iPad, one current iPad, a high-end iPad, and iPhone; Safari tab and installed Home Screen PWA; phone call/lock/AirPlay/USB/BT.
- **Android:** budget 3–4 GB phone/tablet, midrange, modern premium tablet, high-end phone; Samsung One UI, Pixel, Lenovo/tablet and another OEM; Chrome stable/PWA, Samsung Internet, Firefox Android, other browsers where supported; Android Doze/audio focus/DeX/BT/USB/HDMI/source Files provider.
- **Other:** optional kiosk/browser and supported network speaker integrations, only after physical certification.
- **Long-haul:** six-hour powered/awake tablet venue sound soak per platform; multi-hour phone playback; 30/60 minute chunked export; storage eviction; offline/online; tab discard; crash; wrong output; two-controller racing; no-audio cloud capture.
- **Quality:** native golden synthetic DSP fixtures, level-matched blind listening for advanced transitions, multiple tempo/key/master variants, false-ready and content policy blockers, strict CPU deadline/glitch checks.
- **UI:** VoiceOver, TalkBack, screen readers, keyboard, touch, landscape, 320px/400% zoom and low-motion, daylight/night mode.

## Ship criteria

- End user can **open and DJ directly in browser** on a clean laptop/iPad/Android tablet; **phone can render locally** if qualified.
- No mandatory install or hidden desktop/localhost/Python dependency.
- Core musical features have verified browser parity; advanced ML features have explicit per-device qualification/recovery and no secret Cloud music processing.
- Venue setup succeeds on a sole Android or iPad tablet with a real audible-output check; business screens don't claim locked-screen/reboot reliability that browser cannot deliver.
- All Cloud media egress and legacy hosting eliminated/blocked; local originals protected.
- Full repo build/test/CodeQL/browser E2E are green, no skipped release-critical real-hardware gates, docs/checklist statuses backed by cited source and test evidence, no PR #64 merge to main without owner approval.

## Research references

- [Web Audio / AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet); [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering); [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).
- [iOS Safari directory selection](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/); [Safari 26 WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/); [Directory picker compatibility](https://caniuse.com/mdn-api_window_showdirectorypicker).
- [Storage quota/eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API); [Android Doze](https://developer.android.com/training/monitoring-device-state/doze-standby).
- [Output routing limitations](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId); [PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing); [Spotify prohibited mixing/business playback](https://developer.spotify.com/policy).
