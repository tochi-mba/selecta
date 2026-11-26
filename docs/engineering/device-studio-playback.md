# Playing transitions made ahead on the device

ADR-0479, the device studio's playback half. For a Cloud account whose music stays on the device,
the browser renders each transition ahead of time from the account planner's script, audits it,
follows the Desktop's repair rule, and plays the finished clip between the two songs: native A,
the clip, native B, as the Desktop's `render/engine.py in_context` and `web/src/player.ts` do.
Rendering and the audit themselves are in docs/engineering/device-render.md.

Flag `cloud.device_render` (off), named on by the server (`flagListed`), with `cloud.brain` and
`cloud.device_analysis` (`planningOn`), and both songs measured here and in the account. With any
of that missing, nothing here runs and playback is exactly as before.

## Code

| File | Job |
|---|---|
| `web/src/dsp/render/seamMaker.ts` | The loop for one seam: options, takes, audit facts, repair rule, deadline |
| `web/src/dsp/render/windows.ts` | Which source samples a script reads (moved from `engine.ts`) |
| `web/src/cloud/deviceStudio.ts` | Render ahead in play order, one at a time; `clipFor` for the provider |
| `web/src/cloud/studioWiring.ts` | The studio wired to the planning routes, the speaker and one worker |
| `web/src/cloud/clipStore.ts` | Finished clips on the device, under a byte budget |
| `web/src/cloud/renderedPlan.ts` | A made clip as a seam schedule; the provider's last check; how long to wait |
| `web/src/cloud/accountSeams.ts` | Asks the studio first, keeps the live plan as what plays instead |
| `web/src/engine/renderedSeam.ts` | The join arithmetic and the checks a clip must pass to play |
| `web/src/engine/scheduler.ts` | Plays the third seam kind (checks moved to `schedulerChecks.ts`) |

## The life of a seam

1. **Pair known.** Each time the playing position or the mix changes, `localFirstPlayer.ts` resolves
   the playing song and the next two and calls `studio.follow(order, position)`. The wanted seams
   are (playing, next) and (next, the one after): two ahead, chosen because the speaker's decode
   cache keeps three songs (`loader.ts` KEEP_DECODED), exactly the three these two seams read.
   Seams no longer wanted are dropped and their render abandoned (the worker is ended).
2. **Decoded.** The studio asks the speaker for each song (`BrowserSpeaker.decodedAt`), through the
   same capped cache the scheduler plays from, so a clip is rendered from the very samples that
   play (the same decode rule). Levels come from the same `engine/level.ts` measurement the
   scheduler applies.
3. **Planned.** `POST /api/planning/candidates` with `scripts: 8`, asked once per pair; the stored
   clip is looked up under its key (below) and, when found, nothing is rendered.
4. **Made.** `makeSeam` runs the Desktop's loop, one seam at a time in one render worker, marked as
   seam work (`seamWork.ts`) so the background key profiler waits:
   - `repair.nextStep` names the option to try; an option whose script was not sent is fetched with
     `POST /api/planning/candidates/script` by index and fingerprint.
   - Options this device cannot render are stepped over without rendering and without counting a
     render, as the rule steps over a recipe that built no script: a stem source, more than 60 s of
     stretched song (`STRETCH_MAX_WINDOW_SECONDS`), a move needing sung-word timing (`delay_throw`,
     or `meta.wordplay`), a script naming other songs, a script that could not be had.
   - Each take is rendered at the two playing levels (each part's `gain_db` is replaced by
     `20 log10(level)` of its song), from the windows `neededWindows` names, cut and transferred.
   - The worker returns the audit facts and, when the beat check failed, `beat_offset`. `takeStep`
     says TIGHTEN: a second take with every part of B's song read `offset` earlier
     (`seam_making.tighten_beats`), and KEEP takes the closer of the two. Only the kept take is
     counted, as on Desktop. `choose_transition` itself does not tighten; seam_making does, so the
     device does it on every take.
   - ACCEPT plays the take. A take that fails but is `goodEnough` is held. FALLBACK renders the
     planner's fallback cut and checks it; the cut plays when it passed or nothing is held, and the
     held near miss plays otherwise (`seams._best_move`: a near miss only when not even the cut is
     clean). The answer's `max_repairs` bounds the renders.
5. **Checked.** A clip of the wrong length, more than 2 dB louder than the louder neighbouring 10 s
   of native song or 20 dB quieter than the quieter, is not used.
6. **Kept.** In memory while its seam is one of the next two; on the device in `clipStore.ts`.
7. **Asked for.** When the scheduler plans the seam (as A starts, with `cloud.seam_lead`), the
   provider's `planned` hook (`accountSeams.ts`) asks `studio.clipFor` with the scheduler's own
   decoded songs and levels. A finished clip answers at once; work in hand is waited for at most
   `renderWaitMs`: 90 s, and never past 12 s before the planner's top choice would start (its 8 s
   late guard plus 4 s). No work in hand and no time: no wait at all.
8. **Settled.** The provider checks the clip against the songs it is about to play
   (`settleRendered`) before recording it; the scheduler checks again with its clock.
9. **Played.** Native A, the clip, native B. The record says `chosenBy: {by: 'account-rendered'}`
   and `studio`: the move, passed or not, each option tried or stepped over and its failed checks,
   time taken, implementation ids. One `[studio]` console line per seam in development.

## Every fallback

| Where | When | Then | Bound |
|---|---|---|---|
| Studio | flag off or not named, planning off | nothing runs | checked each follow and ask |
| Studio | a song not this device's file, not measured | no clip | |
| Studio | planner answer missing or slow | no clip | 20 s a request |
| Maker | the context is not at 44,100 Hz | no clip | at once |
| Maker | every option stepped over, cut too | no clip | |
| Maker | the seam's deadline passes | no clip | 120 s a seam |
| Maker | clip wrong length, too loud, near silent | no clip | |
| Provider | no clip by the wait's end | the live plan, then the device | 90 s or 12 s before the exit |
| Provider | clip does not fit these songs | the live plan, then the device | at once |
| Scheduler | clip would start late, or before A's own entry ended | the live plan it carries (one needing a stretched entry fades: its stretch was never made), else the short fade | at once |
| Member | skips, seeks or reorders | that seam is dropped; playback as today, instantly | never waits |

A clip is refused (renderedSeam.ts `renderedProblem`) when: its rate is not the context's and the
songs'; it is no longer than two joins; any sample is not finite or beyond 1; its start or end
falls outside either song; its levels are not the levels the songs play at (compared in float32);
or either join's clip side differs from the native side by more than half the native level (a
different decode, or a clip in the wrong place).

## The join arithmetic

All in samples at the context's rate `r`. `n = trunc(0.03 r)`: 1,323 at 44.1 kHz, 1,440 at 48 kHz.
A's origin `base = startedAt - offset` (the time A's sample 0 plays). With `aStart` the clip's first
sample in A (`round(a_source_start r)`, half to even), `bEnd` B's sample after the clip
(`round(b_source_end r)`) and `L` the clip's length:

- the clip starts at `base + aStart / r`; A's fader is 1 there and ramps linearly to 0 at
  `+ (n - 1) / r`, and A stops 20 ms after the join;
- the clip's gain ramps 0 to 1 over the same span, holds 1, and from `base + (aStart + L - n) / r`
  ramps to 0 over `(n - 1) / r`;
- native B starts at that same time from B's second `(bEnd - n) / r`, its fader 0 to 1 over the
  join; B's sample `bEnd` plays at `base + (aStart + L) / r`, where B's own clock starts.

That is `in_context`'s `linspace(0, 1, n)`: the outgoing side at 1 on the join's first sample, 0
on its last. Every time comes from whole samples off one origin on the AudioContext clock.

## The level rule

The scheduler plays every song at `engine/level.ts`'s gain on its own decode (-14 LUFS, held under
-1 dB peak), after the song's fader. The planner's `gain_db` comes from the account's facts, a
different measurement. The clip is therefore rendered at the scheduler's level, the one
measurement: each part's `gain_db` is set to the playing level in dB, so the clip's edges and the
native songs meet without a step. The clip goes to the deck past B's fader and level (it carries
both already). A clip made at other levels (the first song of a start can begin at 1 when its
level is late) is refused, and the seam plays live.

## Position, transport and the member

- "Now playing" moves to B at the script's overlap end (`switch_at`, as the Desktop's seam record);
  until then position counts on through A, afterwards B's place follows B's warp until native B
  takes over.
- Pause suspends the context, clip included. A seek or skip during the clip starts the song asked
  for natively, as today; the clip is dropped with its layer. Stop fades the clip with the rest.
- The member hears a transition shaped by the Desktop's recipes and checks; nothing on screen
  changes. A seam not ready in time sounds as it does today. Clips never leave the device; the only
  new request is `candidates/script` (deviceToAccount.egress.test.ts).

## Storage

`clipStore.ts` keeps each clip in the device-wide derived store (`media/derived.ts`, kind `clip`)
under SHA-256 of both songs' content hashes, the planning answer's fingerprint, the two levels as
float32 and `web-render-1+wsola-stretch-v1`, with what was chosen and how its checks went. Its own
budget is 128 MB (about eleven 30 s clips), least recently used out first. The store never holds
clips in its memory map, and when the browser runs short it evicts clips before any measurement.

## Limits

- The stretch is WSOLA, not the Desktop's Rubber Band; a stretched clip is not the Desktop's render.
- More than 60 s of stretched song cannot be rendered; that option is stepped over.
- The renderer works at 44,100 Hz only; a context opened at another rate never renders
  (to-do T-20261126-fae3).
- Render times were measured under node only (0.8 to 8.4 s a take); nothing on a phone or tablet
  (T-20261126-d1a3). Five takes, each with a second take, came to under two minutes at those times;
  the 120 s budget is not measured on a slower device.
- Rendering the seam after next decodes that song early: three decoded songs at once, as the cache
  already allowed. The Listening Room has its own studio and worker while it is used.
- The safety thresholds were reasoned, not heard (T-20261126-4031). Export writes the same clips
  playback plays (web/src/cloud/localExport.ts, render.ts `joins`; T-20261126-96d3, done).

## Listening to it

Turn on `tools.listening_room`, `cloud.brain`, `cloud.device_analysis`, `cloud.seam_lead` and
`cloud.device_render`, make a mix of measured songs on this device, and open `/listening-room`.
A new session then compares, for each of up to four transitions, the planner's choice made ahead
against this device's own choice, and against the planner's choice played live, as two blind
trials with the usual keys (Q, W, E, R, T). All three play every song at one level. Each audition
starts 15 s before its own transition. After the reveal, a transition made ahead says its move and
whether it passed every check, only just missed one, or did not pass. An existing session keeps
its Before and After comparison; start a new one to hear these.
