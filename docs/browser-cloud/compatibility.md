# Browser/device qualification matrix — expected, not certified

Controlling architecture: [ADR-0485](../adr/adr-0485-browser-first-cloud-and-ipad-venue-runtime.md).
No row below is a confirmed compatibility claim without a dated test record.

| Target | CI coverage | Real-device gate | Priority and risk |
| --- | --- | --- | --- |
| Windows Chrome/Edge | Linux Chromium binary, not Windows | Windows browser + real audio output | OS driver, WASAPI/USB, sleep |
| macOS Chrome/Safari | Linux Chromium/WebKit only | macOS Chrome and Safari | Safari codec/picker and audio interruptions |
| Linux Chrome/Firefox | Linux Chromium/Firefox | ALSA/PulseAudio/PipeWire external DAC | output routing and suspend |
| Chromebook ChromeOS | desktop Chrome-style profile only | x86 and ARM Chromebook | low RAM, Files/Drive handles, storage eviction |
| iPad Safari/PWA | WebKit emulated tablet profile | real iPadOS Safari and installed PWA; six-hour venue | gestures, USB/Bluetooth, screen awake, power |
| iPhone Safari/PWA | desktop WebKit, not iOS | real iPhone, short/long render | calls, memory pressure, export/share |
| Android Chrome tablet | Chromium with phone emulation, not Android | real Android tablet; six-hour venue | Doze, audio focus, OEM killing, external output |
| Android Chrome phone | desktop Chromium mobile emulation | budget and flagship phones | thermal, long render, storage pressure |
| Samsung Internet | none | Samsung phone and tablet, One UI/DeX | file picker, codec, lifecycle independently |
| Firefox Android | none | real Android Firefox | WebAudio, picker, background limits |

## Qualification fields by device

- **Transport:** can local media be selected/decoded, does AudioWorklet render with
  bounded underruns, does the named physical speaker actually play?
- **File selection:** file input, granted folders if present, revoked permission,
  unavailable external drive, wrong recording master and corrupt source.
- **Codecs:** PCM WAV (22.05/44.1/48 kHz, mono/stereo), MP3, AAC/M4A, FLAC,
  Opus, optional higher bit depths; distinguish decode versus encoding and download/share.
- **DSP:** gain, fades/crossfades, limiter/anti-clipping, filters, EQ, tempo
  stretch, seam rendering, beat/key/wordplay, stems, neural model per-platform cost.
- **Export:** 30-second and long locally processed mixes, progressive chunks,
  storage quota, file-system save/share, cancellation/recovery, wrong master.
- **Accessibility:** native touch/keyboard, screen reader VoiceOver/TalkBack,
  focus restoration, 200% and 400% zoom, reduced motion and landscape/portrait.
- **Reliability:** offline, tab discard, incoming calls, battery saver, Bluetooth
  disconnect, USB disconnect, heat throttling, browser restart and output uncertainty.

**Feature-specific downgrade:** present exact unsupported feature or format, and offer
a locally safe alternative, edit-only mode or remote control. Do not silently substitute
a low-quality fake model for neural DSP or claim playback when output is unverified.

**Automation limits:** CI checks render callbacks and decoded PCM in browser processes;
it cannot validate human-audible speakers, OS thermal behaviour, iOS media sessions,
Samsung Internet, Android Doze or six-hour venue endurance.
