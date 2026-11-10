# Selecta - creative-interface source baseline and prior-work crosswalk

**Baseline:** branch feat/finish-checklists at ad32af8 (2026-11-10), built on main after the creative-interface ADRs (c3715b1) and the first CI code commit c6b7f0e (shared music objects). This file answers CI-0165-01 (an annotated source baseline of every core journey) and CI-0184-01 (which CI tasks are met by code that already existed, which were built on 2026-11-10, and which are still open). The uncoached observation that CI-0165-01 also asks for needs a person and is not claimed here. `tests/test_ci_creative_interface.py` checks that every source file named below exists and that every CI task appears exactly once in the crosswalk with the same disposition as the checklist.

## Core journeys

| Journey | Route | Primary action | Supporting data | Conflicts and interruptions | Source state owner | Source files |
|---|---|---|---|---|---|---|
| First run | `/` (no library) | Add a music folder | Server folder check, scan stage, mix-ready count against the 6-song threshold | A folder that can't be used; leaving while scanning; what leaves this PC | Server status and folder check | web/src/views/Start.tsx; web/src/views/Setup.tsx; src/selecta/library/folder_check.py |
| Make a Mix | `/mixes` | Play the featured idea | Idea cards, matching song counts, approximate length, transition-feel and energy-shape defaults | Replacing a playing mix needs confirmation; Save draft leaves playback alone | Server vibe cards and steering preferences | web/src/views/Mixes.tsx; web/src/views/MixSetup.tsx; web/src/views/CurrentMix.tsx |
| Listen | `/listen` | Play or Pause | Song identity, transport clock, next handoff, lyrics with their timing level, real analyser data | One audio owner; previews take and give back sound; fullscreen can be refused | Player (audio clock) and song detail | web/src/views/Now.tsx; web/src/player.ts; web/src/audio/focus.tsx |
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
<!-- crosswalk:end -->
