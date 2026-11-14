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
| Local short/long FLAC/other export | Agent 05 renderer and phone hardware matrix | Not automated against product, blocked |
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
