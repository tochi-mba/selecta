# ADR-0206 - Honest cover art, song motifs and Mix Sleeves

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Visual identity.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0166/0177/0179; no historical status is changed.
- **Existing source touchpoints:** web/src/ui/MusicObjects.tsx; web/src/views/Drafts.tsx.

## Context and evidence boundary

Use genuine local covers when available and deterministic decorative identity otherwise. Give completed mixes cohesive sleeves without pretending generated artwork is actual album art. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Use genuine local covers when available and deterministic decorative identity otherwise. Give completed mixes cohesive sleeves without pretending generated artwork is actual album art. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Never infer actual album art, music quality, genre or mood from a hash. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0206-01 - Define artwork provenance.** **Acceptance:** Real, decorative and measured identities distinguishable. **Required verification:** Metadata contract audit. **Implementation:** Implemented; song and idea pictures are typed as decorative motifs, never cover art, and requested and measured values stay apart; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'gives idea groups distinct, stable abstract motifs without pretending to show album art', 'keeps requested and measured energy explicitly separate'; run 2026-11-10.
2. **SF-0206-02 - Build deterministic song motifs.** **Acceptance:** Stable ID produces stable repeatable identity. **Required verification:** Duplicate-title and refresh test. **Implementation:** Implemented; a song motif depends only on its library ID, so duplicate titles differ and a refresh draws the same mark; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork'; run 2026-11-10.
3. **SF-0206-03 - Handle actual cover media.** **Acceptance:** Corrupt, missing and oversized images safe. **Required verification:** Media-fixture tests. **Implementation:** Not started; Superseded by ADR-0345: Selecta reads and shows no cover media at all, and ADR-0345 (LX-0345-02, Implemented) decided only documented artwork may ever be shown, with motifs otherwise, so there is no corrupt, missing or oversized image to harden; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0206-04 - Design Mix Sleeve component.** **Acceptance:** Mix object looks consistent across surfaces. **Required verification:** Cross-route snapshots. **Implementation:** Implemented; one `MixSignature` sleeve, drawn only from the returned song order, now appears on the current mix and (compact, same strokes) on every draft in My Mixes; `/api/drafts` sends each draft's `song_ids` in order, and an older server that sends none gets no sleeve; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/sf0206MixSleeve.test.tsx` 'the compact sleeve draws the same strokes as the full one', 'a draft in My Mixes wears the sleeve the current mix would wear for the same song order'; `tests/test_drafts.py::test_the_list_says_where_each_draft_has_got_to` (song_ids); run 2026-11-10.
5. **SF-0206-05 - Create a limited art-family system.** **Acceptance:** Options fit product aesthetic. **Required verification:** Theme gallery. **Implementation:** Not started; Needs a person: a theme-gallery review of a limited art-family system; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0206-06 - Guard local-only media access.** **Acceptance:** No unrequested remote song/image upload. **Required verification:** Network inspection. **Implementation:** Implemented; the page only talks to its own local server; no song or image leaves the computer; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer'; run 2026-11-10.
7. **SF-0206-07 - Validate legibility over art.** **Acceptance:** Contrast, crop and 320px usability. **Required verification:** Responsive test. **Implementation:** Not started; Needs a person: a responsive legibility review (no text sits over artwork today); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0206-08 - Preserve identity through revision.** **Acceptance:** Current and draft never show wrong sleeves. **Required verification:** Revision/source tests. **Implementation:** Implemented; the mix picture comes from the returned song order of that scope, so current and draft never share a wrong one; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'keeps a mix unique to its returned song order without claiming a waveform'; `web/src/views/CurrentMix.test.tsx`; `web/e2e/integration.e2e.ts` 'editing a draft while the current mix plays: neither touches the other'; run 2026-11-10.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0166/0177/0179 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
