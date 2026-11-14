# Browser-first Cloud GO / NO-GO checklist

Authority: PR #84 ADR-0485. This checklist is **verification evidence**, not a new ADR.

| Gate | Required evidence | Current result |
| --- | --- | --- |
| Existing CI regressions | Python/API, Web TypeScript, Vitest, builds, Cloud Playwright, CodeQL, security | Not run in this session |
| Browser PCM and AudioWorklet | Chromium, Firefox and WebKit real engine logs | Added, CI not yet observed |
| Cloud no-install | deployed HTTPS on clean browser; no Python/FFmpeg/daemon | Not tested |
| No media upload | full source/bundle scan and authenticated network trace | Blocked: baseline legacy upload code |
| Correct actual speaker | human audible test with output route and ownership | Not tested |
| Desktop OS matrix | Windows/macOS/Linux plus Chromebook hardware | Not tested |
| iPad-only venue | six powered foreground hours on actual iPad | Not tested |
| Android tablet-only venue | six powered foreground hours on actual Android tablet | Not tested |
| Real mobile playback and rendering | iOS/Android short and 1h+ export, playback and interruption | Not tested |
| External speaker routes | built-in, Bluetooth, USB; loss/recovery | Not tested |
| Local codec matrix | source/codec/channel/rate data per browser/device | Generated codec inputs; not qualified |
| Full DSP parity | native reference PCM, LUFS, seams, stems, cancellation, models | Blocked until Agents 01–05 |
| Offline/recovery and device switch | source revocation, Doze, calls, tab discard | Not tested |
| Accessibility | TalkBack, VoiceOver, keyboard, 400% zoom, reduced motion | Manual gate missing |
| Security/CSP/COOP/COEP | deployed build, worklet/WASM/model manifest, local privacy | Integration gate missing |

**Default verdict: NO-GO** until every release-critical gate has observed,
reviewed evidence. Passing synthetic Playwright tests does not change this verdict.

## Standard release packet

- Git revision, PR, architecture ADR and browser bundle hash; CI job URLs/status.
- Per-browser automated JSON report and non-redacted failure classifications
  (no user audio). Codec capability matrix with unknown/decode failure distinct.
- Per-physical-device signed JSON record, model, OS/browser, RAM/chipset,
  source/codec, DSP, speaker route, actual run dates/hours, output verification.
- Phone short/long render artifacts with duration, integrity and peak metrics.
- Security and privacy reports: Cloud request capture, CSP/COOP/COEP manifest,
  hosted egress full gate, model licence and downloaded artifact hashes.
- Accessibility and venue sign-offs, known limitations, rollbacks and responsible owner.

An automation job can only populate the first part. Release approvers cannot
check boxes based on simulations, timer acceleration, or missing evidence.
