# ADR-0170 - Listen: audio-clock musical scene, real spectrum and handoff

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 4/7 Implemented, 0/7 In progress, 3/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Listen.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0144, ADR-0145, ADR-0147; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/player.ts; web/src/audio/focus.ts; web/src/styles/listening.css.

## Context and evidence boundary

Listen already has a real analyzer canvas, timing, seek-block restriction and clear transport. A signature performance scene should be grounded in actual audio and confirmed handover states, never a decorative equalizer masquerading as live audio.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, older implementation checkmarks and this docs PR cannot demonstrate that a new CI task is implemented or independently verified.

## Accepted decision

- Keep title, artist, transport and upcoming handover the first-glance hierarchy.
- Explore optional flowing/radial spectrum variants driven only by real analyzer bins, display visibility and player clock.
- Show outgoing/incoming song identities together only when the confirmed seam state supports it.
- Render musical beat or bar countdown only when corresponding timing data exists; otherwise use chronological time.
- Visually distinguish blocked seeking during rendered transitions from ordinary interactive progress.
- Keep quiet, standard and focused visual-intensity modes independent from audio and generation decisions.

## Visual, animation and microinteraction contract

- Clock-derived handover and playhead move with audible media, not a generic CSS delay.
- On pause, hidden tab, lost audio focus, absent analyzer or reduced motion, active visuals settle or stop.
- Incoming song may not become primary on screen before the real track identity changes.

## Alternatives and trade-offs

Preserve the current restrained design when a richer animation does not measurably improve comprehension, creative control or delight. Illustrative graphics are not analysed waveforms, beats, timed lyrics, fake quality ratings or album artwork. Every animated interaction needs an accessible static/keyboard equivalent; audio and current/draft correctness outrank motion.

## Implementation checklist - 4/7 Implemented, 0/7 Verified

1. **CI-0170-01 - Prototype dominant Listen song scene.** **Acceptance:** Song/artist and transport legible while Next remains discoverable. **Required verification:** Dark/light mobile and wide-display review. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/pages.e2e.ts "on a phone, Listen keeps display options after the song identity and transport reachable" (Playwright, passed 2026-11-10); web/src/views/Now.test.tsx "keeps expert view controls discoverable without competing with playback" (vitest, passed 2026-11-10).
2. **CI-0170-02 - Specify real audio-reactive motif variants.** **Acceptance:** No animation without actual analyzer data and valid audio ownership. **Required verification:** Muted, paused, hidden-tab and low-power fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/spectrumVisuals.test.ts, web/src/views/spectrumEdgeCases.test.ts (vitest, passed 2026-11-10); web/e2e/creative-visualizers.e2e.ts "each horizontal mode paints measured audio, goes blank on pause and stops while hidden" (Playwright, passed 2026-11-10).
3. **CI-0170-03 - Design two-song transition representation.** **Acceptance:** Visual overlap matches real seam timing and fallback semantics. **Required verification:** Real recorded audio synchronized to frame timeline. **Implementation:** Needs a person: real recorded audio synchronised to a frame timeline; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **CI-0170-04 - Clarify beat countdown and seeking.** **Acceptance:** Beat labels conditional on known data and blocked seek clearly explained. **Required verification:** Missing timing, seek-during-seam and touch tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Now.test.tsx "uses chronological seconds when the next handoff has no valid beat grid", "keeps a finite, disabled slider and never attempts a seek", "follows changing bar lengths instead of extrapolating the average BPM", "previews the target without seeking until release" (vitest, passed 2026-11-10).
5. **CI-0170-05 - Refine intensity settings and persistence.** **Acceptance:** Quiet/standard/focused never change playback or create audio. **Required verification:** Preference and navigation regression tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Now.test.tsx "keeps visual intensity independent from playback and remembers the choice" (vitest, passed 2026-11-10); web/e2e/motion-preference.e2e.ts "motion intensity is local and OS reduced-motion always wins" (Playwright, passed 2026-11-10).
6. **CI-0170-06 - Protect playback and main-thread budget.** **Acceptance:** Visual effects cannot cause gaps or missed input under render load. **Required verification:** Measured frame/audio trace on named hardware. **Implementation:** Needs a person: measured frame and audio trace on named hardware; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **CI-0170-07 - Validate listener anticipation and comfort.** **Acceptance:** People can predict handoff without visual fatigue or misinformation. **Required verification:** Uncoached real-audio participant study. **Implementation:** Needs a person: uncoached real-audio participant study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner and manual Pause, original files and LRCLIB disclosure, scoped mix/draft revisions and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing Library/routes, neutral blind A/B, decodable frozen-revision FLAC and local operation. Test errors, cancel, stale response, missing/RTL names, long set, offline, 320–2560px, zoom, forced colors, reduced motion, touch, keyboard and real audio where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0144, ADR-0145, ADR-0147; reconcile old task status against actual source before implementing.
- **Implementation sequence:** owner decision → visual/state prototype → fixtures → scoped source PR → independent AT/audio/device/human verification → release signoff.
- **Current:** Accepted; Not started; Independently Verified No. There is no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
