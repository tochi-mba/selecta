# ADR-0329 — Optional microphone input, transcript confirmation and audio ownership

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P2 / Optional inputs. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0069, ADR-0140, ADR-0209, ADR-0234, ADR-0254; statuses and scope unchanged.
- **Source touchpoints:** `web/src/audio/focus.ts`; `web/src/player.ts`; `web/src/shell/Shell.tsx`.

## Context and source evidence boundary

A chatbot composer may eventually support spoken mix requests, but live microphone capture competes with the existing music player and introduces privacy and accessibility concerns. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Voice is an optional future entry method, never required for Lucy. Obtain explicit microphone permission, display recording state, transcribe into editable composer text and require Send before starting a turn; do not add automatic voice playback or silently interrupt the player.

## UI/UX, interaction and truth contract

Microphone control is visible only when supported and enabled. It shows start/stop, permission and transcription errors in a compact accessible manner.

**Negative cases:** Permission denied, no mic, speech recognition error, headset change, paused music, phone lock, offline remote transcription, accidental wake, long transcript, screen reader use.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-329-01 — Decide voice release scope.** **Acceptance:** Owner records optional/disabled-by-default availability and provider/privacy policy. **Required verification:** Product decision and feature flag test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-329-02 — Capture only with consent.** **Acceptance:** Mic access requires deliberate action and visible recording indicator. **Required verification:** Browser permission and privacy test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-329-03 — Preserve audio focus.** **Acceptance:** Mic starts/stops without unintended song play/pause or hidden audio capture. **Required verification:** Real device headset/audio focus tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-329-04 — Provide editable transcription.** **Acceptance:** Speech result is text in composer; no unreviewed auto-send. **Required verification:** Voice error and correction task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-329-05 — Specify remote transcription disclosure.** **Acceptance:** Any network audio path requires explicit provider consent; no automatic raw music upload. **Required verification:** Outbound payload capture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-329-06 — Handle device and permission failures.** **Acceptance:** Denied/unavailable/degraded returns to normal typing. **Required verification:** Hardware/offline test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-329-07 — Design mobile/AT control.** **Acceptance:** Reachable start/stop and clear status with no speech-only requirement. **Required verification:** VoiceOver/TalkBack/accessibility audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-329-08 — Verify optional isolation.** **Acceptance:** Disabling voice removes microphone code path without affecting text agent. **Required verification:** Feature-flag regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Proposed; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
