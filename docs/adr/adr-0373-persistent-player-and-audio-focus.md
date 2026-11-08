# ADR-0373 — Persistent player, system media controls and audio focus

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 5/8 Not started; 3/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 03 Navigation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0209, ADR-0214, ADR-0270, ADR-0281, ADR-0296, ADR-0362; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/shell/Shell.tsx`; `web/src/player.ts`; `web/src/audio/focus.ts`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Polish fixed player and preview handoffs without altering single audio-owner guarantees.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-0373-01 — Keep one authoritative audio owner.** **Acceptance:** Full/mini transport and all previews never overlap improperly. **Required verification:** Real player and multitab test. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `78eb474e7e40dbf1e36a7da3f8ae320bf147b883`; **Evidence/reviewer:** Manual seek/skip relinquishes previews in player.ts; player.test.ts; full focus audit pending; independent reviewer pending.
2. **UF-0373-02 — Align mini/full transport state.** **Acceptance:** Song, phase, time and loading/seam labels are identical across screens. **Required verification:** Same-state cross-route fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-0373-03 — Bound seek semantics.** **Acceptance:** Missing duration, seam boundary and unavailable audio never yield invalid time or false success. **Required verification:** Seek edge fixtures. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `3c9f6397a5b0591f9f3934ae6b0546a478c27f08`; **Evidence/reviewer:** Finite player seek and missing-duration ARIA bounds with Now/player tests; system input matrix pending; independent reviewer pending.
4. **UF-0373-04 — Protect preview interruptions.** **Acceptance:** Studio/Requests/Discover audition does not inadvertently resume or pause user music. **Required verification:** Real-audio sequence. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `78eb474e7e40dbf1e36a7da3f8ae320bf147b883`; **Evidence/reviewer:** stopPreviewsOnly on manual player seek/skip, regression test; other auditions pending; independent reviewer pending.
5. **UF-0373-05 — Make navigation audio-inert.** **Acceptance:** Route, overlay and theme changes do not replace, start or pause playback. **Required verification:** Navigation side-effect test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **UF-0373-06 — Verify system media session.** **Acceptance:** OS/browser transport controls reflect actual player state. **Required verification:** Edge/Chrome system key review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **UF-0373-07 — Keep fixed chrome reachable.** **Acceptance:** Transport remains functional with safe-area, mobile keyboard and 400% zoom. **Required verification:** Focus/geometry matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **UF-0373-08 — Explain output interruptions.** **Acceptance:** Mute, lost device and unavailable seam have recoverable visible status. **Required verification:** Device interruption review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
