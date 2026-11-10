# Selecta - creative-interface source baseline and prior-work crosswalk

**Baseline:** branch feat/finish-checklists at ad32af8 (2026-11-10), built on main after the creative-interface ADRs (c3715b1) and the first CI code commit c6b7f0e (shared music objects). This file answers CI-0165-01 (an annotated source baseline of every core journey) and CI-0184-01 (which CI tasks are met by code that already existed, which were built on 2026-11-10, and which are still open). The uncoached observation that CI-0165-01 also asks for needs a person and is not claimed here. `tests/test_ci_creative_interface.py` checks that every source file named below exists and that every CI task appears exactly once in the crosswalk with the same disposition as the checklist.

## Core journeys

| Journey | Route | Primary action | Supporting data | Conflicts and interruptions | Source state owner | Source files |
|---|---|---|---|---|---|---|
| First run | `/` (no library) | Add a music folder | Server folder check, scan stage, mix-ready count against the 6-song threshold | A folder that can't be used; leaving while scanning; what leaves this PC | Server status and folder check | web/src/views/Start.tsx; web/src/views/Setup.tsx; src/selecta/library/folder_check.py |
| Make a Mix | `/mixes` | Play the featured idea | Idea cards, matching song counts, approximate length, transition-feel and energy-shape defaults | Replacing a playing mix needs confirmation; Save draft leaves playback alone | Server vibe cards and steering preferences | web/src/views/Mixes.tsx; web/src/views/MixSetup.tsx; web/src/views/CurrentMix.tsx |
| Listen | `/listen` | Play or Pause | Song identity, transport clock, next handoff, lyrics with their timing level, real analyser data | One audio owner; previews take and give back sound; fullscreen can be refused | Player (audio clock) and song detail | web/src/views/Now.tsx; web/src/player.ts; web/src/audio/focus.ts |
| Edit a mix | `/mix/current/edit`, `/mixes/drafts/:id/edit` | Reorder or add a song | Exact song order, per-seam render state, measured energy, request ghosts | Current versus draft scope; a mix that moved on; Undo | Server mix revision (x-mix-order guard) | web/src/views/Mix.tsx; web/src/views/EditorRows.tsx; web/src/views/EditorStory.tsx; web/src/views/mixScope.ts |
| Inspect a seam | Inspector beside the editor | Change how a transition lands | Requested move, rendered move and fallback, disabled-move reasons, tempo gap and keys | Reorder while open; an older response arriving late; preview audio ownership | Server seam state for the exact pair | web/src/views/SeamInspector.tsx; web/src/ui/MusicObjects.tsx |
| Stem Studio | Studio tab of a seam | Apply a shape to this transition | Eight lanes, preview playhead, Selecta's suggested differences | Unsaved recovery versus applied; preview versus the mix playing | Server stems shape; local recovery copy | web/src/views/Studio.tsx; web/src/studio.ts |
| Requests | Requests panel | Ask for a song | Where it will land, bridge songs, readiness and time to wait | Bridge consent; two picks at once; a late cancel | Server request list | web/src/views/Requests.tsx; src/selecta/requests.py |
| Discover | `/links` | Hear a pair | Shared phrase and both lines; chords Selecta heard; the listener's own answers | Pause the mix while auditioning; add to the current mix or a draft | Server links and discoveries | web/src/views/Links.tsx |
| Library | `/library` | Find a song or start a mix from it | Readiness reason, measured and corrected BPM/key, layout and filters in the address | A missing deep-linked song; batch actions under a changed filter | Server library pages | web/src/views/Library.tsx; web/src/views/SongDetails.tsx |
| My Mixes | `/mixes/mine` | Edit or play a draft | Per-transition readiness, render-line place and wait | Play replaces what's playing; delete with Undo; a stale render-line answer | Server drafts and render line | web/src/views/Drafts.tsx; web/src/views/MyMixes.tsx |
| Workspace | `/workshop` | Act on what needs you | Jobs, analysis priority, storage split between cache and kept data, folders, diagnostics | Background work never interrupts playback; stale status is labelled | Server jobs, storage and folders | web/src/views/Workshop.tsx; web/src/views/WorkshopPanels.tsx |
| Export | Download audio from the editor | Save the frozen mix as FLAC | Frozen songs and transitions, revision, seams ready, outcome | Edits after starting never change the file; closing the panel keeps the job | Server export jobs | web/src/views/ExportPanel.tsx; web/src/views/ExportJobs.tsx; web/src/views/exportStore.ts |

## Prior-work crosswalk

Dispositions: **existing** means the acceptance was already met by code that predates 2026-11-10 and was credited after its tests ran on that date; **built** means code or a focused test was added on 2026-11-10; **open** means partly built or not built; **person** means it needs a person (study, review, named hardware or sign-off).

<!-- crosswalk:start -->
| CI task | Disposition | Note |
|---|---|---|
| CI-0165-01 | built | Built or given a focused test on 2026-11-10 |
| CI-0165-02 | person | Needs a person: design specimens of Explore, Create and Listen in both themes and a five-second glance test |
| CI-0165-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0165-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0165-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0165-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0165-07 | person | Needs a person: real-audio, keyboard and participant protocol for first play, edit, seam preview, request and export |
| CI-0166-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0166-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0166-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0166-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0166-05 | built | Built or given a focused test on 2026-11-10 |
| CI-0166-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0166-07 | person | Needs a person: uncoached graphic comprehension study |
| CI-0167-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0167-02 | built | Built or given a focused test on 2026-11-10 |
| CI-0167-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0167-04 | person | Needs a person: keyboard, desktop and mobile focus review of shell action priority |
| CI-0167-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0167-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0167-07 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0168-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0168-07 | person | Needs a person: uncoached task completion and hesitation counts |
| CI-0169-01 | open | In progress: the five-stop EnergyHorizon is the builder’s shape (web/src/views/MixSetup.tsx); drafts and the editor show measured energy (EnergyOverview, EnergyThumb), not the same five-stop form |
| CI-0169-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0169-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0169-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0169-05 | built | Built or given a focused test on 2026-11-10 |
| CI-0169-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0169-07 | person | Needs a person: uncoached task and review of the actual musical result |
| CI-0170-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0170-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0170-03 | person | Needs a person: real recorded audio synchronised to a frame timeline |
| CI-0170-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0170-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0170-06 | person | Needs a person: measured frame and audio trace on named hardware |
| CI-0170-07 | person | Needs a person: uncoached real-audio participant study |
| CI-0171-01 | built | Built or given a focused test on 2026-11-10 |
| CI-0171-02 | person | Needs a person: review of verified wordplay clips |
| CI-0171-03 | person | Needs a person: large-screen and physical distance reading test at 1440 and 2560px |
| CI-0171-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0171-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0171-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0171-07 | person | Needs a person: recorded frame-by-frame audio and video comparison |
| CI-0172-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0172-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0172-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0172-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0172-05 | person | Needs a person: API feasibility review and owner decision on an Inspector A/B; today compare exists only in the blind listening test (web/src/views/Listening.test.tsx "won’t let you choose between two you haven’t both heard") |
| CI-0172-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0172-07 | person | Needs a person: observed audition, edit and compare task |
| CI-0173-01 | person | Needs a person: full-density and 320px specimen review of song blocks and seam links |
| CI-0173-02 | open | In progress: the drop target is marked (.song.over in web/src/views/EditorRows.tsx) but the seams a move would change are not previewed |
| CI-0173-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0173-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0173-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0173-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0173-07 | person | Needs a person: performance trace with 40+ songs and a screen reader review |
| CI-0174-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0174-07 | person | Needs a person: named-device input, frame and audio measurements during render load |
| CI-0175-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0175-07 | person | Needs a person: uncoached real-audio request study |
| CI-0176-01 | built | Built or given a focused test on 2026-11-10 |
| CI-0176-02 | open | Not started: there is no bounded song-neighbour graph; web/src/views/Links.tsx lists phrase and chord pairs as cards |
| CI-0176-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0176-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0176-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0176-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0176-07 | person | Needs a person: uncoached discovery and blind listening notes |
| CI-0177-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0177-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0177-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0177-04 | built | test_start_a_mix_returns_a_set_that_opens_on_the_chosen_song; Library.test.tsx start=ID build plays from 0 |
| CI-0177-05 | open | Not started: song details show no validated related songs or candidate connections |
| CI-0177-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0177-07 | person | Needs a person: scroll, frame and zoom measurements on a large collection and an assistive technology review |
| CI-0178-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0178-02 | built | Built or given a focused test on 2026-11-10 |
| CI-0178-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0178-04 | open | Not started: no new-musical-possibility reveal during the first scan |
| CI-0178-05 | open | Not started: no first-seam reward moment |
| CI-0178-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0178-07 | person | Needs a person: observed first-use task metrics and interviews |
| CI-0179-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0179-02 | built | Built or given a focused test on 2026-11-10 |
| CI-0179-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0179-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0179-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0179-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0179-07 | person | Needs a person: timed multi-draft retrieval task |
| CI-0180-01 | open | In progress: Workspace “What needs you” reflects real counts but can list several actions rather than one most relevant next action; a glance review needs a person |
| CI-0180-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0180-03 | built | Built or given a focused test on 2026-11-10 |
| CI-0180-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0180-05 | existing | Met by earlier code; tests named on the checklist line |
| CI-0180-06 | person | Needs a person: many-job, reduced-motion listening review |
| CI-0180-07 | existing | Met by earlier code; tests named on the checklist line |
| CI-0181-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0181-02 | existing | Met by earlier code; tests named on the checklist line |
| CI-0181-03 | built | Built or given a focused test on 2026-11-10 |
| CI-0181-04 | built | Built or given a focused test on 2026-11-10 |
| CI-0181-05 | built | Built or given a focused test on 2026-11-10 |
| CI-0181-06 | built | Built or given a focused test on 2026-11-10 |
| CI-0181-07 | existing | Met by earlier code; tests named on the checklist line |
| CI-0182-01 | built | animation ownership table in the interaction matrix; test_every_keyframe_animation_has_an_owner_states_and_interruption_rule |
| CI-0182-02 | existing | six semantic motion tokens; loops and the clock-bound width are documented exceptions (web/src/styles/motion-tokens.test.ts) |
| CI-0182-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0182-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0182-05 | person | Needs a person: writing and comprehension review of the musical glossary (web/src/ui/glossaryTerms.ts) |
| CI-0182-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0182-07 | person | Needs a person: named-hardware trace and participant evaluation |
| CI-0183-01 | existing | Met by earlier code; tests named on the checklist line |
| CI-0183-02 | person | Needs a person: NVDA with Edge in Windows high contrast review |
| CI-0183-03 | existing | Met by earlier code; tests named on the checklist line |
| CI-0183-04 | existing | Met by earlier code; tests named on the checklist line |
| CI-0183-05 | person | Needs a person: actual-hardware p95 frame and audio trace |
| CI-0183-06 | existing | Met by earlier code; tests named on the checklist line |
| CI-0183-07 | person | Needs a person: named screen reader, touch and low-vision tester signs the exact SHA |
| CI-0184-01 | built | Built or given a focused test on 2026-11-10 |
| CI-0184-02 | person | Needs a person: owner review of PR slicing and rollback plans |
| CI-0184-03 | open | In progress: the crosswalk names the tests for each task, but not every task has state, viewport and negative-case coverage |
| CI-0184-04 | person | Needs a person: real uncoached listener, creator and expert tasks with raw denominators |
| CI-0184-05 | person | Needs a person: study bias review with real media |
| CI-0184-06 | person | Needs a person: old/new/old rollback rehearsal with isolated data and real audio |
| CI-0184-07 | person | Needs a person: owner GO/NO-GO with named independent reviewer for the exact SHA |
<!-- crosswalk:end -->
