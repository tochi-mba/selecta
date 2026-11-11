# ADR-0172 - Transition Inspector: interpretive seam diagrams and honest A/B audition

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 5/7 Implemented, 0/7 In progress, 2/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0151, ADR-0121, ADR-0101; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/SeamInspector.tsx; web/src/ui/seam.ts; web/src/views/EditorRows.tsx.

## Context and evidence boundary

The Listen, Change, Studio and Details inspector is functional. Its mostly textual and bar-based representation could become an understandable musical object. Comparing an old render and a newly prepared candidate would be valuable but must remain gated on genuine immutable audio artifacts rather than assumed to exist.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, older implementation checkmarks and this docs PR cannot demonstrate that a new CI task is implemented or independently verified.

## Accepted decision

- Present the selected outgoing and incoming song as one stable, named, revision-guarded pair.
- Illustrate cut, overlap, echo/filter, wordplay and stem move with truthful distinct diagrams.
- Separate requested style, planned settings, actually rendered fallback and user quality feedback.
- Unavailable move controls must show why, without sending invalid requests.
- An optional A/B comparison requires immutable playable candidate snapshots and must never invent audio or falsely imply the current API supports it.
- Keep objective signal checks, subjective Good/Bad and actual audio readiness distinctly labeled.

## Visual, animation and microinteraction contract

- Preview cursor follows the media clock and stops on lost focus, error or Stop.
- Editing a planned diagram never visually asserts that a finished render exists.
- Changing seam selection cancels stale preview and inspector result.

## Alternatives and trade-offs

Preserve the current restrained design when a richer animation does not measurably improve comprehension, creative control or delight. Illustrative graphics are not analysed waveforms, beats, timed lyrics, fake quality ratings or album artwork. Every animated interaction needs an accessible static/keyboard equivalent; audio and current/draft correctness outrank motion.

## Implementation checklist - 5/7 Implemented, 0/7 Verified

1. **CI-0172-01 - Define diagram variants by real technique.** **Acceptance:** Each actual move has accurately labeled distinct graphic. **Required verification:** Expert semantic review and rendered examples. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/ui/MusicObjects.test.tsx "never calls an automatic unrendered transition a confirmed technique", "uses the rendered move rather than disguising a fallback as the selected technique" (vitest, passed 2026-11-10); expert semantic review still needs a person.
2. **CI-0172-02 - Preserve pair/revision identity.** **Acceptance:** Inspector never edits or auditions a newly unrelated seam after reorder. **Required verification:** Stale pair, repeated title and race tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "plays the exact render, and the same stays selected when others move", "keeps the latest choice visible when an older server response refreshes the inspector", "never confuses two different drafts with identical songs and transition keys" (vitest, passed 2026-11-10).
3. **CI-0172-03 - Separate intent, render and quality.** **Acceptance:** Requested move and actual fallback never conflated with human rating. **Required verification:** Passed-warning-fallback fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "keeps the move you asked for pressed, and names what really plays separately", "says nothing about a fallback when what played is what was asked for"; web/src/ui/MusicObjects.test.tsx fallback test (vitest, passed 2026-11-10).
4. **CI-0172-04 - Expose disabled-move reasons.** **Acceptance:** Keyboard and pointer can understand unsupported choice. **Required verification:** Cue and tempo-compatibility test. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "greys out the move with its reason on hover and in a list the keyboard can reach" (cue and tempo reasons) (vitest, passed 2026-11-10).
5. **CI-0172-05 - Write optional immutable A/B contract.** **Acceptance:** UI only shows compare when two actual revisions and previews exist. **Required verification:** API feasibility review and provenance check. **Implementation:** Needs a person: API feasibility review and owner decision on an Inspector A/B; today compare exists only in the blind listening test (web/src/views/Listening.test.tsx "won’t let you choose between two you haven’t both heard"); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0172-06 - Integrate auditory focus and cancellation.** **Acceptance:** No overlapping main/preview audio or surprise resume. **Required verification:** Real-media and multi-tab tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/audio/focus.test.tsx "two can’t play at once", "a new preview stops the old one, and the mix waits for the last of them" (vitest, passed 2026-11-10); web/e2e/listen.e2e.ts "a preview takes the sound, and gives it back when it’s done", "only one tab plays at a time" (Playwright, passed 2026-11-10).
7. **CI-0172-07 - Evaluate comprehension and creative control.** **Acceptance:** Novices can hear/change a seam and identify real resulting move. **Required verification:** Observed audition-edit-compare task. **Implementation:** Needs a person: observed audition, edit and compare task; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner and manual Pause, original files and LRCLIB disclosure, scoped mix/draft revisions and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing Library/routes, neutral blind A/B, decodable frozen-revision FLAC and local operation. Test errors, cancel, stale response, missing/RTL names, long set, offline, 320–2560px, zoom, forced colors, reduced motion, touch, keyboard and real audio where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0151, ADR-0121, ADR-0101; reconcile old task status against actual source before implementing.
- **Implementation sequence:** owner decision → visual/state prototype → fixtures → scoped source PR → independent AT/audio/device/human verification → release signoff.
- **Current:** Accepted; Not started; Independently Verified No. There is no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
