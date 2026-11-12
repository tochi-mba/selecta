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
