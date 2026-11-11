# User journeys

The four journeys Selecta 2.0 must keep working (task T0003), written down step by step. Each step names the browser test that walks it for real against `tests/e2e_server.py`'s synthesised library, so this record cannot quietly go out of date: `tests/test_user_journeys.py` fails if a test named here is renamed or removed. Recorded 2026-11-11.

## Casual listening

Someone opens Selecta, presses Play and lets the mix run.

1. Play starts real sound and the clock moves. `web/e2e/listen.e2e.ts` - "Play makes real sound, on a clock that really moves"
2. Pause and Resume carry on from the same place. `web/e2e/listen.e2e.ts` - "Pause stops the clock, and Resume carries on from the same place"
3. Each transition takes over where it was planned, with no gap. `web/e2e/listen.e2e.ts` - "a transition takes over exactly where it was planned, with no gap"
4. Moving around the app leaves the music playing, and the mini-player follows. `web/e2e/listen.e2e.ts` - "moving around the app leaves the music alone, and the mini-player follows"
5. The keyboard and media keys work the player. `web/e2e/listen.e2e.ts` - "the keyboard works the player, and pressing Space on a button only does one thing"
6. The end of the mix stops cleanly and can be played again. `web/e2e/listen.e2e.ts` - "the end of the mix comes to a stop, and it can be played again"

## Live requesting

While a mix plays, someone asks for a song and Selecta finds it a place.

1. Ask for a song, see it find a place, and cancel it for good. `web/e2e/flows.e2e.ts` - "requests: asking, then seeing it find a place, and cancelling for good"
2. Each request state reads differently: searching, waiting, approval, preparing, ready. `web/e2e/mp-0290-requests.e2e.ts` - "MP-0290-03 searching, waiting, approval, preparing and ready each look and read differently"
3. Any extra bridge songs and their order are spelled out before consent. `web/e2e/mp-0290-requests.e2e.ts` - "MP-0290-04 the extra songs and their order are spelled out before consent"
4. Two requests at once never put a song in twice or share a spot. `web/e2e/integration.e2e.ts` - "two requests at once: no song goes in twice and no two share a spot"
5. A late answer cannot bring back a cancelled request. `web/e2e/integration.e2e.ts` - "a cancelled request that’s answered late doesn’t come back"

## Mix creation

Someone builds a mix of their own, keeps it as a draft and saves it as a file.

1. Start reacts at once to a slow answer and cannot be pressed twice. `web/e2e/flows.e2e.ts` - "a slow answer still gets an instant reaction on Start, and it can’t be pressed twice"
2. Pick an idea and shape it. `web/e2e/mp-0283-make-a-mix.e2e.ts` - "MP-0283-06 Shape groups energy, length and song count, with Done and Escape to leave"
3. Make a draft, name it and fill it, apart from the current mix. `web/e2e/flows.e2e.ts` - "drafts: make one, name it, fill it, and it stays apart from the current mix"
4. Reorder with buttons, undo, and remove a song. `web/e2e/flows.e2e.ts` - "editing: move with the buttons, undo it, and remove a song"
5. Editing a draft while the current mix plays touches neither the other nor its Undo. `web/e2e/integration.e2e.ts` - "editing a draft while the current mix plays: neither touches the other, and Undo knows which is which"
6. Save the mix as a real FLAC file. `web/e2e/flows.e2e.ts` - "saving a mix as an audio file makes a real FLAC"

## Expert seam editing

Someone opens one transition, changes how it is made and checks the result.

1. Open a transition's inspector, see its four areas, change the move and hear the new render. `web/e2e/flows.e2e.ts` - "a transition’s inspector: its four areas, and a change of move renders the new one"
2. Listen, Change, Studio and Details behave as one set of tabs. `web/e2e/mp-0288-seam-inspector.e2e.ts` - "MP-0288-02 Listen, Change, Studio and Details share one geometry and tab semantics"
3. A refused change shows its error under the fields it belongs to. `web/e2e/mp-0288-seam-inspector.e2e.ts` - "MP-0288-05 a refused change shows its error under the fields, tied to them"
4. A reorder or a late answer never switches the pair being inspected. `web/e2e/mp-0288-seam-inspector.e2e.ts` - "MP-0288-07 a reorder or a late answer never switches the pair being inspected"
5. A correction made while the page is open only touches its own transitions. `web/e2e/integration.e2e.ts` - "a correction made while the page is open shows up, and only touches its own transitions"
