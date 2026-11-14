# Native-to-browser parity and accessibility evidence map

**Not a pass declaration.** Standalone Python is a functional/quality reference,
not a required Cloud installation. Reference: PR #84 master implementation plan.
Agent 01-09 own actual browser DSP and UI implementations; Agent 10 owns verification.

| Native capability / UX contract | Browser acceptance test or gate | Status |
| --- | --- | --- |
| PCM source decode and channel/rate diversity | br64-10-audio WAV matrix | Automated test added; not executed here |
| Real-time audio scheduling and gain | br64-10-audio AudioWorklet callback | Automated smoke test; not equal to seamless DJ playback |
| Silence / clipping / corrupt media | br64-10-audio edge fixtures | Automated smoke; wrong-master identity still needs Agent 02 |
| MP3, AAC, FLAC, Opus | generated files and codec evidence attachment | Results per engine; no blanket codec promise |
| Accurate multi-deck seams and playback underruns | Audio engine parity fixtures from Agent 01 | Integration request, blocked |
| Beat/key, stems, time-stretch and neural DSP | Agent 04 quality/cost benchmarks | Integration request, blocked |
| Local source picker, permissions and exact master | br64-10 selection smoke + Agent 02 contract | Source smoke only; canonical ID blocked |
| Local short/long FLAC/other export | br64-10-render synthetic offline PCM chunks + Agent 05 product renderer/hardware matrix | Synthetic browser export only; not automated against product, blocked |
| Local-only originals, stems, exports and no egress | policy_gate diff; full audit + network trace | Patch enforcement added; full audit blocked |
| Cloud speaker ownership, device transfer | Agent 06 contract, real two-device hardware | Blocked |
| Personal Cloud UX, Rooms and iPad sole venue | Agents 07/08, six-hour physical endurance | Blocked |
| Reduced motion, keyboard and responsive controls | br64-10-device laboratory responsive check | Smoke only; actual Cloud manual/axe blocked |
| VoiceOver, TalkBack and zoom 400% | physical screen-reader acceptance plan | Blocked |
| Standalone native Python/FFmpeg unchanged | existing Python/Windows CI | Existing suites preserved, not run here |

CI evidence: Playwright JSON attachments, generated codec fixtures and source-policy
status. Human evidence: hardware record, phone export checksum/diagnostics, sound-check
signatures and six-hour monotonic logs.

**Requested integration contracts:** Agents 01–09 should expose deterministic test hooks
for real PCM output, worklet underrun counters, renderer chunk checkpointing,
cancellation, selected output and exact master IDs. Agent 10 must replace laboratory
smoke tests with end-to-end assertions once those contracts merge; it must never
report feature parity until they exist.

## PR #64 personal Cloud ↔ local UI/UX parity (integration 2026-11-14)

**Reference implementation:** `web/src/shell/manifest.ts` owns the primary local music
destinations. `web/src/cloud/CloudPersonalNavigation.tsx` imports `DESTINATIONS`
so names, icons, intent and canonical deep links cannot drift. Cloud retains a
different authenticated shell/runtime: do **not** import the standalone SQLite
library or standalone `Shell`'s audio player into a hosted browser.

| Journey | Parity delivered on this PR branch | Intentional limitation / remaining gate |
| --- | --- | --- |
| Navigation and orientation | Listen, Make a Mix, My Mixes, Library, Workspace use the local manifest names/icons/paths. 4 primary mobile tabs and More; Cloud-only links nested in More. Back/Forward, account routes and deep links preserved. | Full local command palette and local breadcrumb interactions are not ported to Cloud. |
| Listen and persistent player | Distinct `/listen` now-playing view uses `BrowserAudioRuntime` and `BrowserDeviceLibrary` sharing the Cloud dock's browser engine/media index. | Local waveform, lyric Stage, live DJ visualizer and seamless audio parity need evidence before shipping claims. |
| Make a Mix and My Mixes | Separate `/mixes` and `/mixes/mine` routes share one `BrowserStudio` recipe editor, but each has its own role/heading. | Local discovery recommendation cards and full draft/render-line workflow not yet ported. |
| Studio | `/studio` uses metadata-only saved revision/history, arrangement, per-transition cues, undo/redo, guarded local render and export; no server-hosted audio playback. | Native stem studio, advanced seam audition and AI features require qualified browser DSP and hardware tests. |
| Library and connect | `/library` and `/upload` use the same `localCatalogue(workspaceId)`; file permissions, exact hashes and original-master identity remain device-local. | `dev.cmd`'s loopback folder watcher is a **different** Python `LocalCatalogue` store, not the IndexedDB browser catalogue. Browser file permissions are deliberately not transferable between apps/devices. |
| Workspace | `/workshop` shows local source/verification, device/output, and Cloud extras links without claiming the standalone app's analysis/storage/backup UI operates in a browser. | Native backup, analysis progress, diagnostics, listening study and native tools require separate browser implementations or capabilities. |
| Devices | `/devices` links to the **same** persistent dock's authenticated browser remote session; it does not create a second player. Explicit real-speaker proof required. | Multi-device takeover/handoff tests remain gate, and native legacy DevicesPanel stays in Account for migration compatibility. |
| Rooms | `/rooms` renders existing guest moderation, room QR and presence UI without mounting legacy hosted audio `PlayingBar`; host acceptance never implies playback. | Verify local-first room scheduling/zone eligibility with actual speakers. |
| Billing, privacy, auth | `/account/billing`, `/account`, admin, consent, subscription portal, and account data export preserved. | Do not use historical hosted storage quotas as local-file limits on new plans. |
| Accessibility/layout | Shared icon geometry, semantic nav, current-page indication, focus targets, touch-sized controls, mobile bottom navigation, responsive cards, reduced motion/forced-colors support. | Formal 320/375/768/1024/1440px browser snapshots, 200%/400% zoom, screen-reader/axe and physical phone acceptance are still release gates. |

### Why the previous Cloud screen showed “0 indexed” while local worked

The standalone application reads its existing `songs` library through
`src/selecta/library/scan.py`. The `dev.cmd cloud` loopback folder manager
reads `.cache/selecta-cloud/local-watches.sqlite` using
`src/selecta/lf_catalogue/catalogue.py`. Browser Cloud uses
`web/src/media/localCatalogue.ts` and origin-local IndexedDB metadata, with
user-granted File/Directory API handles held only in the active browser session.
These are **different permission domains and local indices**. The loopback
manager's count is the number of files successfully verified in its own local
catalogue, not a count imported from the standalone app. Full content SHA-256
verification can take time; a scan in progress is not a completed scan. Even
after a finished scan, an incompatible/blocked file is not counted as ready.

The proper shared boundary is **common metadata/readiness contracts and
authorised device-owned media ports**, not Cloud reading another engine's
SQLite path or treating a title match as the exact same recording. Do not
synchronise absolute paths, raw file digests, audio bytes or browser file handles
through the Cloud API.

### Safe rollout and developer smoke check

`local_first.personal` is registered as an opt-in release flag **off by
default in production**. `dev.cmd cloud` prepends
`+local_first.personal` to the development child-process `SELECTA_FLAGS`
so local development exercises the browser-first experience without changing
all existing customers. Explicit `-local_first.personal` in the developer's
environment still selects the old hosted experience for migration tests.

Run `dev.cmd cloud --seed`, sign in, and check the following without assuming
the seeded historic Cloud assets are browser-authorised files:

1. Navigation shows Listen, Make a Mix, My Mixes, Library and More. More
   contains Workspace, Studio, Connect Music, Devices, Rooms (when entitled),
   billing and account settings.
2. In Connect Music, select local recordings and verify they appear in
   Library **on the same browser profile**, then load and play from Listen.
   Changing pages must not start an additional speaker.
3. Studio's saved recipe history is metadata-only. Unsupported transitions,
   missing exact masters, stale verification and unconfirmed physical output
   must keep Play/Render guarded; a phone is not rejected merely for being a phone.
4. Test direct deep links and Back/Forward, login and permission errors,
   Accounts/Billing, Rooms moderation, and the remote device control panel.
5. Use the separate dev loopback watcher if specifically testing native
   folder watching; do not compare its count to the browser IndexedDB count.

**Status:** The route, shell, metadata/permissions and visibility changes are
implemented on PR #64. This document does **not** certify pixel-for-pixel UI
parity, complete native-to-browser music DSP parity, or physical hardware
verification; see `release-gates.md` and outstanding acceptance evidence.
