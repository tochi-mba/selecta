# ADR-0308 — Accessible streaming conversation, tool logs, dialogs and selection

- **Decision:** Proposed (owner review pending; docs-only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Accessibility. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0204, ADR-0234, ADR-0244, ADR-0270, ADR-0298; unchanged.
- **Source touchpoints:** `web/src/ui/controls.tsx`; `web/src/views/Mix.tsx`; `web/src/shell/Shell.tsx`.

## Context and evidence boundary

Live token deltas and simultaneous tool updates can overwhelm assistive technology or steal focus; stacked chats, sheets and the permanent player impose a strict interaction budget. This new decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Create a navigable transcript with batched semantic announcements, separate status regions for important tool changes, focus-safe native dialogs, labels for every affordance, keyboard equivalents for all proposal gestures and high-zoom/forced-colour fallbacks.

## UI/UX and evidence contract

Screen reader users hear meaningful completed chunks, not every token; aria-live/role=log behaviour is measured; Stream/Stop stays available while messages arrive.

**Required negative cases:** Rapid interleaved tool events, focus held on removed card, modal closed during response, duplicate announcement on SSE replay, composer disabled without explanation.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-308-01 — Specify transcript semantics.** **Acceptance:** Messages have real headings/roles and sensible role=log/live region behaviour. **Required verification:** NVDA/VoiceOver output transcript audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-308-02 — Throttle live announcements.** **Acceptance:** Stream tokens and tool progress do not flood assistive tech. **Required verification:** Timed fake-stream announcement capture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-308-03 — Preserve focus on incoming content.** **Acceptance:** New messages, cards and revisions never steal focus; focus returns after dialogs. **Required verification:** Keyboard/focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-308-04 — Provide complete keyboard flow.** **Acceptance:** Send, stop, inspect, lock, reorder, revise, compare and approve work without pointer. **Required verification:** Full keyboard-only task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-308-05 — Provide semantic state equivalents.** **Acceptance:** Running, warning, readiness and locks are read without animation/colour. **Required verification:** Forced colours and no-style testing. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-308-06 — Handle overlays predictably.** **Acceptance:** Approval/dialog/sheet trap and restore focus while player and keyboard coexist. **Required verification:** Overlay stack + Escape audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-308-07 — Support long multilingual names.** **Acceptance:** RTL/CJK/emoji titles remain identifiable, separated from controls. **Required verification:** Bidirectional+large text fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-308-08 — Obtain independent AT proof.** **Acceptance:** Named reviewers sign WCAG 2.2 320px and 400% zoom journey. **Required verification:** NVDA, VoiceOver, TalkBack and manual records. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
