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
