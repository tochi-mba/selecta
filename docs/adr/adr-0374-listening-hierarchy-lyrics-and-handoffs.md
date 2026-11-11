# ADR-0374 - Listen hierarchy, lyrics integrity, seek and transitions

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 2/8 Not started; 0/8 In progress; 6/8 Implemented (3/8 ticked in the checklist with automated evidence, 2026-11-10).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 04 Listen. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0210, ADR-0211, ADR-0213, ADR-0214, ADR-0215, ADR-0249, ADR-0284; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/Now.tsx`; `web/src/styles/listening.css`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Make current music and real temporal cues visually dominant without losing the many existing options.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 6/8 Implemented; 0/8 independently Verified

1. **UF-0374-01 - Prioritise now-playing.** **Acceptance:** Identity, transport, progress and coming handoff appear before optional configuration. **Required verification:** Five-second recall task. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** Listen order (identity, transport, progress, coming handoff before optional settings) owned by MP-0284 (web/e2e/mp-0284-listen.e2e.ts MP-0284-01, -05, -06) (2026-11-10); Needs a person: five-second recall task with participants. Independent reviewer -.
2. **UF-0374-02 - Label timed lyrics honestly.** **Acceptance:** Approximate word timing is not presented as sung-word ground truth. **Required verification:** Real music + no-lyrics fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** Listen labels word-aligned timing as approximate, never claims word timing for line-timed or untimed lyrics, and explains no lyrics; web/src/views/lyricHonesty.test.tsx 'word-aligned lyrics say their timing may be approximate', 'line-timed lyrics never claim word timing', 'untimed lyrics say so instead of following along', 'a song with no lyrics says why, and the transport is still there' (4/4 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
3. **UF-0374-03 - Fit long title variations.** **Acceptance:** Long/RTL/CJK song metadata and repeated titles remain readable at zoom. **Required verification:** Responsive text test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0374-04 - Synchronise handoff information.** **Acceptance:** Countdown and transition scene follow actual playback clock and seam. **Required verification:** Audio/video correlation. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** the Up Next countdown runs only for a ready seam and on the song clock: web/src/views/listenNextUp.test.tsx 'a ready transition gets a countdown on the song clock, and no planned caveat' (3/3 passed) (2026-11-10); Needs a person: recorded audio/video correlation of countdown and transition scene against real playback. Independent reviewer -.
5. **UF-0374-05 - Provide accessible seeking.** **Acceptance:** Overview strip enables keyboard/pointer seeking with bounded status. **Required verification:** Seeking fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** the overview strip seeks by keyboard (5 s, 30 s, Home, End) and pointer, clamped inside the song, and says why it refuses during a transition; web/src/views/listenSeek.test.tsx 'moves by 5 and 30 seconds and to either end, never outside the song', 'near the end, a big step stops inside the song', 'refuses to seek during a transition and says why' (3/3 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
6. **UF-0374-06 - Clarify next-song steering.** **Acceptance:** Next-up actions do not promise ready audio where absent. **Required verification:** Pending/ready request matrix. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/src/views/listenNextUp.test.tsx 'a transition still being made is planned, with what happens if it is late', 'a ready transition gets a countdown' (2/2 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
7. **UF-0374-07 - Reduce optional panel competition.** **Acceptance:** Lyrics, spectrum settings and reasons use a secondary hierarchy. **Required verification:** Narrow viewport and usability review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0374-08 - Test passive and active listening.** **Acceptance:** No configuration is required to enjoy music; essential controls remain available. **Required verification:** Novice/expert session. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** Listen plays with no configuration and keeps essential controls; optional controls one disclosure away (MP-0284-06) (2026-11-10); Needs a person: novice and expert listening sessions. Independent reviewer -.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
