# ADR-0245 - Final visual-detail audit and art-direction coherence

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (0/8 Implemented, 3/8 In progress, 5/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Polish.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0091/0130/0183; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/styles/polish.css; web/src/styles/music-objects.css.

## Context and evidence boundary

Treat finishing as a disciplined visual review: typography baselines, icon optics, selection shadows, dividers, content spacing, state-specific assets and responsive truncation all matter. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Treat finishing as a disciplined visual review: typography baselines, icon optics, selection shadows, dividers, content spacing, state-specific assets and responsive truncation all matter. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No status hidden for aesthetic minimalism, low-contrast shadow-only focus or flaky screenshot approvals. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0245-01 - Audit alignment and spacing.** **Acceptance:** Controls align across scene, card and dialog components. **Required verification:** Pixel-diff review. **Implementation:** In progress; Needs a person: a pixel-diff review of control alignment across scene, card and dialog; automated rhythm checks exist (`web/src/styles/optical-alignment.test.ts`, `web/src/styles/spacing-tokens.test.ts`); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0245-02 - Audit type and icon optics.** **Acceptance:** Titles, timestamps and icons align optically. **Required verification:** Visual specimen audit. **Implementation:** In progress; Needs a person: a visual specimen audit of title, timestamp and icon optics; `web/src/styles/typography.test.ts` and `web/e2e/mp-0277-icon-geometry.e2e.ts` cover the measurable part; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0245-03 - Audit borders and depth.** **Acceptance:** Nested panels, elevation and selected states intentional. **Required verification:** Light/dark gallery. **Implementation:** Not started; Needs a person: a light and dark gallery review of borders, elevation and selected states; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0245-04 - Review state-specific artwork.** **Acceptance:** Empty/failed/loading/pending visuals do not claim data. **Required verification:** Fixture snapshots. **Implementation:** Implemented; empty, failed, loading and pending visuals draw nothing the server didn't report: no waveform or energy shape without a measurement, no invented sound for queued, rendering or failed transitions, an empty Library only when the server really reports zero songs, and a failed search that doesn't claim there is no match; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'keeps a mix unique to its returned song order without claiming a waveform', 'keeps requested and measured energy explicitly separate, with no invented measurement', 'keeps queued, rendering, failed and rendered Thread states distinct without inventing sound' (9 passed 2026-11-11); `web/src/views/CreativeInterface.test.tsx` 'shows nothing for an empty mix and never draws a shape when nothing was measured'; `web/src/gp-0263-offline.test.tsx` 'only a server that really reports zero songs shows the empty Library and its next step'; `web/src/views/polishPhase03Mixes.test.tsx` 'says the search failed, offers a retry, and does not claim there is no match' (8 files 171 passed 2026-11-11).
5. **SF-0245-05 - Review all hover/focus/active states.** **Acceptance:** Every shared primitive consistent. **Required verification:** Interactive screenshot grid. **Implementation:** Not started; Needs a person: an interactive screenshot grid review of hover, focus and active states across shared primitives; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0245-06 - Audit content edge cases.** **Acceptance:** Long strings, tiny counts, nulls and overflow handled. **Required verification:** RTL/zoom tests. **Implementation:** Implemented; long and right-to-left names stay whole at 320px, no text is clipped at 200% and 400% zoom, missing artists and tempo are never invented, a missing time shows a dash, one is singular, and a mix of a few seconds now says 'under 1 min' instead of '0 min' (fixed in web/src/lib.ts length); **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/e2e/finishing.e2e.ts` 'long, right-to-left and duplicate names stay readable and whole at the smallest size'; `web/e2e/mp-0275-typography.e2e.ts` 'MP-0275-07 at 200% zoom ...', 'MP-0275-07 at 400% zoom ...', 'MP-0275-08 RTL, CJK, emoji, accents and mixed-script punctuation keep their meaning' (all passed in Edge 2026-11-11); `web/src/sfEdgeCases.test.ts` (4 tests) with `web/src/lib.test.ts` (2 files 44 passed 2026-11-11); `web/src/views/ex-0118-metadata.test.tsx` 'no artists and no tempo: invents neither' (3 passed 2026-11-11).
7. **SF-0245-07 - Audit motion finishing.** **Acceptance:** Transitions cancel without jitter or ghost surfaces. **Required verification:** Slow-motion capture. **Implementation:** In progress; Needs a person: a slow-motion capture review of transitions cancelling without jitter; `web/e2e/mp-0296-motion.e2e.ts` 'MP-0296-05' is the automated part; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0245-08 - Sign off across devices.** **Acceptance:** Independent reviewer approves exact candidate SHA. **Required verification:** Signed visual QA dossier. **Implementation:** Not started; Needs a person: an independent reviewer approving the exact candidate SHA in a signed visual QA dossier; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0091/0130/0183; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 0/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
