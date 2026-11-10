# Selecta / Flow - per-task implementation and independent verification evidence ledger

**50 Accepted ADRs, 400 new SF tasks Not started, 0 In progress, 0 Implemented, 0 independently Verified.** All owner, implementing PR/SHA and independent evidence fields are unassigned. Baseline: main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15` (2026-11-08). The planning PR is not an implementing PR.

| SF task | ADR | Implementation | Independently Verified | Owner | Implementing PR / SHA | Evidence / reviewer |
|---|---|---|---|---|---|---|
| SF-0198-01 | [ADR-0198](adr-0198-artistic-product-charter.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/shell/mpSurfaceInventory.test.ts` (MP-0272 surface inventory, passed 2026-11-10); `docs/adr/completion/journeys.md`; `docs/adr/completion/route-state-register.md` |
| SF-0198-02 | [ADR-0198](adr-0198-artistic-product-charter.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a light/dark design critique and a five-second study to define and judge three scene modes |
| SF-0198-03 | [ADR-0198](adr-0198-artistic-product-charter.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/selecta-flow-feature-parity.md`; `web/e2e/listen.e2e.ts` (17 tests incl. 'media keys do what they say', 'only one tab plays at a time'); `web/e2e/flows.e2e.ts` 'saving a mix as an audio file makes a real FLAC', 'drafts: make one, name it, fill it, and it stays apart from the current mix', 'requests: asking, then seeing it find a place, and cancelling for good'; `web/e2e/finishing.e2e.ts` 'the full Studio grid works at the smallest size'; `web/src/audio/focus.test.tsx`; all run 2026-11-10 |
| SF-0198-04 | [ADR-0198](adr-0198-artistic-product-charter.md) | Not started; needs a person | No | Unassigned | - | Needs a person: real listening observation to set and judge attention and interruption budgets |
| SF-0198-05 | [ADR-0198](adr-0198-artistic-product-charter.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/controls.test.tsx` 'scope-safe Undo history', 'Undo runs what that message was about'; `web/src/App.test.tsx` 'asks before replacing an active mix with a draft, and cancel leaves playback untouched'; `web/src/audio/focus.test.tsx` 'never restarts the mix after someone has pressed something themselves'; `web/e2e/listen.e2e.ts` 'Pause stops the clock, and Resume carries on from the same place'; run 2026-11-10 |
| SF-0198-06 | [ADR-0198](adr-0198-artistic-product-charter.md) | Not started; needs a person | No | Unassigned | - | Needs a person: novice and DJ task tests with participants |
| SF-0198-07 | [ADR-0198](adr-0198-artistic-product-charter.md) | Not started; needs a person | No | Unassigned | - | Needs a person: owner approval of art-first success metrics and a participant protocol |
| SF-0198-08 | [ADR-0198](adr-0198-artistic-product-charter.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/router.test.tsx` (5 tests); `web/e2e/pages.e2e.ts` 'reloading any page stays on it', 'Back and Forward go where they should', 'addresses that go nowhere say so'; run 2026-11-10 |
| SF-0199-01 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `git cat-file -t c3715b14` = commit and `git merge-base --is-ancestor c3715b14 HEAD` true on 2026-11-10; recorded in `docs/adr/adr-0199-historical-status-reconciliation.md` Reconciliation record |
| SF-0199-02 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | In progress | No | Unassigned | - | the state matrix exists and is machine-checked (`web/src/shell/mpSurfaceInventory.test.ts`, passed 2026-11-10); a full screenshot capture run (`web/e2e/mp-baseline.mp.ts`, `web/e2e/paired-theme.e2e.ts`) was not done in this session |
| SF-0199-03 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/adr-0199-historical-status-reconciliation.md` (Existing features versus new design outcomes, 2026-11-10); `docs/adr/selecta-flow-status-reconciliation.md` |
| SF-0199-04 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/adr-0199-historical-status-reconciliation.md` Source test catalogue (2026-11-10) |
| SF-0199-05 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/adr-0199-historical-status-reconciliation.md` Screen review protocol (2026-11-10); `docs/adr/completion/visual-evidence.md` |
| SF-0199-06 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a real-hardware baseline (OS, browser, CPU/GPU, background load) recorded with a reproducible benchmark on the owner's machine |
| SF-0199-07 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/adr-0199-historical-status-reconciliation.md` Known existing limitations (2026-11-10) |
| SF-0199-08 | [ADR-0199](adr-0199-historical-status-reconciliation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `python src/selecta/audit/checklist_evidence.py` passed 2026-11-10; `tests/test_checklist_evidence.py` (6 passed) |
| SF-0200-01 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: designers producing three directions as side-by-side responsive boards |
| SF-0200-02 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a blind brand-comprehension study |
| SF-0200-03 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a both-theme specimen review of surface, depth and grain |
| SF-0200-04 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a five-second task comprehension study of editorial layouts |
| SF-0200-05 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a design judgement that the look holds together with absent media |
| SF-0200-06 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a screenshot contrast review that light and dark were each designed on their own terms |
| SF-0200-07 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a review against a diverse real library for genre or mood assumptions |
| SF-0200-08 | [ADR-0200](adr-0200-art-direction.md) | Not started; needs a person | No | Unassigned | - | Needs a person: owner approval of a direction, its criteria and rollback |
| SF-0201-01 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/tokens.css`; `docs/adr/completion/theme-and-edges.md`; `web/src/styles/spacing-tokens.test.ts`, `typography.test.ts`, `css-ownership.test.ts` (passed 2026-11-10) |
| SF-0201-02 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a dark specimen review in dim settings |
| SF-0201-03 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a light specimen review |
| SF-0201-04 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/controls.test.tsx` 'never rely on colour alone'; `web/src/ui/MusicObjects.test.tsx` 'keeps queued, rendering, failed and rendered Thread states distinct without inventing sound'; `web/e2e/flow-forced-colors.e2e.ts`; run 2026-11-10 |
| SF-0201-05 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/pages.e2e.ts` 'every page passes the automatic accessibility checks in light', '... in dark', 'dialogs and drawers pass the automatic accessibility checks too'; run 2026-11-10 |
| SF-0201-06 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/flow-forced-colors.e2e.ts` 'forced colours keep controls visible, and selection and focus distinct', 'forced colours keep the Listen transport and seek strip usable' (Edge, forced-colors emulated; 2026-11-10) |
| SF-0201-07 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'changing the theme while playing starts nothing again, and the title bar follows', 'a manual theme and browser chrome agree before app JavaScript, even when the OS disagrees'; run 2026-11-10 |
| SF-0201-08 | [ADR-0201](adr-0201-semantic-colour-themes.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a reviewer approving a screenshot gallery of every screen at mobile and desktop in both themes |
| SF-0202-01 | [ADR-0202](adr-0202-typography.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/typography.test.ts` (MP-0275, passed 2026-11-10) |
| SF-0202-02 | [ADR-0202](adr-0202-typography.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/typography.test.ts`; `web/e2e/pages.e2e.ts` 'nothing goes wider than the window, from the smallest phone to 4K', 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go'; run 2026-11-10 |
| SF-0202-03 | [ADR-0202](adr-0202-typography.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/typography.test.ts` 'time, BPM, percentage and count surfaces are tabular'; `web/src/styles/optical-alignment.test.ts`; run 2026-11-10 |
| SF-0202-04 | [ADR-0202](adr-0202-typography.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'long, right-to-left and duplicate names stay readable and whole at the smallest size'; `web/src/styles/typography.test.ts` 'Library and editor song names resolve their own direction'; run 2026-11-10 |
| SF-0202-05 | [ADR-0202](adr-0202-typography.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an AT and touch check that a truncated name is fully available |
| SF-0202-06 | [ADR-0202](adr-0202-typography.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/flow-fonts.test.ts` (2 passed); `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer'; run 2026-11-10 |
| SF-0202-07 | [ADR-0202](adr-0202-typography.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a reading study of dialog and information copy |
| SF-0202-08 | [ADR-0202](adr-0202-typography.md) | Not started; needs a person | No | Unassigned | - | Needs a person: design sign-off of type in both themes |
| SF-0203-01 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/css-ownership.test.ts` (ADR-278, passed 2026-11-10) |
| SF-0203-02 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/spacing-tokens.test.ts`; `web/e2e/spacing-rhythm.e2e.ts` 'MP-0273-01 spacing tokens resolve to the documented scale', 'MP-0273-04 headings keep a 12-48px rhythm'; run 2026-11-10 |
| SF-0203-03 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/layer-precedence.test.ts`; `docs/engineering/layer-precedence.md`; `web/e2e/overlay-arbitration.e2e.ts` (dialog actions at each size, software keyboard); run 2026-11-10 |
| SF-0203-04 | [ADR-0203](adr-0203-spatial-composition.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a visual critique of nested cards |
| SF-0203-05 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/spacing-rhythm.e2e.ts` 'MP-0273-06 compact rows stay readable with 24px targets, 44px on touch'; run 2026-11-10 |
| SF-0203-06 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/flow-narrow.e2e.ts` 'at 320px the inspector and the mini-player are both reachable while the music plays'; `web/e2e/finishing.e2e.ts` 'the full Studio grid works at the smallest size'; run 2026-11-10 |
| SF-0203-07 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/flows.e2e.ts` 'focus is never hidden behind the bottom bar on a phone'; `web/e2e/overlay-arbitration.e2e.ts` 'software keyboard makes notification chrome yield'; `web/e2e/finishing.e2e.ts` 'with an on-screen keyboard up, what's being typed gets the room'; `web/e2e/pages.e2e.ts` zoom test; run 2026-11-10 |
| SF-0203-08 | [ADR-0203](adr-0203-spatial-composition.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'pages hold their shape while they load, even when every answer is slow'; `web/e2e/integration.e2e.ts` 'a hundred quick looks at a page never lose what's on it'; run 2026-11-10 |
| SF-0204-01 | [ADR-0204](adr-0204-primitives.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `docs/adr/completion/components.md`; `web/src/ui/ControlGallery.tsx`; `web/src/ui/controls.test.tsx` 'a button that takes time' (5 tests), 'states'; run 2026-11-10 |
| SF-0204-02 | [ADR-0204](adr-0204-primitives.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a usability test that each page's primary action is unique and reachable |
| SF-0204-03 | [ADR-0204](adr-0204-primitives.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an NVDA icon audit |
| SF-0204-04 | [ADR-0204](adr-0204-primitives.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'a folder that can't be used says why and what to try', 'a slow search can't replace a newer one, and typing keeps its place'; `web/e2e/flows.e2e.ts` 'a change that couldn't be sent says so'; run 2026-11-10 |
| SF-0204-05 | [ADR-0204](adr-0204-primitives.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/controls.test.tsx` 'things on top of the page', 'a menu', 'a tooltip'; `web/e2e/flows.e2e.ts` 'keyboard alone gets from the top of the page to the content, and dialogs give focus back'; run 2026-11-10 |
| SF-0204-06 | [ADR-0204](adr-0204-primitives.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/flow-forced-colors.e2e.ts` 'forced colours keep controls visible, and selection and focus distinct' (2026-11-10) |
| SF-0204-07 | [ADR-0204](adr-0204-primitives.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/controls.test.tsx` 'Undo confirmation timing', 'says so if undoing fails'; `web/e2e/finishing.e2e.ts` 'two quick seam changes on a slow server: the last one wins, and Undo shows what's really there'; run 2026-11-10 |
| SF-0204-08 | [ADR-0204](adr-0204-primitives.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an independent visual review of all primitive states in both themes |
| SF-0205-01 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/motion-tokens.test.ts` (ADR-296, passed 2026-11-10); `docs/engineering/motion-inventory.md` |
| SF-0205-02 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/styles/motion-tokens.test.ts`; `web/e2e/motion-preference.e2e.ts`; run 2026-11-10 |
| SF-0205-03 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/motion-preference.e2e.ts` 'motion intensity is local and OS reduced-motion always wins'; `web/src/views/Now.test.tsx` 'keeps visual intensity independent from playback and remembers the choice'; run 2026-11-10 |
| SF-0205-04 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/useReducedMotion.test.tsx` 'honours the operating system even when Expressive is selected'; `web/e2e/finishing.e2e.ts` 'with reduced motion nothing keeps moving by itself, on any page'; run 2026-11-10 |
| SF-0205-05 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/spectrumVisuals.test.ts` (16 tests); `web/e2e/listen.e2e.ts` 'Play makes real sound, on a clock that really moves', 'a transition takes over exactly where it was planned, with no gap'; run 2026-11-10 |
| SF-0205-06 | [ADR-0205](adr-0205-sensory-motion.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/listen.e2e.ts` 'Next and Previous go song by song, however fast they're pressed'; `web/e2e/integration.e2e.ts` 'a hundred quick looks at a page never lose what's on it'; `web/e2e/finishing.e2e.ts` 'fullscreen refused: ... Escape gets out, focus comes back'; run 2026-11-10 |
| SF-0205-07 | [ADR-0205](adr-0205-sensory-motion.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a real-hardware CPU/GPU and power profile |
| SF-0205-08 | [ADR-0205](adr-0205-sensory-motion.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a counterbalanced participant study of comfort and delight |
| SF-0206-01 | [ADR-0206](adr-0206-music-artwork.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'gives idea groups distinct, stable abstract motifs without pretending to show album art', 'keeps requested and measured energy explicitly separate'; run 2026-11-10 |
| SF-0206-02 | [ADR-0206](adr-0206-music-artwork.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork'; run 2026-11-10 |
| SF-0206-03 | [ADR-0206](adr-0206-music-artwork.md) | Not started | No | Unassigned | - | Selecta reads no embedded or remote cover art today, so there is no cover media to harden; motifs stand in (SF-0206-02) |
| SF-0206-04 | [ADR-0206](adr-0206-music-artwork.md) | In progress | No | Unassigned | - | `MixSignature` (stable from returned song order) is shown on the current mix only; drafts lack song order to draw one, so it is not yet one sleeve across surfaces |
| SF-0206-05 | [ADR-0206](adr-0206-music-artwork.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a theme-gallery review of a limited art-family system |
| SF-0206-06 | [ADR-0206](adr-0206-music-artwork.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/pages.e2e.ts` 'the page only ever talks to this computer'; run 2026-11-10 |
| SF-0206-07 | [ADR-0206](adr-0206-music-artwork.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a responsive legibility review (no text sits over artwork today) |
| SF-0206-08 | [ADR-0206](adr-0206-music-artwork.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'keeps a mix unique to its returned song order without claiming a waveform'; `web/src/views/CurrentMix.test.tsx`; `web/e2e/integration.e2e.ts` 'editing a draft while the current mix plays: neither touches the other'; run 2026-11-10 |
| SF-0207-01 | [ADR-0207](adr-0207-the-thread.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback', 'never calls an automatic unrendered transition a confirmed technique', 'keeps queued, rendering, failed and rendered Thread states distinct'; run 2026-11-10 |
| SF-0207-02 | [ADR-0207](adr-0207-the-thread.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/controls.test.tsx` 'never rely on colour alone'; `web/e2e/flow-forced-colors.e2e.ts`; run 2026-11-10 |
| SF-0207-03 | [ADR-0207](adr-0207-the-thread.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/player.test.ts` 'keeps the later occurrence when the same recording appears twice', 'previous and seek do not jump to the first copy'; `web/src/views/Mix.test.tsx` occurrence labels; run 2026-11-10 |
| SF-0207-04 | [ADR-0207](adr-0207-the-thread.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an NVDA session on the Thread descriptions |
| SF-0207-05 | [ADR-0207](adr-0207-the-thread.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a 320-2560 visual fixture review of compact and expanded forms |
| SF-0207-06 | [ADR-0207](adr-0207-the-thread.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'keeps requested and measured energy explicitly separate', 'keeps unknown song energy as an unknown gap'; run 2026-11-10 |
| SF-0207-07 | [ADR-0207](adr-0207-the-thread.md) | In progress | No | Unassigned | - | SongMotif and SeamDiagram are one component each, reused on Listen, Edit, Inspector, Library, Requests, Studio and Lucy; no cross-route test proves the shared contract yet |
| SF-0207-08 | [ADR-0207](adr-0207-the-thread.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a user comprehension study of planned, playing and ready |
| SF-0208-01 | [ADR-0208](adr-0208-navigation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/router.test.tsx` 'every page's address leads back to it'; `web/src/shell/mpSurfaceInventory.test.ts`; `web/e2e/pages.e2e.ts` 'addresses that go nowhere say so'; run 2026-11-10 |
| SF-0208-02 | [ADR-0208](adr-0208-navigation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a findability study of desktop navigation |
| SF-0208-03 | [ADR-0208](adr-0208-navigation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'the mini-player and bottom bar never overlap, and the last row can always be reached'; `web/e2e/pages.e2e.ts` 'on a phone, nothing you can press sits half hidden behind the player, at any height'; run 2026-11-10 |
| SF-0208-04 | [ADR-0208](adr-0208-navigation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/router.test.tsx` 'moving around' (4 tests); `web/e2e/pages.e2e.ts` 'Back and Forward go where they should', 'reloading any page stays on it', 'the Library's filters are part of its address'; run 2026-11-10 |
| SF-0208-05 | [ADR-0208](adr-0208-navigation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Mix.test.tsx` 'keeps each mix scope's exact selection separate when the mounted editor switches scope'; `web/src/App.test.tsx` 'opens from the list without touching the current mix, and stays open after a reload'; `web/e2e/pages.e2e.ts` 'the Library's filters are part of its address'; run 2026-11-10 |
| SF-0208-06 | [ADR-0208](adr-0208-navigation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an NVDA session on focus and scroll restoration |
| SF-0208-07 | [ADR-0208](adr-0208-navigation.md) | Not started | No | Unassigned | - | routes reveal with a CSS animation (polish.css route-reveal, off under reduced motion); no View Transitions API prototype with feature detection exists yet |
| SF-0208-08 | [ADR-0208](adr-0208-navigation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/listen.e2e.ts` 'moving around the app leaves the music alone, and the mini-player follows'; run 2026-11-10 |
| SF-0209-01 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/player.ts` NowState; `web/src/player.test.ts` (32 tests incl. 'stops and says why when the last song won't load', 'never claims sound started when the context is closed'); run 2026-11-10 |
| SF-0209-02 | [ADR-0209](adr-0209-persistent-player.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a wide and shallow visual review of the desktop transport |
| SF-0209-03 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'the mini-player and bottom bar never overlap' (320-430 and landscape); `web/e2e/overlay-arbitration.e2e.ts` 'software keyboard makes notification chrome yield without removing notices or the mini-player'; run 2026-11-10 |
| SF-0209-04 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/listen.e2e.ts` 'Play makes real sound, on a clock that really moves', 'a transition takes over exactly where it was planned, with no gap'; `web/src/player.test.ts` 'never shows a time past the end of the song'; run 2026-11-10 |
| SF-0209-05 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/audio/focus.test.tsx` (13 tests); `web/e2e/listen.e2e.ts` 'a preview takes the sound, and gives it back when it's done', 'only one tab plays at a time'; run 2026-11-10 |
| SF-0209-06 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'changing the theme while playing starts nothing again'; `web/e2e/listen.e2e.ts` 'moving around the app leaves the music alone'; `web/src/audio/focus.test.tsx` 'does not revive a mix after the listener pauses while a slow suspension is pending'; run 2026-11-10 |
| SF-0209-07 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/audio/mediaSession.test.ts` (3 tests); `web/e2e/listen.e2e.ts` 'media keys do what they say'; run 2026-11-10 |
| SF-0209-08 | [ADR-0209](adr-0209-persistent-player.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'playing doesn't flood a screen reader: the song is said once, and the clock never is'; `web/e2e/listen.e2e.ts` 'the keyboard works the player'; `web/e2e/pages.e2e.ts` axe; run 2026-11-10 |
| SF-0210-01 | [ADR-0210](adr-0210-listening-theatre.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a dark/light first-glance review of the song-first hero |
| SF-0210-02 | [ADR-0210](adr-0210-listening-theatre.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/pages.e2e.ts` 'on a phone, Listen keeps display options after the song identity and transport reachable', landscape and zoom overflow tests; run 2026-11-10 |
| SF-0210-03 | [ADR-0210](adr-0210-listening-theatre.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.test.tsx` 'missing or invalid song duration', 'beat-grid transition countdown'; `web/e2e/listen.e2e.ts` 'a song's audio going missing says so', 'a transition that isn't ready doesn't stop the music', 'the end of the mix comes to a stop'; run 2026-11-10 |
| SF-0210-04 | [ADR-0210](adr-0210-listening-theatre.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork'; `web/src/views/Now.tsx` TrackTitle; run 2026-11-10 |
| SF-0210-05 | [ADR-0210](adr-0210-listening-theatre.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.test.tsx` 'keeps expert view controls discoverable without competing with playback'; run 2026-11-10 |
| SF-0210-06 | [ADR-0210](adr-0210-listening-theatre.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a visual review during real playback that lyrics and Up Next never cover transport or text |
| SF-0210-07 | [ADR-0210](adr-0210-listening-theatre.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops'; `web/e2e/listen.e2e.ts` 'lyrics follow the song, and the fullscreen view keeps everything working'; run 2026-11-10 |
| SF-0210-08 | [ADR-0210](adr-0210-listening-theatre.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a comparative music study of listener preference |
| SF-0211-01 | [ADR-0211](adr-0211-real-handoff.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/player.test.ts` 'transition readiness deadlines' (5 tests); `web/src/views/Now.test.tsx` 'beat-grid transition countdown', 'uses chronological seconds when the next handoff has no valid beat grid'; run 2026-11-10 |
| SF-0211-02 | [ADR-0211](adr-0211-real-handoff.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a DJ audio review of cut, blend, wordplay and stem treatments |
| SF-0211-03 | [ADR-0211](adr-0211-real-handoff.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/player.test.ts` 'keeps the later occurrence when the same recording appears twice', 'asks for the next seam once'; `web/src/views/Now.test.tsx`; run 2026-11-10 |
| SF-0211-04 | [ADR-0211](adr-0211-real-handoff.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/listen.e2e.ts` 'a transition takes over exactly where it was planned, with no gap'; `web/src/views/Now.test.tsx` beat-grid countdown tests; run 2026-11-10 |
| SF-0211-05 | [ADR-0211](adr-0211-real-handoff.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback as the selected technique'; `web/e2e/listen.e2e.ts` 'a transition that isn't ready doesn't stop the music'; run 2026-11-10 |
| SF-0211-06 | [ADR-0211](adr-0211-real-handoff.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/player.test.ts` 'a transition already sounding can't be taken back', 'ignores a failed fallback download after the listener seeks elsewhere', 'seeking while paused stays paused'; `web/e2e/listen.e2e.ts` 'seeking past the way out still gets to the next song'; run 2026-11-10 |
| SF-0211-07 | [ADR-0211](adr-0211-real-handoff.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an NVDA test of the hand-off's written and spoken equivalents |
| SF-0211-08 | [ADR-0211](adr-0211-real-handoff.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a counterbalanced listener study of artistic payoff |
| SF-0212-01 | [ADR-0212](adr-0212-visualizer-curation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/spectrumVisuals.test.ts` (16 tests); run 2026-11-10 |
| SF-0212-02 | [ADR-0212](adr-0212-visualizer-curation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a screen gallery review of palette and composition for every mode |
| SF-0212-03 | [ADR-0212](adr-0212-visualizer-curation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a preference study of selector grouping |
| SF-0212-04 | [ADR-0212](adr-0212-visualizer-curation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/spectrumVisuals.test.ts` 'groups only actual nonzero bins, keeps silence at zero and refuses absent signal', 'caps afterglow to seven real sampled frames, records silence'; run 2026-11-10 |
| SF-0212-05 | [ADR-0212](adr-0212-visualizer-curation.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/creative-visualizers.e2e.ts` 'all thirteen additional horizontal visualizers are selectable without restarting real audio'; `web/src/views/Now.test.tsx` 'lets the listener choose a full-width real-data frequency ribbon without changing playback'; run 2026-11-10 |
| SF-0212-06 | [ADR-0212](adr-0212-visualizer-curation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: CPU and GPU profiles on real hardware |
| SF-0212-07 | [ADR-0212](adr-0212-visualizer-curation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an NVDA and comfort review across all styles |
| SF-0212-08 | [ADR-0212](adr-0212-visualizer-curation.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a listener comparison to justify the default mode |
| SF-0213-01 | [ADR-0213](adr-0213-lyric-stage.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.test.tsx` 'follows the current playback time and keeps the lyric punctuation', 'keeps line lyrics visible when word timing is unavailable'; run 2026-11-10 |
| SF-0213-02 | [ADR-0213](adr-0213-lyric-stage.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a listening test that Focus lyrics stay unobtrusive |
| SF-0213-03 | [ADR-0213](adr-0213-lyric-stage.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.test.tsx` 'can read a full static lyric sheet and resume following without affecting audio'; run 2026-11-10 |
| SF-0213-04 | [ADR-0213](adr-0213-lyric-stage.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops'; run 2026-11-10 |
| SF-0213-05 | [ADR-0213](adr-0213-lyric-stage.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/NowFlow.test.tsx` 'names the shared words while a rendered word move plays', 'says nothing about words for a fallback / another move / an unfinished render' (4 passed); `tests/test_flags.py` (19 passed); `docs/flags.md` regenerated; run 2026-11-10 |
| SF-0213-06 | [ADR-0213](adr-0213-lyric-stage.md) | Not started; needs a person | No | Unassigned | - | Needs a person: Unicode snapshot review of RTL and long lyric lines at 400% zoom |
| SF-0213-07 | [ADR-0213](adr-0213-lyric-stage.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/finishing.e2e.ts` 'playing doesn't flood a screen reader: the song is said once, and the clock never is'; `web/src/views/Now.tsx` lyrics aria-live="off"; run 2026-11-10 |
| SF-0213-08 | [ADR-0213](adr-0213-lyric-stage.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a user reading study with reduced motion |
| SF-0214-01 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/NowFlow.test.tsx` 'reads time, length and time left from the player clock'; `web/src/views/Now.test.tsx` 'keeps a finite, disabled slider and never attempts a seek'; `web/src/player.test.ts` 'never shows a time past the end of the song'; run 2026-11-10 |
| SF-0214-02 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/e2e/flow-narrow.e2e.ts` 'the seek strip takes a tap on a touch screen and arrow keys, at 320px'; `web/e2e/listen.e2e.ts` 'the keyboard works the player'; run 2026-11-10 |
| SF-0214-03 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.test.tsx` 'previews the target without seeking until release'; `web/src/player.test.ts` 'rejects non-finite seeking without changing the playback position'; run 2026-11-10 |
| SF-0214-04 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/Now.tsx` Strip CANT_SEEK note; `web/src/audio/mediaSession.test.ts` 'follows the current song, rejects invalid seeks and refuses seeking during a seam'; `web/e2e/listen.e2e.ts` 'seeking moves within the song, and doesn't set off the transition'; run 2026-11-10 |
| SF-0214-05 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `tests/test_flow_waveform_peaks.py` (3 passed); `web/src/views/NowFlow.test.tsx` 'draws one stroke per measured peak ...', 'draws no waveform, bars, sections or seam mark when analysis has none'; run 2026-11-10 |
| SF-0214-06 | [ADR-0214](adr-0214-time-seek.md) | Implemented | No | Flow checklist agent (Claude) | feat/finish-checklists, 2026-11-10 | `web/src/views/NowFlow.test.tsx` 'draws no waveform, bars, sections or seam mark when analysis has none', '... marks only known sections and the planned seam'; run 2026-11-10 |
| SF-0214-07 | [ADR-0214](adr-0214-time-seek.md) | Not started; needs a person | No | Unassigned | - | Needs a person: a hardware trace of rapid scrubbing for audio dropouts |
| SF-0214-08 | [ADR-0214](adr-0214-time-seek.md) | Not started; needs a person | No | Unassigned | - | Needs a person: an uncoached task test of preview versus commit |
| SF-0215-01 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-02 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-03 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-04 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-05 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-06 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-07 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0215-08 | [ADR-0215](adr-0215-up-next.md) | Not started | No | Unassigned | - | - |
| SF-0216-01 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-02 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-03 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-04 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-05 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-06 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-07 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0216-08 | [ADR-0216](adr-0216-explore-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0217-01 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-02 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-03 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-04 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-05 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-06 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-07 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0217-08 | [ADR-0217](adr-0217-listening-compass.md) | Not started | No | Unassigned | - | - |
| SF-0218-01 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-02 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-03 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-04 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-05 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-06 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-07 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0218-08 | [ADR-0218](adr-0218-connection-gallery.md) | Not started | No | Unassigned | - | - |
| SF-0219-01 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-02 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-03 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-04 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-05 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-06 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-07 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0219-08 | [ADR-0219](adr-0219-create-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0220-01 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-02 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-03 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-04 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-05 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-06 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-07 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0220-08 | [ADR-0220](adr-0220-arrangement-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0221-01 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-02 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-03 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-04 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-05 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-06 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-07 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0221-08 | [ADR-0221](adr-0221-transition-inspector.md) | Not started | No | Unassigned | - | - |
| SF-0222-01 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-02 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-03 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-04 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-05 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-06 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-07 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0222-08 | [ADR-0222](adr-0222-energy-composition.md) | Not started | No | Unassigned | - | - |
| SF-0223-01 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-02 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-03 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-04 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-05 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-06 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-07 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0223-08 | [ADR-0223](adr-0223-studio-canvas.md) | Not started | No | Unassigned | - | - |
| SF-0224-01 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-02 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-03 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-04 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-05 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-06 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-07 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0224-08 | [ADR-0224](adr-0224-studio-ai-diff.md) | Not started | No | Unassigned | - | - |
| SF-0225-01 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-02 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-03 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-04 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-05 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-06 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-07 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0225-08 | [ADR-0225](adr-0225-requests-route.md) | Not started | No | Unassigned | - | - |
| SF-0226-01 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-02 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-03 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-04 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-05 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-06 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-07 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0226-08 | [ADR-0226](adr-0226-library-experience.md) | Not started | No | Unassigned | - | - |
| SF-0227-01 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-02 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-03 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-04 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-05 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-06 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-07 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0227-08 | [ADR-0227](adr-0227-song-identity.md) | Not started | No | Unassigned | - | - |
| SF-0228-01 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-02 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-03 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-04 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-05 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-06 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-07 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0228-08 | [ADR-0228](adr-0228-my-mixes.md) | Not started | No | Unassigned | - | - |
| SF-0229-01 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-02 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-03 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-04 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-05 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-06 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-07 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0229-08 | [ADR-0229](adr-0229-first-run.md) | Not started | No | Unassigned | - | - |
| SF-0230-01 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-02 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-03 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-04 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-05 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-06 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-07 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0230-08 | [ADR-0230](adr-0230-workspace.md) | Not started | No | Unassigned | - | - |
| SF-0231-01 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-02 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-03 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-04 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-05 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-06 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-07 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0231-08 | [ADR-0231](adr-0231-export-experience.md) | Not started | No | Unassigned | - | - |
| SF-0232-01 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-02 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-03 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-04 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-05 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-06 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-07 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0232-08 | [ADR-0232](adr-0232-feedback-recovery.md) | Not started | No | Unassigned | - | - |
| SF-0233-01 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-02 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-03 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-04 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-05 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-06 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-07 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0233-08 | [ADR-0233](adr-0233-responsive-scenes.md) | Not started | No | Unassigned | - | - |
| SF-0234-01 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-02 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-03 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-04 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-05 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-06 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-07 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0234-08 | [ADR-0234](adr-0234-accessible-art.md) | Not started | No | Unassigned | - | - |
| SF-0235-01 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-02 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-03 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-04 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-05 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-06 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-07 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0235-08 | [ADR-0235](adr-0235-performance.md) | Not started | No | Unassigned | - | - |
| SF-0236-01 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-02 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-03 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-04 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-05 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-06 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-07 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0236-08 | [ADR-0236](adr-0236-frontend-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0237-01 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-02 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-03 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-04 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-05 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-06 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-07 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0237-08 | [ADR-0237](adr-0237-truth-provenance.md) | Not started | No | Unassigned | - | - |
| SF-0238-01 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-02 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-03 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-04 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-05 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-06 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-07 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0238-08 | [ADR-0238](adr-0238-privacy-future.md) | Not started | No | Unassigned | - | - |
| SF-0239-01 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-02 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-03 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-04 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-05 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-06 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-07 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0239-08 | [ADR-0239](adr-0239-test-architecture.md) | Not started | No | Unassigned | - | - |
| SF-0240-01 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-02 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-03 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-04 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-05 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-06 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-07 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0240-08 | [ADR-0240](adr-0240-human-research.md) | Not started | No | Unassigned | - | - |
| SF-0241-01 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-02 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-03 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-04 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-05 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-06 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-07 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0241-08 | [ADR-0241](adr-0241-migration-rollback.md) | Not started | No | Unassigned | - | - |
| SF-0242-01 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-02 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-03 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-04 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-05 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-06 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-07 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0242-08 | [ADR-0242](adr-0242-musical-microcopy.md) | Not started | No | Unassigned | - | - |
| SF-0243-01 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-02 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-03 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-04 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-05 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-06 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-07 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0243-08 | [ADR-0243](adr-0243-creative-gestures.md) | Not started | No | Unassigned | - | - |
| SF-0244-01 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-02 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-03 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-04 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-05 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-06 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-07 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0244-08 | [ADR-0244](adr-0244-command-palette.md) | Not started | No | Unassigned | - | - |
| SF-0245-01 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-02 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-03 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-04 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-05 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-06 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-07 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0245-08 | [ADR-0245](adr-0245-final-pixel-polish.md) | Not started | No | Unassigned | - | - |
| SF-0246-01 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-02 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-03 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-04 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-05 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-06 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-07 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0246-08 | [ADR-0246](adr-0246-end-to-end-journey.md) | Not started | No | Unassigned | - | - |
| SF-0247-01 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-02 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-03 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-04 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-05 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-06 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-07 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |
| SF-0247-08 | [ADR-0247](adr-0247-release-governance.md) | Not started | No | Unassigned | - | - |

## Independent verification discipline

Every row remains Not started / Verified No until separately evidenced. Implementation needs source PR/SHA and task-specific passing regression. Verification needs an independent reviewer and dated SHA-tied visual, audio, accessibility, touch and real-device results where applicable. No rows were marked complete by this documentation-only PR. [Checklist](selecta-flow-implementation-checklist.md) · [Gates](selecta-flow-release-gates.md).
