# Selecta Cloud — browser-first local audio roadmap (ADR-0455–0485)

**Owner direction:** ADR-0455–0484 were accepted for local-first Cloud on 2026-11-13. On **2026-11-14** ADR-0485 **supersedes their assumption of an installed Cloud engine**. **Cloud must be no-install, browser-native on desktops, iPads and Android tablets;** an iPad- or Android-only venue can be an actual audio player without a dedicated computer. Historical Python LF code in PR #64 is not browser DSP completion or device certification. Standalone native Selecta remains separate. [Device/DSP research](selecta-browser-device-capability-matrix.md) · [Implementation checklist](selecta-local-first-implementation-checklist.md).

## Product and safety contracts

- Cloud = account, tenancy, permitted catalogue metadata, recipes, schedules, Rooms, guest requests, hosted **metadata-only** Lucy/AI planning, billing, command/role security and audit. Cloud **never** receives protected audio, PCM, stems, derived audio or raw private paths.
- Browser **player** = locally accessible authorised recordings, audio decode, real-time Web Audio/AudioWorklet playback, DSP via JS/WASM/workers, local artifacts and physical audio output. A phone/tablet may be player, controller or editor depending on actual capabilities and files; mobile is not inherently controller-only.
- **Venue with one Android tablet or iPad is supported** while the browser is active, foreground, awake and output-tested. Power recommended. Do not promise locked-screen background continuance, unattended reboot auto-resume, reliable periodic browser jobs after suspension or universally supported physical multi-zone output. A separately approved optional unattended runtime must not become Cloud's prerequisite.
- Existing standalone Python+FFmpeg local mode stays runnable without login. Preserve source/music algorithms and quality, but port/validate their behavior for browser; no `demucs`, `torch`, `librosa` or `pedalboard` magically running in Safari/Android.
- Product plans must not charge artificial daily local stem/analysis/render/export quotas. Music rights/copies/stem/model licences still require counsel before business use.

## Dependency-based execution (no false browser readiness)

| Phase | Outcome | Gate |
|---|---|---|
| LF0 Correct architecture | ADR-0485, Android/iPad/desktop capability matrix, obsolete native assumptions removed, no-hosted-media audit | Product signs off browser-first + optional native separation |
| LF1 Browser runtime | New real browser AudioWorklet engine, foreground state, source import, one physical speaker, no native install | Cold iPad and Android tablet play owned audio with true output |
| LF2 Browser media + recipes | Cross-browser input/folder import, source reauthorisation, OPFS/IndexedDB safe cache, canonical track references, immutable recipes and missing-media repair | Two-device 5/8 missing track case, no source deletion or cloud media |
| LF3 Core musical parity | Browser beat/key/features, timing, effects, seam rendering, true peak, limiter, prepared horizon, safe FLAC export | Synthetic audio comparison + listening tests on supported desktop and tablet |
| LF4 Device-specific neural and advanced | Evaluate Beat This, Demucs, neural key, wav2vec2 word alignment, stem Studio and high-quality stretch separately | Model licenses + per-device memory/thermal/runtime + musical quality evidence; explicit unsupported_here where needed |
| LF5 Cloud control protocol | HTTPS/WSS browser sessions, phone remote controls tablet, ownership/fencing, ACK, retry, TTL, offline conflict | Cross-workspace isolation, expired commands, old speaker remains safe on failed transfer |
| LF6 First-class iPad and Android venues | Browser-only onboarding, power/wake guidance, local scheduling, requests/Rooms, physical output checks, real status, operator recovery | **Six-hour powered/awake sound soak on both iPadOS and Android**; app switch, lock, Doze, kill, outage, output tests |
| LF7 UX/business/billing | Device capability adaptive Library, Studio, player, HQ/staff/kiosk, local quotas removed, rights and account export | Mobile accessibility, 320px, VoiceOver/TalkBack, feature flags, no false Ready |
| LF8 Host-media retirement | Remove upload/proxy/R2/Modal audio data plane; preserve permitted non-audio API & developer artifacts | Network egress, security, secrets/infra inventory, safe rollback |
| LF9 Independent release | Real browser hardware matrix, no-audio-Cloud captures, rights/model licensing, DSP quality and product signoff | All relevant gates green; unsupported features stated without false promises |

## Platform support strategy

**Desktop:** Chrome/Edge, Safari, Firefox on Windows/macOS/Linux, plus supported ChromeOS; test codecs, WASM SIMD/thread isolation, output drivers and model performance. **iPad/iPhone:** Safari and Home Screen web app; Files provider, Safari 18.4+ directory input, wake lock, background/lock, audio-session silence and external outputs. **Android tablets/phones:** Chrome, Samsung Internet, Firefox Android, OEM battery policies, Doze, phone calls/audio focus, USB/SD/Bluetooth/HDMI, different GPU and RAM bands, Chrome Android folder picker from supported versions. **Other platforms:** WebView/in-app, TVs, headless/embedded are controller/guest until actual certification.

A capability probe is not a substitute for a measurable audio test. Qualify a specific model, OS, browser engine/build, available RAM/GPU, local source, output type and feature version. A high-end tablet may have advanced DSP; an old device may have only prepared fades or controller experience. No secret cloud fallback for audio.

## Release claims not permitted without evidence

“Works with every music streaming subscription,” “unattended 24/7 from a locked iPad/Android browser,” “automatically restarts DJing after reboot,” “five independently routable tablet audio zones,” “Demucs stems on every phone,” “same Python DSP in browser without porting,” or “Web Audio running proves venue speaker is audible.”

## Source and integration consequences

The prior PR #64 agent work contains native-oriented `src/selecta/local_engine/**`, Python DSP, browser control UI and metadata domain structures. **Re-scope all pending recovery agents** before merging into browser-first Cloud. Preserve valuable standalone DSP and metadata/contracts, but reject mandatory installer/native Cloud startup and unverified venue engine claims. The route flag and UI must not hide the browser player behind installation gates. No direct merge into main without explicit approval.

**References:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md), [research matrix](selecta-browser-device-capability-matrix.md), [source map](selecta-local-first-source-map.md), [checklist](selecta-local-first-implementation-checklist.md), [verification matrix](selecta-local-first-verification-matrix.md), [release gates](selecta-local-first-release-gates.md).
