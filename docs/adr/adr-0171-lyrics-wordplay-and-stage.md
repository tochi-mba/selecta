# ADR-0171 — Lyrics, authentic wordplay handoffs and fullscreen Stage

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0146, ADR-0147, ADR-0155; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/styles/listening.css; web/src/App.tsx.

## Context and evidence boundary

Timed lyrics and Stage already exist. The added design goal is musical typography that is captivating while admitting lyric alignment uncertainty, preserving manual scroll and remaining comfortable on a large display.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, older implementation checkmarks and this docs PR cannot demonstrate that a new CI task is implemented or independently verified.

## Accepted decision

- Treat accurate word-level, line-only, untimed, instrumental and unavailable lyrics as distinct states.
- Use a shared phrase as the visual bridge only when real lyric text and suitable timing are available.
- If timing is estimated, prefer phrase-level or line-level transition rather than claiming exact sung-word alignment.
- Create a composed Stage layout distinct from the ordinary Listen page, with essential transport, large lyrics and clear exit.
- Make manual lyric browsing authoritative until the user explicitly restores follow-along.
- Avoid flashing/high-frequency lyric effects and all visual changes that make the text unreadable.

## Visual, animation and microinteraction contract

- Timestamp-driven line movement has a stable focal region and optional reduced-motion static swap.
- The outgoing-to-incoming wordplay graphic follows confirmed audio, not rendered assumptions.
- Fullscreen refusal yields the same usable in-page Stage, without changing Pause state.

## Alternatives and trade-offs

Preserve the current restrained design when a richer animation does not measurably improve comprehension, creative control or delight. Illustrative graphics are not analysed waveforms, beats, timed lyrics, fake quality ratings or album artwork. Every animated interaction needs an accessible static/keyboard equivalent; audio and current/draft correctness outrank motion.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0171-01 — Specify lyrics confidence levels.** **Acceptance:** UI distinguishes timed word, line, plain and missing lyric with truthful fallback. **Required verification:** Actual synced/unsynced/instrumental fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0171-02 — Design shared-phrase visual choreography.** **Acceptance:** Phrase continuity shows real source text and does not imply false precision. **Required verification:** Verified wordplay clip review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0171-03 — Compose immersive Stage identity.** **Acceptance:** Readable title, lyrics and minimum transport from a distance. **Required verification:** 1440/2560px large-screen and physical distance testing. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0171-04 — Protect manual lyric scroll and focus.** **Acceptance:** Automatic following never wrestles manual browsing. **Required verification:** Keyboard, wheel, touch and assistive-tech tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0171-05 — Preserve fullscreen rejection and exit.** **Acceptance:** Escape, focus restoration and paused state function in both modes. **Required verification:** Browser fullscreen-denied and Back test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0171-06 — Specify reduced motion and contrast.** **Acceptance:** No flash, scrolling overload or foreground loss over reactive visuals. **Required verification:** Reduced-motion and photosensitivity review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0171-07 — Measure audiovisual lyric correspondence.** **Acceptance:** Screened handoff is not earlier or more precise than valid data. **Required verification:** Recorded frame-by-frame audio/video comparison. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner and manual Pause, original files and LRCLIB disclosure, scoped mix/draft revisions and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing Library/routes, neutral blind A/B, decodable frozen-revision FLAC and local operation. Test errors, cancel, stale response, missing/RTL names, long set, offline, 320–2560px, zoom, forced colors, reduced motion, touch, keyboard and real audio where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0146, ADR-0147, ADR-0155; reconcile old task status against actual source before implementing.
- **Implementation sequence:** owner decision → visual/state prototype → fixtures → scoped source PR → independent AT/audio/device/human verification → release signoff.
- **Current:** Accepted; Not started; Independently Verified No. There is no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
