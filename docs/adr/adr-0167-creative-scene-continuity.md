# ADR-0167 - Cross-scene continuity, contextual navigation and persistent context

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 6/7 Implemented, 0/7 In progress, 1/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0139, ADR-0140, ADR-0159; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/App.tsx; web/src/router.ts; web/src/shell/Shell.tsx; web/src/shell/manifest.ts.

## Context and evidence boundary

Navigation, history and persistent audio already work. The new question is whether a mix idea becomes the same recognizable work in the editor and whether a seam becomes the same pair in Stem Studio. Object continuity is proposed in addition to existing page transition and focus work.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Accepted decision

- Keep the existing route structure and primary navigation rather than adding a page for each creative feature.
- Carry mix, song and seam identities between discovery, generated sequence, timeline, inspector, Studio and playback.
- Make context-specific actions more prominent than permanent utility controls; command palette remains an accelerator, not the only path.
- Treat current mix and draft as separate visible scopes across navigation and inspection.
- Use shared-object reveals only when the destination is actually available; never conceal an error or start playback.

## Visual, animation and microinteraction contract

- Back/Forward restores real scroll and focus, not a fabricated new creation.
- A selected seam may expand to an inspector/Studio while the pair label stays visible.
- Mobile sheets do not overlap bottom transport or obscure the keyboard input.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist - 6/7 Implemented, 0/7 Verified

1. **CI-0167-01 - Map exact object identity across routes.** **Acceptance:** Mix/scope/seam/song IDs survive navigation and stale responses. **Required verification:** Deep-link and popstate matrix. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/router.test.tsx "every page’s address leads back to it"; web/src/views/Library.test.tsx "resolves a linked song by exact ID outside the current filter and page"; web/src/views/Mix.test.tsx "never confuses two different drafts with identical songs and transition keys", "stop and catch up if the mix has moved on" (vitest, passed 2026-11-10).
2. **CI-0167-02 - Storyboard mix idea to generated sequence.** **Acceptance:** The selected concept remains identifiable without false rendered state. **Required verification:** Confirmed-build fixture and review video. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/CreativeInterface.test.tsx "names the idea with the server’s own song count, opens the editor, and claims nothing rendered"; web/src/views/CurrentMix.test.tsx "tracks the exact returned song order without adding an audio action" (vitest, passed 2026-11-10).
3. **CI-0167-03 - Storyboard seam to Inspector to Studio.** **Acceptance:** Same pair/revision and audio owner always preserved. **Required verification:** Open/close/reorder conflict test. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "opens beside the timeline, for the two songs it’s between", "plays the exact render, and the same stays selected when others move"; web/src/views/Studio.test.tsx "shows which numbered pair is being shaped", "a mix that moved on refuses the shape, and it stays here to try again" (vitest, passed 2026-11-10); web/e2e/finishing.e2e.ts "a transition’s tabs work from the keyboard, and it stays clear which pair they’re about" (Playwright, passed 2026-11-10).
4. **CI-0167-04 - Prioritize contextual actions in shell.** **Acceptance:** Primary creation and request actions clear without utility clutter. **Required verification:** Keyboard/desktop/mobile focus review. **Implementation:** Needs a person: keyboard, desktop and mobile focus review of shell action priority; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** web/src/App.test.tsx request shortcuts "are a press away on any page" and "aren’t on pages they’d get in the way of".
5. **CI-0167-05 - Design responsive panel and return path.** **Acceptance:** Closing sheet returns to originating song/seam with meaningful focus. **Required verification:** Escape, nested modal and 320px tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mix.test.tsx "closes when told to" (vitest, passed 2026-11-10); web/e2e/flows.e2e.ts "keyboard alone gets from the top of the page to the content, and dialogs give focus back", web/e2e/finishing.e2e.ts "the keyboard alone can request a song, cancel it, and get back to where it was" (Playwright, passed 2026-11-10).
6. **CI-0167-06 - Protect playback through page transitions.** **Acceptance:** No route change unexpectedly plays, seeks or resumes audio. **Required verification:** Real audio multitab and manual Pause audit. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/listen.e2e.ts "moving around the app leaves the music alone, and the mini-player follows", "only one tab plays at a time", "a preview takes the sound, and gives it back when it’s done" (Playwright, passed 2026-11-10); web/src/audio/focus.test.tsx "never restarts the mix after someone has pressed something themselves" (vitest, passed 2026-11-10).
7. **CI-0167-07 - Test stale state and deep-link recovery.** **Acceptance:** Missing draft or late build never steals navigation or changes wrong mix. **Required verification:** Network-race and missing-route tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/App.test.tsx "says so if the draft has gone, rather than quietly showing another mix"; web/src/views/Library.test.tsx "never opens another song if a deep-link ID is missing, and can retry", "only the newest search counts, however the answers arrive" (vitest, passed 2026-11-10); web/e2e/flows.e2e.ts "a draft that’s been deleted is explained, and never quietly swapped for another mix", web/e2e/pages.e2e.ts "addresses that go nowhere say so" (Playwright, passed 2026-11-10).

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0139, ADR-0140, ADR-0159; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation 6/7 Implemented (0 in progress, 1 need a person) on feat/finish-checklists, 2026-11-10; Independently Verified No.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
