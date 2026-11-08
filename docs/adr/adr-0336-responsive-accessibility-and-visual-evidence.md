# ADR-0336 — Mobile, streaming accessibility, paired-theme visual and usability evidence

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Quality. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0233, ADR-0234, ADR-0239, ADR-0240, ADR-0270, ADR-0271, ADR-0298; unchanged.
- **Source touchpoints:** `web/src/shell/Shell.tsx`; `web/src/styles/tokens.css`; `web/e2e/paired-theme.e2e.ts`.

## Context and evidence boundary

A docs proposal or synthetic screenshot cannot independently certify mobile functionality or inclusive UX; live streams and stacked keyboard/player/dialogs create new failure combinations. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Require matched-state light/dark screenshot/geometry corpus, actual mobile/PWA keyboard tests, 320–3840px and 200/400% zoom, reduced/Still/forced colour, keyboard and named screen reader sessions. Test the complete Describe→Critique→Approve path without guidance.

## UI/UX and measurable acceptance contract

Critical actions and input remain available in every supported viewport. All tool mini animations have stable accessible text and do not steal focus or flood announcement regions.

**Required negative cases:** Modal over composer over mini-player, keyboard resize with long prompt, landscape notch, high contrast waveform, RTL long song title, event replay duplicates live announcements and screen reader during token stream.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-336-01 — Define viewport state matrix.** **Acceptance:** All supported device width/height/zoom + keyboard/player/modals enumerated. **Required verification:** Recorded geometry matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-336-02 — Capture paired visual baseline.** **Acceptance:** Same data, state and viewport in dark/light/system with real assets or labelled fixtures. **Required verification:** Before/after evidence links. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-336-03 — Test stacked chrome occlusion.** **Acceptance:** No approval or composer control hidden by player, nav, sheet or keyboard. **Required verification:** Bounding-box E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-336-04 — Test streaming AT strategy.** **Acceptance:** Live messages and tools announced meaningfully with no token spam. **Required verification:** NVDA/VoiceOver/TalkBack manual evidence. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-336-05 — Test all keyboard actions.** **Acceptance:** Inspect, lock, compare, revise, send, stop and approve have focus parity. **Required verification:** Full keyboard+screen reader journey. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-336-06 — Verify Still and forced colour.** **Acceptance:** Static alternatives preserve all semantic states; no animation dependency. **Required verification:** Motion/contrast snapshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-336-07 — Run novice and creator tasks.** **Acceptance:** Users distinguish idea vs build and can complete mobile and desktop flow. **Required verification:** Named uncoached moderated study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-336-08 — Require independent sign-off.** **Acceptance:** Source SHA, OS/browser, device, reviewer, failures and retests documented. **Required verification:** Release-evidence audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Proposed and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
