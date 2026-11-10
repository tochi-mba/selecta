# ADR-0058: Context-preserving seam inspector, exact cues and honest rendered outcome

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 9 of 9 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 - Creation workspaces
- **Extends existing decisions:** ADR-0014, ADR-0016, ADR-0027, ADR-0040
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The current inspector has Listen, Change, Studio and Details tabs, manual cue and transition-style choices, preview, fallback, Good/Bad and a renderer audit. These powerful functions are too easily conflated with one another when an old render finishes after the user changes intent.

## Decision proposed

Keep the four feature families but redesign around permanent outgoing/incoming song identity and layered requested, in-flight, rendered and audible state. Editing precision must never silently rewrite the user's chosen style or cue.

## Experience and frontend architecture

- Keep a pair header visible while scrolling and expose current/draft identity. The Listen tab owns a revision-aware preview; Change groups feel, duration, phrase and entry/exit cues; Studio routes to its full workspace; Details distinguishes recommended, requested, actual fallback and the evidence for each.

- Disable impossible choices with a truthful reason and show valid cue ranges. Any frontend Apply step must be weighed against actual render cost and previous interaction efficiency. Avoid rerender per incidental focus change; preserve explicit intent until confirmation or a safe revert.

- The inspector sheet on mobile restores timeline focus and scroll on close. A selected pair that disappears after reorder/removal must not mutate an adjacent pair.

## Detailed implementation work

1. **S3-0058-01 - Implemented.** Design an always-visible pair identity header with exact scope, selection and renderer revision. **Evidence:** inspector-identity in web/src/views/SeamInspector.tsx (pair, Transition N, current or draft, render version); web/src/views/Mix.test.tsx 'opens beside the timeline, for the two songs it’s between'; web/e2e/finishing.e2e.ts 'a transition’s tabs work from the keyboard, and it stays clear which pair they’re about' (passed 2026-11-10).
2. **S3-0058-02 - Implemented.** Implement Listen tab with revision-matched preview and single audio-owner behavior. **Evidence:** AudioPreview keyed by the rendered seam in web/src/views/SeamInspector.tsx; web/src/views/Mix.test.tsx 'plays the exact render, and the same stays selected when others move'; web/src/audio/focus.test.tsx 'two can’t play at once' (passed 2026-11-10).
3. **S3-0058-03 - Implemented.** Group Change controls by style, length and exact cue with accessible form validation. **Evidence:** grouped fieldsets and aria-invalid cues in web/src/views/SeamInspector.tsx; web/src/views/Mix.test.tsx 'marks both cue fields invalid, says why, and keeps the server’s choice' (passed 2026-11-10).
4. **S3-0058-04 - Implemented.** Preserve all existing seam styles, phrase alignment, bar lengths, out/in positions, warnings and fallback options. **Evidence:** web/e2e/flows.e2e.ts 'a transition’s inspector: its four areas, and a change of move renders the new one'; web/src/views/Mix.test.tsx 'says when it’s been held back to give the song a turn'; tests/test_seam_correction_locks.py (passed 2026-11-10).
5. **S3-0058-05 - Implemented.** Expose requested/manual versus actual rendered/fallback state without conflating readiness. **Evidence:** web/src/views/Mix.test.tsx 'keeps the move you asked for pressed, and names what really plays separately', 'says nothing about a fallback when what played is what was asked for' and 'says what you chose and what will really play, if they differ' (passed 2026-11-10).
6. **S3-0058-06 - Implemented.** Keep Details audit hierarchy: actual move, selected move, music data, failed alternatives, quality checks. **Evidence:** Details tab in web/src/views/SeamInspector.tsx (what will play, the music, what else was tried, quality checks); web/src/views/Mix.test.tsx 'has everything about it a tab away' (passed 2026-11-10).
7. **S3-0058-07 - Implemented.** Make transition ratings identify the precise seam and survive route switching. **Evidence:** web/src/views/Mix.test.tsx 'posts to that seam alone, and shows the saved rating again after a remount'; web/src/views/Now.test.tsx 'rates the transition that just played, by its key, and explains what was measured' (passed 2026-11-10).
8. **S3-0058-08 - Implemented.** Rebuild mobile inspector as a focus-safe sheet/workspace without losing timeline context. **Evidence:** Sheet for narrow screens in web/src/views/Mix.tsx; web/src/ui/controls.test.tsx 'take focus, keep it inside, and give it back'; web/e2e/pages.e2e.ts 'on a phone, nothing you can press sits half hidden behind the player, at any height' (passed 2026-11-10).
9. **S3-0058-09 - Implemented.** Add stale-render, exact-pair, cue-invalid and preview-cancellation tests. **Evidence:** web/src/views/Mix.test.tsx 'keeps the latest choice visible when an older server response refreshes the inspector', 'never confuses two different drafts with identical songs and transition keys' and 'marks both cue fields invalid, says why, and keeps the server’s choice'; web/src/audio/focus.test.tsx 'leaving the page lets the sound go, and the mix carries on'; web/e2e/finishing.e2e.ts 'two quick seam changes on a slow server: the last one wins, and Undo shows what’s really there' (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Change style during render, then receive old result; never rewrite new intent or wrongly label audio.
- Remove selected track while inspector is open; old actions must not target another seam.
- Manual cue invalid for style; fallback while playing; preview begins then user pauses main mix; no unexpected auto-resume.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A single 'AI improves transition' button would hide exact expert control; exposing raw renderer internals by default overwhelms listeners. Progressive control and truthful diagnostics preserve both.

## Acceptance and evidence

The interface always identifies exactly which audio and cue settings were requested, rendered, previewed and committed.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (9/9) | Task-by-task evidence on each item; 0 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
