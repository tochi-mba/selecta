# Flow research protocol: listener, creator and access sessions

The written protocol for ADR-0240. It defines what people are asked to do and how results are
recorded and reported. It is not a result: no session has been run under it yet, and nothing here
counts as evidence that Selecta is easy, accessible or enjoyable. Sound quality is judged separately,
by `docs/listening-procedure.md`.

Written 2026-11-10. Checked by `tests/test_flow_cross_cutting.py`.

## Ground rules for every session

- **Uncoached.** The facilitator reads the task card word for word and answers questions only with
  "What would you try?". No pointing, no naming controls, no hints after a failure.
- **Fresh state.** Each participant starts from a new Selecta home made by
  `python tests/e2e_server.py <port>` (the made-up library) unless the session says real music.
  Never the owner's own `~/.selecta`.
- **Recorded per session:** date, participant code (never a name), the exact Git SHA, OS, browser and
  version, screen size, input (mouse, touch, keyboard only, screen reader), theme, motion setting,
  and whether audio came from speakers or headphones.
- **One task, one outcome.** Each task ends as Done unaided, Done with a stall over 60 seconds,
  Gave up, or Wrong result (finished, but something other than asked happened). Wrong result is
  always recorded with what actually happened.

## Per-task study cards (preparation, not results)

One card per SF task that needs people. A card is preparation: nothing here is a finding, and no
card ticks its task. Added 2026-11-12 by Claude (WP2) for ADR-0198 to ADR-0222.

**Every card shares these rules** (each card adds only what differs):

- **Route:** a fresh `python tests/e2e_server.py <port>` (made-up library, never the owner's music),
  in a fresh browser profile; the card names the start address. `SELECTA_E2E_STRESS=1` only where
  the card says so.
- **Prompt:** read word for word. It never names a control, a page or a SelectaDJ term. After it,
  the facilitator says only "What would you try?".
- **Success:** the card's "Done means". **Hesitation:** any pause over 10 seconds with no input,
  or a wrong first click, is noted with where it happened; a stall over 60 seconds makes the outcome
  "Done with stall".
- **Fields per attempt:** participant code (P01, P02 and so on, never a name), cohort (novice,
  listener, creator or DJ), seconds from prompt to outcome, outcome (Done unaided / Done with stall
  / Gave up / Wrong result), first click, confidence asked after the outcome ("How sure are you that
  worked?", 1 to 5), and one quote or "-".
- **Consent line, read before the first card:** "This tests SelectaDJ, not you. Nothing you do can
  be wrong. I will note what you do and say, under a code, not your name. You can stop at any
  time. May I record the screen? (yes / no)". Record the answer; no recording without a yes.
- **Pilot column:** a cognitive walkthrough by Claude on 2026-11-12 (Edge 157, 1280 by 900, the
  made-up library, build `web/dist-wp2` made from the working tree on `73298def`). It only confirms
  the task can be finished and the prompt has one reading. It is not a participant result.

### ADR-0198: artistic product charter

The three scene modes the five-second card tests (definitions in
[ADR-0198](../adr/adr-0198-artistic-product-charter.md), "Scene modes"):
Listen (`/listen`), Make (`/mixes`) and Create (`/mix/current/edit`).

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0198-02 five-second | Each of `/listen`, `/mixes`, `/mix/current/edit` (order rotated per participant), shown 5 seconds then hidden | "What was that screen about, and what would you press first?" | Names the focal object (the playing song; the pick to play; the mix being edited) and the primary action (Play or Pause; Play; Play from the top). Score each scene apart | Completable; each scene has one h1 and one filled action. At 1280 by 900 the Make pick's Play sits below the first screen, so a five-second view may not show it |
| SF-0198-06 novice and DJ | Novice: `/mixes`. DJ: `/mix/current/edit` | Novice: "Start some music." DJ: "Choose exactly how the second song hands over to the third." | Novice: sound starts with one action. DJ: a move chosen for transition 2 and still offered in the same place after reload | Completable; the transition's Change opens "How should this land?" with every move |

### ADR-0200: art direction

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0200-02 blind brand | Screenshots of `/listen` and `/mixes` with the wordmark masked, then the same from one other music app, order rotated | "Which of these come from the same product? Give three words for its look." | Groups the SelectaDJ screens together, and the words are compared to the traits and exclusions in ADR-0200 by someone who did not run the session | Completable as a card sort; the wordmark is one element ("SelectaDJ, go to Make a Mix") and easy to mask |
| SF-0200-04 five-second layout | `/mixes`, `/library`, `/mixes/mine`, 5 seconds each | "What can you do first on that screen?" | Names that screen's main action within the answer | Completable; each page has one h1 and its main action in the first screen except Make (see SF-0198-02) |

### ADR-0202: typography

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0202-07 reading | `/listen`; the facilitator opens the request dialog, then the "What is transition?" help | "Read this, then tell me in your own words what it says will happen." Then: "How comfortable was that to read?" (1 to 5) | Retells the copy correctly; comfort is reported apart from the retelling | Completable; the request dialog opens from the side bar |

### ADR-0204: controls

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0204-02 primary action | `/mixes`, `/listen`, `/mixes/mine`, `/mix/current/edit`, keyboard only | "Using only the keyboard, do the main thing this page is for." | Reaches and presses the one filled action without a mouse; count the Tab presses | Completable; see the pilot note in the run record |

### ADR-0205: motion

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0205-08 comfort and delight | `/listen`, playing. The facilitator sets Motion to Still, Subtle and Expressive (Workspace, Interface) between rounds, order counterbalanced across participants; the participant is not told which | "Listen for two minutes as you normally would." Then: "How comfortable was that? How distracting? How much did you enjoy it?" (each 1 to 5) | Three ratings per round; distraction and enjoyment never combined | Completable; the Motion radio group has all three settings |

### ADR-0207: the Thread

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0207-08 planned, playing, ready | `/mix/current/edit` while the mix plays, one transition rendered and two not | "Point at the song playing now, a change between songs you could already hear, and one that is only planned." | All three correct against the server state at that moment | Completable; transitions show Queued, Rendering or Ready in words |

### ADR-0212: visualizer

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0212-08 default style | `/listen`, playing; the facilitator switches the visualizer style between the default and two others, order counterbalanced | "Which of these helped you feel the music most, and which got in the way?" | A ranking per participant; the default is justified only if it ranks first or second for most | Completable; the style menu is on Listen |

### ADR-0213: lyrics

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0213-08 reduced motion | `/listen` on Morning Light (timed lyrics), OS reduced motion on, then off, order counterbalanced | "Follow the words, and tell me which line is being sung now." | Names the current line within one line, in both settings | Completable; the lyric line and "Read all lyrics" are present |

### ADR-0215: Up Next

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0215-01 next song | `/listen`, shown 5 seconds | "What plays next?" | Names the next song and its artist | Completable; "Coming up" shows the next song and artist first |
| SF-0215-04 request versus steering | `/listen`, playing | 1: "Ask for one particular song to be played later." 2: "Make the next song calmer." 3: "Which of those two is still waiting?" | 1 uses the request, 2 uses steering, 3 names the request | Completable; both entries are present and apart |
| SF-0215-08 attention | `/listen`, playing, three minutes | "Listen as you would at home." Then: "What did you look at most? Did anything pull you away from the music?" | Reported only; a secondary panel named as dominant by most is a finding | Completable |

### ADR-0216: Explore gallery

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0216-01 featured idea | `/mixes`, shown 5 seconds | "What would that screen play for you, and how would you start it?" | Names the pick and Play | Completable; same fold caveat as SF-0198-02 |
| SF-0216-04 Play, Shape, Save | `/mixes`, on the House party card | "Before pressing anything, say what each of the three buttons on this card will do." Then: "Keep this idea for later without playing it." | Predictions match; a draft for it appears in My Mixes and playback did not change | Completable; Play, Shape first and Save draft are on every card |
| SF-0216-08 inspiration | Round A `/mixes`, round B `/library`, order counterbalanced | "Find something you would like to hear right now, and start it." Then: "How inspired did that make you feel?" (1 to 5) | Errors and time per round; inspiration reported apart | Completable; Library has Start a mix per song |

### ADR-0217: Listening Compass

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0217-02 vocabulary | `/mixes` with the shaping panel opened by the facilitator | For each label in turn: "What do you think this would change in the music?" | Each answer matches the ADR-0217 meaning; scored per label by someone who did not run the session | Completable; the panel opens with its energy arc and guided controls |
| SF-0217-06 direct play | `/mixes` | "Start some music as fast as you can." | Sound starts without opening the shaping panel; time recorded | Completable; Play sits on the pick card above the optional panel |
| SF-0217-08 predict scope | `/mixes`, shaping panel open | "Change one thing. Before you go on, tell me what will change and whether it changes what is playing now." | Prediction matches what happens | Completable; the panel states it shapes the next mix |

### ADR-0218: Connection Gallery

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0218-08 discoverability | `/mixes` | "Find two songs that share words and hear how they would connect." Then: "How sure are you that they really connect?" (1 to 5) | Reaches word or harmonic connections and auditions one; confidence compared with what the card shows as evidence | Completable to the page; the made-up library has no word links, so this card needs a library with lyric links (owner choice) to be finished |

### ADR-0219: Story, Arrange and Detail

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0219-02 Story | `/mix/current/edit?view=story` | "Tell me the journey this mix takes, from start to finish." | Order and how each song leads in, without touching a control | Completable |
| SF-0219-03 Arrange | `/mix/current/edit` | "Move the last song so it plays second, then change how it comes in." | Exactly that move, then a move chosen for the transition into it | Completable; Move up and Change are on every row |
| SF-0219-04 Detail (DJ expert) | `/mix/current/edit?view=detail` with all transitions rendered | "Set the second transition the way you would play it in a set: where it starts, how long it takes and which move." Then: "What is missing?" | Expert reaches cue, length and move; their answer to "missing" is the finding. Claude's own heuristic review is in ADR-0219 and is not this review | Completable to cues and moves; see ADR-0219 |
| SF-0219-08 three levels | `/mix/current/edit`; one task per view, view order counterbalanced | Story: "Describe the mix." Arrange: "Swap songs two and three." Detail: "Make the second change shorter." | Per cohort: time and outcome per view; experts not slower than with Arrange alone | Completable; the View switch has three choices |

### ADR-0220: reorder

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0220-08 reorder confidence | `/mix/current/edit` | "Move Paper Moon so it plays right after Morning Light." Then confidence 1 to 5 | Exactly that song moved, nothing else changed (compare the order before and after) | Completable; see the run record |

### ADR-0221: Transition Inspector

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0221-08 listen first | `/mix/current/edit`, one transition rendered, one not | "Is the change from song one into song two good enough to keep? Decide however you like." | Records whether they listened before deciding, and whether they trusted a status word without listening | Completable; see the run record |

### ADR-0222: Energy Horizon

| Card | Start | Prompt | Done means | Pilot |
|---|---|---|---|---|
| SF-0222-08 rise, drop, uncertainty | `/mix/current/edit` | "Where in this mix does the energy rise most, and where does it drop? How sure is SelectaDJ about that?" | Points match the measured energy; says it is measured, not requested, and how certain | Completable; the energy picture has a text description |

## Per-task study cards, ADR-0223 to ADR-0247

These cards are **preparation**, not findings. They add the person-only SF tasks not covered by
the earlier ADR-0198 to ADR-0222 cards. No task is marked Verified by this document and
each session must be conducted and evaluated by an independent participant observer.

**Shared fields and rules for these cards:**
- **Consent line:** read the consent wording from the earlier card rules before recording anything.
- **Participant codes:** use P01, P02, etc., never a person's real name.
- **Timing:** record seconds to the first action and to outcome plus any stall above 10 seconds.
- **Confidence:** ask the participant for a 1–5 rating after the task, not before.
- **Outcome:** record Done unaided, Done with stall, Gave up or Wrong result with the actual action.
- **Pilot:** preparation only; a developer walkthrough is never a participant result.
- **Test environment:** use `python tests/e2e_server.py <port>` and the made-up library in
  a fresh browser profile unless the card explicitly requires licensed real music.

### ADR-0223

**SF-0223-08 - uncoached study card**

- **Route:** /mix/current/edit -> transition Studio. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Ask a beginner and a producer to point out the editable song parts and make one reversible change."
- **Done means:** Each names the part changed, applies an edit and can identify the undo route..
- **Hesitation:** Pause over 10 seconds, wrong edit or need for a hint. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0224

**SF-0224-02 - uncoached study card**

- **Route:** /mix/current/edit -> Studio before/after. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Without prompting, show what changed and what stayed the same after an editing suggestion."
- **Done means:** Participant identifies changed and unchanged cells correctly..
- **Hesitation:** Misidentifies an unchanged cell or does not find the comparison. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0224-08 - uncoached study card**

- **Route:** /mix/current/edit -> Studio suggestions. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Predict what accepting a suggested shape will do and how you would reverse it."
- **Done means:** Prediction matches the applied proposal and participant can undo..
- **Hesitation:** Uncertainty about the scope or an unintended edit. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0225

**SF-0225-04 - uncoached study card**

- **Route:** /listen -> Requests with a bridge proposed. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Decide whether to accept the additional songs needed to fulfil a request."
- **Done means:** Participant names the extra tracks before consenting or declining..
- **Hesitation:** Agrees without seeing the additional tracks or confuses consent with play. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0225-08 - uncoached study card**

- **Route:** /listen -> Requests, pending and ready. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Explain what will happen to this request and when it might play."
- **Done means:** Participant correctly distinguishes requested, preparing and ready from guaranteed next playback..
- **Hesitation:** An incorrect timing prediction or unprompted certainty. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0226

**SF-0226-08 - uncoached study card**

- **Route:** /library in normal and DJ retrieval modes. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Find a familiar track, then find one by key and tempo without coaching."
- **Done means:** Both casual listener and DJ retrieve the specified recording; record each elapsed time..
- **Hesitation:** Wrong song selected or hesitation longer than 10 seconds. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0228

**SF-0228-01 - uncoached study card**

- **Route:** /mixes/mine with current mix and a draft. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Point out which mix is playing now and which one is saved for later."
- **Done means:** Correctly distinguishes current, audible playback from an inactive draft..
- **Hesitation:** Draft misidentified as playing. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0228-03 - uncoached study card**

- **Route:** /mixes/mine with current and draft actions. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Keep a draft for later without replacing what is playing; then explain Edit versus Play."
- **Done means:** No unintended playback; chosen action affects only the named mix..
- **Hesitation:** Unexpected Play or confusion about edit scope. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0228-06 - uncoached study card**

- **Route:** /mixes/mine with render jobs and Up Next. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Identify which songs play next and which jobs are still rendering."
- **Done means:** Participant distinguishes the render line from the audible Up Next sequence..
- **Hesitation:** Names a render job as the next song. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0229

**SF-0229-01 - uncoached study card**

- **Route:** / first-run setup in a fresh profile. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Explain which computer folder the app will read and what the browser does."
- **Done means:** Explains local folder and server relationship before selecting any files..
- **Hesitation:** Expects a remote upload without evidence. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0229-07 - uncoached study card**

- **Route:** / first-run -> /mixes. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Start the first song and describe the sound or browser permission expected."
- **Done means:** One safe action begins real audio in the test setup or correctly reports a browser block..
- **Hesitation:** Repeated uncertain starts or unexpected autoplay. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0229-08 - uncoached study card**

- **Route:** /listen with own licensed real music and an audition-ready transition. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Listen to the first handoff, then describe whether it happened and how it sounded."
- **Done means:** Participant actually auditions the transition and independently describes the handoff; audio quality remains human-assessed..
- **Hesitation:** Mistakes a planned handoff for one heard. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0230

**SF-0230-01 - uncoached study card**

- **Route:** /workshop overview, source, analysis and storage. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Find the current system health, the source folder, analysis work and storage use."
- **Done means:** All four destinations identified correctly without prompting..
- **Hesitation:** Opens a wrong operational action or takes more than 10 seconds to choose. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0230-08 - uncoached study card**

- **Route:** /workshop/sources with a simulated stuck source. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Find the problem and restore progress without changing a healthy source."
- **Done means:** Correct recovery action selected; healthy source left unchanged..
- **Hesitation:** Attempts a destructive or unrelated action. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0232

**SF-0232-08 - uncoached study card**

- **Route:** /mix/current/edit or /workshop with a simulated failed save/job. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Recover an unfinished edit or failed job without losing already entered work."
- **Done means:** Correct input retained and recovery works after failure injection..
- **Hesitation:** Data loss, wrong retry target, or abandoning an available recovery. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0237

**SF-0237-08 - uncoached study card**

- **Route:** /listen, /mixes and Requests with distinct statuses. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Identify what is prepared, what is actually playing and what was requested."
- **Done means:** Each of the three states classified without confusing readiness and playback..
- **Hesitation:** Claims a prepared or requested song is currently sounding. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0242

**SF-0242-04 - uncoached study card**

- **Route:** /mix/current/edit and /mixes/mine. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Predict which mix changes when pressing Save, Play, Replace and Undo."
- **Done means:** Each scope named accurately before performing a safe reversible action..
- **Hesitation:** Unintended replacement, confusion about Undo scope. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0242-08 - uncoached study card**

- **Route:** /mix/current/edit after a reordering and save. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Describe what just changed and what will happen next."
- **Done means:** Accurately names the updated order and the next action or pending work..
- **Hesitation:** Believes an unsaved proposal is already playing. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0243

**SF-0243-08 - uncoached study card**

- **Route:** /mix/current/edit with several similar song rows. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Make the specified sequence edit quickly without touching other songs."
- **Done means:** Exact requested change and no unintended edits; elapsed time recorded..
- **Hesitation:** Wrong row moved or unrelated data changed. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0244

**SF-0244-02 - uncoached study card**

- **Route:** search and command palette with matching names across groups. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Find a song, a saved mix, a route and an action with similar wording."
- **Done means:** Each result identified by its category before selection..
- **Hesitation:** Picks a route instead of a song or confuses a command with a result. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0244-08 - uncoached study card**

- **Route:** search and command palette for novice and frequent operator. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Complete the same retrieval tasks by search and by navigation."
- **Done means:** Per-task time and errors recorded for both cohorts; no advantage claimed before study..
- **Hesitation:** Novice mis-selection or expert needs extra backtracking. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

### ADR-0246

**SF-0246-03 - uncoached study card**

- **Route:** /mix/current/edit from an unfamiliar mix. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Find the song that needs changing and inspect the transition into it."
- **Done means:** Correct song and exact seam selected without modifying another pair..
- **Hesitation:** Selects the wrong song or handoff. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0246-05 - uncoached study card**

- **Route:** /listen -> Requests requiring a bridge. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Make a song request and decide whether the proposed bridge is acceptable."
- **Done means:** Participant names the route and added songs before granting or refusing consent..
- **Hesitation:** Consents without understanding the bridge. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.

**SF-0246-07 - uncoached study card**

- **Route:** /listen -> /mixes -> /mix/current/edit -> /listen. Use the made-up library in `tests/e2e_server.py` unless real music is specified.
- **Card:** "Leave and return, then identify the same song, current mix and intended change."
- **Done means:** Song, mix and intent recognised after navigation; no unintended playback restart..
- **Hesitation:** Loses track of the current mix or confuses draft and playback. Record the first wrong click and any pause longer than 10 seconds.
- **Pilot:** preparation only; not run and never a participant result.


## Listener journey scripts (SF-0240-01)

| Task | Card read to the participant | Done means |
|---|---|---|
| L1 First run | "Point Selecta at the music folder on this computer and get it ready to play." | Folder accepted and the first-run stage reached "ready", with the LRCLIB disclosure seen before lookup starts |
| L2 First play | "Play a mix." | Sound starts within the session; participant can say which song is playing |
| L3 Pause and resume | "Stop the music for a moment, then carry on from the same place." | Paused, then resumed in the same song within 5 seconds of where it stopped |
| L4 First handoff | "Tell me when one song turns into the next." | Participant points at the handoff within 10 seconds of the real seam, and can name the next song |
| L5 Lyrics | "Show the words to what's playing." | Lyrics view open on the playing song |

## Creator journey scripts (SF-0240-02)

| Task | Card read to the participant | Done means |
|---|---|---|
| C1 Shape | "Make a mix that starts calm and ends high energy." | A mix created from the shape controls; the requested shape is not described as measured |
| C2 Reorder | "Move the third song so it plays first." | Exactly that song occurrence is now first; no other change |
| C3 Audition | "Listen to just the change between songs two and three." | Preview of that exact pair played; the main mix did not keep playing over it |
| C4 Studio | "Bring the vocals of the second song in earlier at that change." | Studio opened on that pair; the cells changed are only the second song's vocals; applied |
| C5 Undo | "Put the last change back." | The mix is as before C4, and the participant can say what was undone |
| C6 Export | "Save this mix as an audio file." | A FLAC saved of the mix as it was when saved |

### Task outcome form (one row per task)

| Field | Values |
|---|---|
| Task | L1 to L5, C1 to C6, A1 to A4 |
| Outcome | Done unaided / Done with stall / Gave up / Wrong result |
| Time to done | Seconds from card read to outcome |
| Wrong-result detail | What happened instead, or "-" |
| Participant's words | One quote about what they expected, or "-" |
| Delight (asked after the task) | 1 to 5, "How much did you enjoy doing that?" |

## Accessibility participant sessions (SF-0240-04)

Named environments, each with at least one participant who uses it day to day:

| Environment | Setting |
|---|---|
| NVDA with Microsoft Edge on Windows 11 | Browse and focus modes, default verbosity |
| Keyboard only, no screen reader | Edge or Chrome, 100% and 200% zoom |
| Windows contrast theme (forced colours) | Edge, "Night sky" and "Desert" themes |
| Reduced motion | OS "Show animations" off, Selecta motion on its default |
| Phone with large text | Android Chrome or iOS Safari, system text at its largest |

Tasks: A1 = L2, A2 = C2, A3 = C4, A4 = L1, using the same cards and outcome form. Extra fields for
these sessions: whether the participant heard each state change announced once (not repeated), and
any control they could not reach or name.

## Joy kept apart from correctness (SF-0240-06)

- Correctness is the outcome column and the time column. Joy is the delight column, asked after the
  outcome is recorded and never before.
- They are reported in separate tables and never combined into one score.
- A task with a Wrong result is reported as wrong even if its delight was 5.
- The main correctness number per task is the share of participants with Done unaided, with its
  denominator. Delight is reported as the median and the full spread, with its denominator.

## Reproducible findings (SF-0240-07)

Every finding written up from these sessions carries:

1. **Denominator:** how many participants attempted the task, and how many were excluded and why.
2. **Exact SHA** of the build tested, and the fixture (made-up library, `SELECTA_E2E_STRESS=1`, or a
   named real folder).
3. **Hardware:** OS, browser and version, CPU, memory, screen, and audio output.
4. **Evidence:** the outcome forms, and screen recordings where the participant agreed.
5. **Status:** findings are observations until the owner and an independent reviewer accept them
   (ADR-0247). A finding never ticks an SF task on its own.

Results go in `docs/acceptance.md` under a dated heading, apart from automated test results.
