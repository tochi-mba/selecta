# Selecta - creative-interface test coverage matrix

Generated from the Evidence fields of the [CI checklist](selecta-creative-interface-implementation-checklist.md) by `python -m selecta.audit.ci_coverage --write`; `tests/test_ci_coverage_matrix.py` fails when it is out of date (CI-0184-03).

- **State:** unit and Python tests that drive the feature through its states.
- **Browser:** Playwright specs, run in a real browser at the viewport sizes they set.
- **Negative case:** a cited test whose name says what must not happen.
- **Gaps:** a ticked task missing one of the three kinds. Open and needs-a-person tasks are listed for completeness and have no gaps column entry.

**Totals:** 140 tasks; 108 ticked, of which 20 have all three kinds of coverage and 88 have a gap.

| Task | Status | State | Browser | Negative case | Gaps |
|---|---|---|---|---|---|
| CI-0165-01 | ticked | `tests/test_ci_creative_interface.py` | - | - | browser, negative |
| CI-0165-02 | person | - | - | - | - |
| CI-0165-03 | ticked | `web/src/router.test.tsx`; `web/src/views/Mix.test.tsx` | `web/e2e/listen.e2e.ts`; `web/e2e/pages.e2e.ts` | - | negative |
| CI-0165-04 | ticked | `web/src/views/Mix.test.tsx`; `web/src/views/Requests.test.tsx` | `web/e2e/flows.e2e.ts` | "needs no confirming and doesn’t touch the mix"; "does not present remembered failures as ongoing renders" | - |
| CI-0165-05 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Mixes.test.tsx`; `web/src/views/Now.test.tsx`; `web/src/views/Requests.test.tsx` | - | "never uses words like handover or cues"; "keeps expert view controls discoverable without competing with playback" | browser |
| CI-0165-06 | ticked | - | `web/e2e/creative-visualizers.e2e.ts`; `web/e2e/finishing.e2e.ts`; `web/e2e/listen.e2e.ts` | "with reduced motion nothing keeps moving by itself, on any page" | state |
| CI-0165-07 | person | - | - | - | - |
| CI-0166-01 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | - | browser, negative |
| CI-0166-02 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | "gives one library ID the same decorative motif without depending on titles or artwork" | browser |
| CI-0166-03 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | "never calls an automatic unrendered transition a confirmed technique" | browser |
| CI-0166-04 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | "keeps requested and measured energy explicitly separate, with no invented measurement"; "keeps unknown song energy as an unknown gap and selects only the actual row" | browser |
| CI-0166-05 | ticked | `web/src/styles/surface-depth.test.ts`; `web/src/ui/MusicObjects.test.tsx`; `web/src/views/CreativeInterface.test.tsx` | - | "keeps queued, rendering, failed and rendered Thread states distinct without inventing sound" | browser |
| CI-0166-06 | ticked | - | `web/e2e/pages.e2e.ts` | "nothing goes wider than the window, from the smallest phone to 4K"; "nothing goes wider than the window in landscape, or zoomed in as far as browsers go" | state |
| CI-0166-07 | person | - | - | - | - |
| CI-0167-01 | ticked | `web/src/router.test.tsx`; `web/src/views/Library.test.tsx`; `web/src/views/Mix.test.tsx` | - | "never confuses two different drafts with identical songs and transition keys" | browser |
| CI-0167-02 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/CurrentMix.test.tsx` | - | "names the idea with the server’s own song count, opens the editor, and claims nothing rendered"; "tracks the exact returned song order without adding an audio action" | browser |
| CI-0167-03 | ticked | `web/src/views/Mix.test.tsx`; `web/src/views/Studio.test.tsx` | `web/e2e/finishing.e2e.ts` | "a mix that moved on refuses the shape, and it stays here to try again" | - |
| CI-0167-04 | ticked | `web/src/App.test.tsx` | - | - | browser, negative |
| CI-0167-05 | ticked | `web/src/views/Mix.test.tsx` | `web/e2e/finishing.e2e.ts`; `web/e2e/flows.e2e.ts` | - | negative |
| CI-0167-06 | ticked | `web/src/audio/focus.test.tsx` | `web/e2e/listen.e2e.ts` | "only one tab plays at a time"; "never restarts the mix after someone has pressed something themselves" | - |
| CI-0167-07 | ticked | `web/src/App.test.tsx`; `web/src/views/Library.test.tsx` | `web/e2e/flows.e2e.ts`; `web/e2e/pages.e2e.ts` | "never opens another song if a deep-link ID is missing, and can retry"; "only the newest search counts, however the answers arrive" | - |
| CI-0168-01 | ticked | `web/src/views/Mixes.test.tsx` | - | - | browser, negative |
| CI-0168-02 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Mixes.test.tsx` | - | "gives idea groups distinct, stable abstract motifs without pretending to show album art" | browser |
| CI-0168-03 | ticked | `web/src/views/Mixes.test.tsx` | - | "builds it without touching what’s playing" | browser |
| CI-0168-04 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Mixes.test.tsx` | - | "scales with the songs asked for and never states minutes" | browser |
| CI-0168-05 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/CurrentMix.test.tsx`; `web/src/views/Library.test.tsx`; `web/src/views/Mixes.test.tsx` | - | "cancels active playback replacement without building, and guards the confirmed build" | browser |
| CI-0168-06 | ticked | `web/src/views/Mixes.test.tsx` | `web/e2e/pages.e2e.ts` | "nothing goes wider than the window, from the smallest phone to 4K" | - |
| CI-0168-07 | person | - | - | - | - |
| CI-0169-01 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Mix.test.tsx`; `web/src/views/MixSetup.test.tsx`; `web/src/views/ciEnergyHorizon.test.tsx` | - | - | browser, negative |
| CI-0169-02 | ticked | `web/src/views/MixSetup.test.tsx` | - | "cancels an interrupted pointer stroke without leaving a half-drawn energy choice" | browser |
| CI-0169-03 | ticked | `web/src/views/MixSetup.test.tsx` | `web/e2e/pages.e2e.ts` | - | negative |
| CI-0169-04 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | "keeps requested and measured energy explicitly separate, with no invented measurement" | browser |
| CI-0169-05 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | "draws smooth, punchy and each-mix-chooses differently, as decoration only" | browser |
| CI-0169-06 | ticked | `web/src/views/Mixes.test.tsx` | - | "does not claim an energy shape was saved when clearing the shape fails" | browser |
| CI-0169-07 | person | - | - | - | - |
| CI-0170-01 | ticked | `web/src/views/Now.test.tsx` | `web/e2e/pages.e2e.ts` | "keeps expert view controls discoverable without competing with playback" | - |
| CI-0170-02 | ticked | `web/src/views/spectrumEdgeCases.test.ts`; `web/src/views/spectrumVisuals.test.ts` | `web/e2e/creative-visualizers.e2e.ts` | - | negative |
| CI-0170-03 | person | - | - | - | - |
| CI-0170-04 | ticked | `web/src/views/Now.test.tsx` | - | "uses chronological seconds when the next handoff has no valid beat grid"; "keeps a finite, disabled slider and never attempts a seek" | browser |
| CI-0170-05 | ticked | `web/src/views/Now.test.tsx` | `web/e2e/motion-preference.e2e.ts` | - | negative |
| CI-0170-06 | person | - | - | - | - |
| CI-0170-07 | person | - | - | - | - |
| CI-0171-01 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Now.test.tsx` | - | "says what kind of lyrics a word-timed, line-timed, plain, missing and instrumental song has" | browser |
| CI-0171-02 | person | - | - | "No links yet" | - |
| CI-0171-03 | person | - | - | - | - |
| CI-0171-04 | ticked | `web/src/views/Now.test.tsx` | - | "can read a full static lyric sheet and resume following without affecting audio" | browser |
| CI-0171-05 | ticked | - | `web/e2e/finishing.e2e.ts` | "fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops" | state |
| CI-0171-06 | ticked | - | `web/e2e/finishing.e2e.ts` | "with reduced motion nothing keeps moving by itself, on any page" | state |
| CI-0171-07 | person | - | - | - | - |
| CI-0172-01 | ticked | `web/src/ui/MusicObjects.test.tsx` | - | "never calls an automatic unrendered transition a confirmed technique" | browser |
| CI-0172-02 | ticked | `web/src/views/Mix.test.tsx` | - | "never confuses two different drafts with identical songs and transition keys" | browser |
| CI-0172-03 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Mix.test.tsx` | - | "says nothing about a fallback when what played is what was asked for" | browser |
| CI-0172-04 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | - | browser, negative |
| CI-0172-05 | person | - | - | - | - |
| CI-0172-06 | ticked | `web/src/audio/focus.test.tsx` | `web/e2e/listen.e2e.ts` | "two can’t play at once"; "only one tab plays at a time" | - |
| CI-0172-07 | person | - | - | - | - |
| CI-0173-01 | ticked | `web/src/views/Mix.test.tsx` | - | - | browser, negative |
| CI-0173-02 | ticked | `web/src/views/Mix.test.tsx`; `web/src/views/dropPreview.test.tsx` | - | "names only the two seams around the song and the one it lands in"; "marks nothing over the song being carried, and nothing when the preview is turned off" | browser |
| CI-0173-03 | ticked | `web/src/views/Mix.test.tsx` | `web/e2e/finishing.e2e.ts` | - | negative |
| CI-0173-04 | ticked | `web/src/ui/MusicObjects.test.tsx` | `web/e2e/creative-visualizers.e2e.ts` | "keeps unknown song energy as an unknown gap and selects only the actual row" | - |
| CI-0173-05 | ticked | `web/src/views/Mix.test.tsx` | `web/e2e/integration.e2e.ts` | "is plainly a draft, and says what’s playing isn’t affected"; "has no buttons that would change the current mix" | - |
| CI-0173-06 | ticked | `web/src/views/Mix.test.tsx` | - | "lets go of a choice that changed nothing on the server" | browser |
| CI-0173-07 | person | - | - | - | - |
| CI-0174-01 | ticked | `web/src/views/Studio.test.tsx` | - | - | browser, negative |
| CI-0174-02 | ticked | `web/src/views/Studio.test.tsx` | - | "switches between guided Shape and Detailed without changing the grid" | browser |
| CI-0174-03 | ticked | `web/src/views/Studio.test.tsx` | - | "paints a consistent value over touched cells without re-toggling a revisited cell"; "pressing a name plays only that part, and can go back to everything" | browser |
| CI-0174-04 | ticked | `web/src/views/Studio.test.tsx` | - | - | browser, negative |
| CI-0174-05 | ticked | `web/src/views/Studio.test.tsx` | - | - | browser, negative |
| CI-0174-06 | ticked | `web/src/views/Studio.test.tsx` | - | "if using it fails, the shape is still there to try again" | browser |
| CI-0174-07 | person | - | - | - | - |
| CI-0175-01 | ticked | `web/src/views/Requests.test.tsx` | - | - | browser, negative |
| CI-0175-02 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Requests.test.tsx` | - | "shows only returned ordered route songs, and never implies a proposed path has joined" | browser |
| CI-0175-03 | ticked | `web/src/views/Mix.test.tsx` | - | - | browser, negative |
| CI-0175-04 | ticked | `web/src/views/Requests.test.tsx` | `web/e2e/integration.e2e.ts` | "allows only one bridge decision while its server response is pending"; "saying no stops asking and says what happens now" | - |
| CI-0175-05 | ticked | `web/src/views/Requests.test.tsx` | `web/e2e/finishing.e2e.ts` | "is offered when nothing fits, and goes straight in"; "keeps it on the list if cancelling fails, and says so" | - |
| CI-0175-06 | ticked | `web/src/views/Requests.test.tsx` | `web/e2e/integration.e2e.ts` | "won’t let a song be asked for twice, or one already in the mix"; "a slow poll can’t bring back something just cancelled" | - |
| CI-0175-07 | person | - | - | - | - |
| CI-0176-01 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | - | browser, negative |
| CI-0176-02 | ticked | `web/src/views/ci-0176-relationship-map.test.tsx`; `web/src/views/sfFlowConnections.test.tsx` | - | "can be walked song by song from a keyboard control, lighting only that song’s real links" | browser |
| CI-0176-03 | ticked | `web/src/views/Links.test.tsx` | - | "never calls a requested harmonic stage playing until the media element starts" | browser |
| CI-0176-04 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Links.test.tsx` | - | "calls unrated harmony pairs possible, and says an answer changes no mix" | browser |
| CI-0176-05 | ticked | `web/src/views/Links.test.tsx` | - | "goes in as one thing, so half of it can’t be left behind"; "stopping really stops, and answering afterwards does not start it again" | browser |
| CI-0176-06 | ticked | `web/src/views/Links.test.tsx` | - | "says there’s nothing yet when there is nothing to show"; "can’t load isn’t the same as nothing there" | browser |
| CI-0176-07 | person | - | - | - | - |
| CI-0177-01 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Library.test.tsx` | - | "shows how many there are, and fetches more without losing its place" | browser |
| CI-0177-02 | ticked | `web/src/views/Library.test.tsx` | - | "restores the requested page depth when navigation changes only the URL"; "a song that turns up on two pages only shows once" | browser |
| CI-0177-03 | ticked | `web/src/views/Library.test.tsx` | - | "distinguishes analysed songs from mix-ready songs without promising rendered transitions" | browser |
| CI-0177-04 | ticked | `tests/test_ci_creative_interface.py`; `web/src/views/Library.test.tsx` | - | "cancels active playback replacement without building, and guards the confirmed build" | browser |
| CI-0177-05 | ticked | `tests/test_ci_related_links.py`; `web/src/views/LibraryLx.test.tsx`; `web/src/views/SongRelated.test.tsx` | - | - | browser, negative |
| CI-0177-06 | ticked | `web/src/views/Library.test.tsx` | - | "shows what’s wrong with a value that isn’t allowed, and keeps it there" | browser |
| CI-0177-07 | person | - | - | - | - |
| CI-0178-01 | ticked | `web/src/views/Setup.test.tsx` | `web/e2e/finishing.e2e.ts` | "a folder that can’t be used says why and what to try, nothing is read, and another can be tried straight away" | - |
| CI-0178-02 | ticked | `tests/test_ci_creative_interface.py`; `tests/test_selecta3_changes.py` | `web/e2e/finishing.e2e.ts` | - | negative |
| CI-0178-03 | ticked | `web/src/views/Mixes.test.tsx`; `web/src/views/Setup.test.tsx` | - | "does not misreport zero mix-ready songs when an older server omits that count"; "does not promise a playable mix before the real readiness threshold" | browser |
| CI-0178-04 | ticked | `tests/test_flags.py`; `web/src/views/Setup.test.tsx`; `web/src/views/ci-0178-first-run.test.tsx` | - | "names only the connections the server returned, newest first, and nothing more"; "shows nothing when the server has found nothing, or returns something that is not a real pair" | browser |
| CI-0178-05 | ticked | `web/src/views/Now.test.tsx`; `web/src/views/ci-0178-first-run.test.tsx`; `web/src/views/explanations.test.tsx` | - | "waits for a finished transition to be heard, then names the two songs without blocking anything"; "is not triggered while paused, or by a transition that is not finished or not in this mix" | browser |
| CI-0178-06 | ticked | `web/src/views/Setup.test.tsx` | - | - | browser, negative |
| CI-0178-07 | person | - | - | - | - |
| CI-0179-01 | ticked | `web/src/App.test.tsx`; `web/src/router.test.tsx`; `web/src/views/Mix.test.tsx` | - | "is plainly a draft, and says what’s playing isn’t affected" | browser |
| CI-0179-02 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | "keeps missing and non-numeric energy as unknown gaps and says how many"; "shows nothing for an empty mix and never draws a shape when nothing was measured" | browser |
| CI-0179-03 | ticked | `web/src/views/Drafts.test.tsx` | - | "won’t play an empty draft, and says why" | browser |
| CI-0179-04 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | "draws one segment per transition from the server counts, with no invented percentage"; "never shows more segments than transitions" | browser |
| CI-0179-05 | ticked | `web/src/views/Drafts.test.tsx` | - | "does not let an older, delayed refresh undo a confirmed render-line change"; "can move through the line, but not past the ends" | browser |
| CI-0179-06 | ticked | `web/src/App.test.tsx`; `web/src/views/Mix.test.tsx` | `web/e2e/flows.e2e.ts` | "an empty draft goes straight to choosing the first song" | - |
| CI-0179-07 | person | - | - | - | - |
| CI-0180-01 | ticked | `web/src/views/ciWorkspaceHealth.test.tsx` | - | "says mixing is blocked by too few ready songs, and puts that fix first above the rest" | browser |
| CI-0180-02 | ticked | `web/src/views/Workshop.test.tsx` | - | "say what’s really happening, including what’s failed" | browser |
| CI-0180-03 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Workshop.test.tsx` | - | "shows analysis held back by a mix render as waiting, not stuck"; "says what Selecta does with nothing else to do, and how far it has got" | browser |
| CI-0180-04 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Workshop.test.tsx` | - | "labels the cache as Selecta’s own and says the music files are never counted or touched" | browser |
| CI-0180-05 | ticked | `web/src/views/Workshop.test.tsx` | `web/e2e/flows.e2e.ts` | "show diagnostics with nothing personal in them, ready to copy" | - |
| CI-0180-06 | person | - | - | - | - |
| CI-0180-07 | ticked | `web/src/views/Workshop.test.tsx` | `web/e2e/flows.e2e.ts` | "say when they can’t find out, rather than saying nothing’s happening" | - |
| CI-0181-01 | ticked | `web/src/views/Mix.test.tsx` | `web/e2e/integration.e2e.ts` | "does not carry an in-flight export across a change of editing scope" | - |
| CI-0181-02 | ticked | `web/src/views/Mix.test.tsx` | - | "says so if what’s left can’t be made" | browser |
| CI-0181-03 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | "tells cancelled, expired, failed and interrupted apart, and each can be made again" | browser |
| CI-0181-04 | ticked | `web/src/views/CreativeInterface.test.tsx`; `web/src/views/Mix.test.tsx` | `web/e2e/finishing.e2e.ts` | "shows the file name, length and download only once the file really exists"; "only offers the file once it really exists" | - |
| CI-0181-05 | ticked | `web/src/views/CreativeInterface.test.tsx` | - | "finds the same job again after it is closed and reopened, without asking for a new one" | browser |
| CI-0181-06 | ticked | `web/src/views/CreativeInterface.test.tsx` | `web/e2e/finishing.e2e.ts` | - | negative |
| CI-0181-07 | ticked | - | `web/e2e/finishing.e2e.ts` | - | state, negative |
| CI-0182-01 | ticked | `tests/test_ci_creative_interface.py` | - | - | browser, negative |
| CI-0182-02 | ticked | `web/src/styles/motion-tokens.test.ts` | - | - | browser, negative |
| CI-0182-03 | ticked | `web/src/ui/MusicObjects.test.tsx`; `web/src/views/Mix.test.tsx`; `web/src/views/Requests.test.tsx` | - | "a pick that fails only takes itself back" | browser |
| CI-0182-04 | ticked | `web/src/views/Mix.test.tsx`; `web/src/views/Requests.test.tsx` | `web/e2e/integration.e2e.ts` | - | negative |
| CI-0182-05 | person | - | - | - | - |
| CI-0182-06 | ticked | `web/src/styles/surface-depth.test.ts`; `web/src/ui/useReducedMotion.test.tsx` | `web/e2e/finishing.e2e.ts`; `web/e2e/motion-preference.e2e.ts` | "with reduced motion nothing keeps moving by itself, on any page" | - |
| CI-0182-07 | person | - | - | - | - |
| CI-0183-01 | ticked | `web/src/views/Now.test.tsx`; `web/src/views/Workshop.test.tsx` | `web/e2e/motion-preference.e2e.ts` | - | negative |
| CI-0183-02 | person | - | - | - | - |
| CI-0183-03 | ticked | `web/src/views/MixSetup.test.tsx` | `web/e2e/finishing.e2e.ts` | - | negative |
| CI-0183-04 | ticked | `web/src/views/Mix.test.tsx` | `web/e2e/finishing.e2e.ts`; `web/e2e/pages.e2e.ts` | "nothing goes wider than the window in landscape, or zoomed in as far as browsers go" | - |
| CI-0183-05 | person | - | - | - | - |
| CI-0183-06 | ticked | - | `web/e2e/finishing.e2e.ts`; `web/e2e/flows.e2e.ts` | "focus is never hidden behind the bottom bar on a phone" | state |
| CI-0183-07 | person | - | - | - | - |
| CI-0184-01 | ticked | `tests/test_ci_creative_interface.py` | - | - | browser, negative |
| CI-0184-02 | person | - | - | - | - |
| CI-0184-03 | person | `tests/test_ci_coverage_matrix.py` | - | - | - |
| CI-0184-04 | person | - | - | - | - |
| CI-0184-05 | person | - | - | - | - |
| CI-0184-06 | person | - | - | - | - |
| CI-0184-07 | person | - | - | - | - |
