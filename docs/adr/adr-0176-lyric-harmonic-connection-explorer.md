# ADR-0176 — Musical discovery: phrase bridges and focused harmonic connection explorer

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0155, ADR-0125, ADR-0104; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Links.tsx; web/src/audio/focus.ts; web/src/ui/seam.ts.

## Context and evidence boundary

Selecta can find lyric phrases and possible chord relationships in personal music, but the experience can feel like a sequence of ordinary cards. The new visual proposal foregrounds genuine two-song relationships and the act of hearing and judging them; it never treats machine candidates as proven aesthetic matches.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Proposed decision

- Let a shared phrase visually bridge the exact two lyric lines and their source songs.
- Offer a bounded, optional local connection explorer for a selected song, not an unreadable global network.
- Represent the real four-stage harmonic audition and chord strip with a visibly current stage.
- Preserve candidate, user-approved, rejected and unavailable states separately.
- Never autoplay a discovery on hover; all auditions use the existing audio-focus owner.
- Enable reviewed connections to move into a selected current mix or draft with safe scope.

## Visual, animation and microinteraction contract

- Phrase reveal is triggered by actual link content, not fictional relevance score.
- Active harmonic stage follows confirmed media playback and stops on audio error.
- Rated connection resolves briefly and settles into its actual persistent review state.

## Alternatives and trade-offs

Prefer the existing restrained and proven UI when added visuals distract or reduce correctness. No artificial music, artwork, beat, lyric accuracy, quality score or fake render status. All sensory interactions require a usable static, keyboard, high-contrast and reduced-motion alternative. Source truth and explicit human consent outrank polish.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0176-01 — Design legible phrase bridge.** **Acceptance:** Shared word and both songs obvious with long/multilingual lyric lines. **Required verification:** Text and source provenance screenshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0176-02 — Prototype bounded song-neighbour graph.** **Acceptance:** Only real links appear and dense sets remain traversable. **Required verification:** Graph capacity and keyboard navigation test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0176-03 — Visualize real four-stage harmony audition.** **Acceptance:** Current stage and bar match confirmed clip position. **Required verification:** Media playback and chord clock fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0176-04 — Separate candidate from approved claim.** **Acceptance:** Machine suggestion cannot appear human-validated before rating. **Required verification:** Rating and no-audio state audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0176-05 — Keep audition and add-to-mix scope.** **Acceptance:** No unsolicited playback or wrong draft addition. **Required verification:** Audio ownership and revision tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0176-06 — Design empty and rejected states.** **Acceptance:** Absent candidates and failed previews remain truthful and recoverable. **Required verification:** No analysis/failed clip/offline scenarios. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0176-07 — Evaluate surprise versus comprehension.** **Acceptance:** Users understand relationship and distinguish hypothesis from confirmation. **Required verification:** Uncoached discovery and blind listening notes. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0155, ADR-0125, ADR-0104; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Proposed; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
