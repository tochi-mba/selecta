# ADR-284 - Listen hero, lyrics, music spectrum and handoff polish

- **Decision:** Proposed (owner review pending).
- **Implementation:** 5/8 Not started; 0/8 In progress; 3/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P0. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0210, ADR-0211, ADR-0249, ADR-0266; old statuses unchanged.
- **Source touchpoints:** `web/src/views/Now.tsx`; `web/src/views/spectrumVisuals.ts`; `web/src/styles/listening.css`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist - 3/8 Implemented; 0/8 independently Verified

1. **MP-0284-01 - Balance song identity.** **Acceptance:** Artist, song title, motif and time have intentional hierarchy. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** feat/finish-checklists (2026-11-10); **Evidence:** web/e2e/mp-0284-listen.e2e.ts 'MP-0284-01' (eyebrow, motif and title, artist and time in that order and size at 320, 768 and 1440) passed in Edge 2026-11-10; **Evidence/reviewer:** independent reviewer -.
2. **MP-0284-02 - Refine main transport.** **Acceptance:** Play/Pause, Next, Volume and Seek align and remain usable. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** feat/finish-checklists (2026-11-10); **Evidence:** web/e2e/mp-0284-listen.e2e.ts 'MP-0284-02' (Previous, Play/Pause and Next share a centre line and stay put through Play, Pause and Resume; Volume and Seek work) passed in Edge 2026-11-10; **Evidence/reviewer:** independent reviewer -.
3. **MP-0284-03 - Align song strip.** **Acceptance:** Time markers, scrubber and transition indicator reflect actual clock. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **MP-0284-04 - Polish lyric block.** **Acceptance:** Current line, adjacent text, untimed and instrumental fallbacks readable. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** feat/finish-checklists (2026-11-10); **Evidence:** web/e2e/mp-0284-listen.e2e.ts 'MP-0284-04' (current lyric leads, neighbours readable, untimed and instrumental songs say so) passed in Edge 2026-11-10; **Evidence/reviewer:** independent reviewer -.
5. **MP-0284-05 - Clarify upcoming transition.** **Acceptance:** Countdown, next title and rendered seam status form one glance path. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **MP-0284-06 - Quiet steering controls.** **Acceptance:** Bigger, Calmer, Something else, Good and Bad stay discoverable but secondary. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **MP-0284-07 - Review fifteen visualisers.** **Acceptance:** All modes use authentic analyser data and coherent framing/theme/Still. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **MP-0284-08 - Verify audio continuity.** **Acceptance:** Navigation and visual changes cannot restart playback or defeat Pause. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
