# ADR-0176 - Musical discovery: phrase bridges and focused harmonic connection explorer

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 6/7 Implemented, 0/7 In progress, 1/7 Need a person (2026-11-11).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0155, ADR-0125, ADR-0104; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/Links.tsx; web/src/audio/focus.ts; web/src/ui/seam.ts.

## Context and evidence boundary

Selecta can find lyric phrases and possible chord relationships in personal music, but the experience can feel like a sequence of ordinary cards. The new visual proposal foregrounds genuine two-song relationships and the act of hearing and judging them; it never treats machine candidates as proven aesthetic matches.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Accepted decision

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

## Implementation checklist - 6/7 Implemented, 0/7 Verified

1. **CI-0176-01 - Design legible phrase bridge.** **Acceptance:** Shared word and both songs obvious with long/multilingual lyric lines. **Required verification:** Text and source provenance screenshots. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** dir="auto" on the phrase, titles, artists and lines in web/src/views/Links.tsx; web/src/views/CreativeInterface.test.tsx "shows the shared words and both songs and lines whole, each in its own direction" (Arabic and long lines) (vitest, passed 2026-11-10).
2. **CI-0176-02 - Prototype bounded song-neighbour graph.** **Acceptance:** Only real links appear and dense sets remain traversable. **Required verification:** Graph capacity and keyboard navigation test. **Implementation:** Implemented (built 2026-11-11); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/RelationshipMap.tsx (MAP_CAPACITY 24 most connected songs, only returned links between kept songs, says how many were left out, and a 'Follow a song on the map' select that lights only that song's real links) behind flag discover.relationship_map; web/src/views/ci-0176-relationship-map.test.tsx 'draws at most its capacity of songs, the most connected, and only returned links between them', 'says how much a dense map left out, and the list stays the full version', 'can be walked song by song from a keyboard control, lighting only that song’s real links'; web/src/views/sfFlowConnections.test.tsx (vitest, 10 passed 2026-11-11).
3. **CI-0176-03 - Visualize real four-stage harmony audition.** **Acceptance:** Current stage and bar match confirmed clip position. **Required verification:** Media playback and chord clock fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Links.test.tsx "shows the chords it read and lights the one being played", "lets you jump to any step", "never calls a requested harmonic stage playing until the media element starts" (vitest, passed 2026-11-10).
4. **CI-0176-04 - Separate candidate from approved claim.** **Acceptance:** Machine suggestion cannot appear human-validated before rating. **Required verification:** Rating and no-audio state audit. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "calls unrated harmony pairs possible, and says an answer changes no mix"; web/src/views/Links.test.tsx "keeps answers out of the way, and they can be changed" (vitest, passed 2026-11-10).
5. **CI-0176-05 - Keep audition and add-to-mix scope.** **Acceptance:** No unsolicited playback or wrong draft addition. **Required verification:** Audio ownership and revision tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Links.test.tsx "pauses the mix when it starts playing", "can go in a draft instead, and leaves what’s playing alone", "goes in as one thing, so half of it can’t be left behind", "stopping really stops, and answering afterwards does not start it again" (vitest, passed 2026-11-10).
6. **CI-0176-06 - Design empty and rejected states.** **Acceptance:** Absent candidates and failed previews remain truthful and recoverable. **Required verification:** No analysis/failed clip/offline scenarios. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Links.test.tsx "says there’s nothing yet when there is nothing to show", "can’t load isn’t the same as nothing there", "says so when a pair cannot be played, and you can still answer", "says so when they cannot be loaded" (vitest, passed 2026-11-10).
7. **CI-0176-07 - Evaluate surprise versus comprehension.** **Acceptance:** Users understand relationship and distinguish hypothesis from confirmation. **Required verification:** Uncoached discovery and blind listening notes. **Implementation:** Needs a person: uncoached discovery and blind listening notes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0155, ADR-0125, ADR-0104; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Accepted; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
