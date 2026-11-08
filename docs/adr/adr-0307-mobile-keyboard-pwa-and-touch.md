# ADR-0307 — Mobile-first chat, proposal, keyboard, touch and PWA continuity

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Mobile. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0160, ADR-0208, ADR-0209, ADR-0233, ADR-0234, ADR-0270, ADR-0298; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/shell/Shell.tsx`; `web/src/styles/tokens.css`; `web/src/styles/shell.css`; `web/src/state/prefs.ts`.

## Context and evidence boundary

Selecta already reserves mobile bottom chrome and tracks visualViewport keyboard insets. Lucy adds a composer, tool cards, proposal, confirmation and player sharing constrained vertical space. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Use full-width Chat/Your mix views on compact screens, with reliable deep-link/back behaviour, composer visible above keyboard, adjustable multiline entry, touch alternatives and no overlap with mini-player/navigation. Mobile covers the complete creation/revision/approval task.

## Interaction, provenance and data contract

The selected song follows Chat ↔ Your mix; no drag-only or long-press-only actions; approval controls remain reachable at 320 CSS px and high zoom. Closing Lucy preserves the real player without surprise Pause/Resume.

**Failure and negative scope:** Visual viewport resize, notch/safe area, PWA standalone chrome, landscape 320xheight, 400% zoom, browser sleep, slow tool stream, RTL titles, accidental swipes and tab switches.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-307-01 — Specify compact navigation.** **Acceptance:** Chat/Your mix and Back restore exact selection and scroll in conversation. **Required verification:** Phone nav and back-stack E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-307-02 — Integrate composer and keyboard inset.** **Acceptance:** Focused multiline input and Send/Stop remain visible with active keyboard. **Required verification:** iOS/Android hardware and visualViewport tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-307-03 — Arbitrate bottom chrome.** **Acceptance:** Player, nav, toasts, sheets and dialogs never occlude approval/composer. **Required verification:** Stacked-layer bounding-box matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-307-04 — Provide touch alternatives.** **Acceptance:** Move/lock/replace/inspect actions work without drag/long press. **Required verification:** Touch+keyboard interaction parity. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-307-05 — Persist mobile draft input.** **Acceptance:** Unsent text stays per conversation across suspension/reload. **Required verification:** PWA task interruption test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-307-06 — Handle short and rotated screens.** **Acceptance:** Landscape and 320px layouts scroll critical controls without traps. **Required verification:** Orientation/200–400% zoom visual test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-307-07 — Prevent stream auto-scroll hijack.** **Acceptance:** New messages count replaces forced scroll when reviewing earlier content. **Required verification:** Scroll anchoring and live-event test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-307-08 — Validate end-to-end mobile journey.** **Acceptance:** Describe, critique, inspect, lock, approve and save work one-handed and with AT. **Required verification:** Uncoached mobile and VoiceOver/TalkBack study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
