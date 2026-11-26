# From the device to the account, and back

ADR-0479, the step that joins the device studio to Cloud's planner. A Cloud account whose music
stays on the device sends the measurements its browser made (docs/engineering/device-analysis.md)
to the account (docs/engineering/cloud-planning.md), and plays the planner's song order and
transitions instead of the browser's own rough choices. Code: `web/src/cloud/factsWire.ts`,
`accountFacts.ts`, `factsUploader.ts`, `accountOrder.ts`, `accountSeams.ts`, `plannerMoves.ts`.

## Flags

Everything here needs both `cloud.brain` and `cloud.device_analysis`, each **named on** by the
server (`flags.ts::flagListed`). A flag a server does not mention reads as on in the browser, so an
older server that knows neither would otherwise switch this on. With either off, or either not
named, nothing is sent and the browser orders and blends exactly as before.

## What is sent, and when

`factsUploader.ts`, started by the local-first shell, runs in the background for the signed-in
workspace. Once per pass (every five minutes) it reads `GET /api/song-facts` page by
page (kept ten minutes, and updated as it saves), then walks this device's song index:

- only hashes the index proved from the bytes (`tonalProfiles.ts::provenHashes`);
- only songs measured here (`songFacts(sha)`: the Beat This record when there is one, else the
  interim source's), sent as `web-dsp-1+<beat source>`;
- skipped when the account's measurement ranks higher (a worker's, `python-*`, or a device's with
  a better beat source), or when it is the same implementation's and this device never sent an
  older version of its own (a measurement is a pure function of the bytes, so another device's is
  the same numbers);
- skipped when remembered as sent: song id to `version:sha`, kept in the workspace's own answers
  store on this device (`offlineCache.ts`, forgotten with the workspace). A song measured again
  with Beat This has a new version, so it is sent again and outranks its interim measurement.

One song at a time, 1.5 s apart, each after any transition being prepared (`seamWork.ts`), each
`PUT /api/song-facts/{song_id}` bounded to 30 s. `409 outranked` and `song_mismatch`, `422` and
`413` count as done (resending can't change them); `404`, `duration_unknown` and `too_many` wait
for the next visit; `403` stops the pass; anything else (offline, slow, 5xx, 429, signed out) waits
10 s doubling to 30 minutes. Playback never waits on any of it.

### Exactly which fields leave the device

`factsWire.ts::factsBody`, field for field against `cloud_brain/facts_routes.py::FactsRequest` and
`engine_store/facts.py`:

| Sent | From the stored measurement | Wire form |
|---|---|---|
| `content_sha256` | the hash this device computed from the file's bytes | 64 hex |
| `implementation` | `web-dsp-1+<beat source>`: `web-dsp-1+web-beatthis-small0-1` or `web-dsp-1+web-onset-comb-beats-1` | text |
| `bpm`, `grid_confidence`, `key_confidence`, `lufs`, `peak_db`, `energy` | `row.*` | numbers |
| `constant_tempo`, `key_agrees_chroma` | `row.*` (0 or 1) | true or false |
| `beats_per_bar`, `key`, `camelot` | `row.*` | as stored |
| `sections` | `row.sections`, the six schema keys only | list |
| `arrays.beats` | `arrays.beats` | `<f8`, (beats) |
| `arrays.bar_starts` | `arrays.bar_starts` | `<i4`, (bars) |
| `arrays.energy_bars`, `low_share_bars`, `rms_db_bars` | the same | `<f4`, (bars) |
| `arrays.chroma_bars` | the same, row-major | `<f4`, (bars, 12) |
| `arrays.mfcc_bars` | the same, row-major | `<f4`, (bars, 20) |

Never sent: audio, a path, a folder or file name, a file handle, the timbre, the raw beats and
downbeats, the waveform peaks, the sample rate, the beat source's confidence. Arrays are written
little-endian through `DataView` whatever the machine's own order. A song with no steady beat, a
number that isn't finite (silence measures minus infinity) or arrays whose lengths disagree is not
sent: the account would refuse it, and nothing is clamped to fit.

## What is asked, and when

**A mix's order** (`accountOrder.ts`, from `localFirstMixes.ts` when Make a Mix builds). The browser
chooses the songs by today's rule; when at least 6 of them (the planner's own least) and at most 60
are measured in the account, `POST /api/planning/order` orders the measured ones with the member's
choices: `idea: pick`, `count`, `start` and `end` when measured, and the steering's `language`,
`stems` and `energy_arc` (0 to 100). The result: the chosen first song, the planned run, then every
chosen song the plan left out (not measured, Never play, or not picked) in today's order, then the
chosen ending. Songs are never dropped. The list and the order together are bounded to 12 s, while
Make a Mix's own busy state shows; any failure gives today's order and no message. The moves the
order names are not kept: each transition is asked for when it is prepared, below.

**Each transition** (`accountSeams.ts`, from the worker seam provider's `planned` hook; the
scheduler is unchanged). When the next transition is prepared (as A starts, with
`cloud.seam_lead`), and the member hasn't chosen a move or bars for it themselves, and both songs
play from this device's own files, are measured here and in the account: `POST
/api/planning/candidates` with `{a, b, leave_after: 30, scripts: 0}`, bounded with the list to 10 s.
The ranked options, then the planner's fallback cut, are tried in order (at most 24): the move
through the table below; the planner's cue times on the beat grid this device measured (the account
planned from those same numbers); a blend leaves at the bar `exit_cue.bar - bars` (the planner's
exit cue ends the overlap), a cut, echo or wash at the exit cue's time; B enters at the entry cue.
The first option `seamScript.ts` plays without changing anything (no fade, no shorter overlap, no
swapped move, starting within 50 ms of the planned exit) is played, B stretched to A's tempo as the
live engine already does. The schedule says `chosenBy: {by: 'account'}` and its reason in plain
words. Otherwise the device chooses as before and the record says `chosenBy: {by: 'device', note}`
with why: not measured, not this device's file, too late, nothing plays as planned, the call failed.

The repair loop (`next-step`, `take-step`) is never asked of the account: the live engine renders
and audits nothing ahead of time, so there is no audit for the rule to read.

**Made ahead, with `cloud.device_render`.** The live mapping above is then the fallback. The device
studio (`deviceStudio.ts`) asks `candidates` with `scripts: 8` instead of `scripts: 0` (one answer
serves both), renders and audits the planner's options in a worker, follows the browser's own port
of the repair rule, and plays the finished clip between the two songs; its record says
`chosenBy: {by: 'account-rendered'}`. It also asks `POST /api/planning/candidates/script` for an
option's script the first answer did not carry. When no clip is ready in time, or one is in doubt,
the live plan above plays, its note saying why (`not rendered: ...`); without one, the device
chooses as before. docs/engineering/device-studio-playback.md has the whole life of a seam.

### Move table (`plannerMoves.ts`)

| Planner move | Live move | Why |
|---|---|---|
| `bass_swap_blend` | `bass_swap_blend` | Same gains, same bass trade on a bar line; B stretched |
| `filter_sweep` | `filter_sweep` | Same sweeps and bass trade |
| `cut_on_one` | `cut_on_one` | Same declicked cut |
| `echo_out` | `echo_out` | Same in-time echo of A's last beat |
| `reverb_wash` | `reverb_wash` | Same two-beat wash |
| `tempo_ramp` | skipped | Rides both songs to a shared tempo; the live engine never changes A's speed |
| `delay_throw` | skipped | Throws A's last word; the browser knows no word timing |
| `loop_room` | skipped | Loops A's last clean bars under B; the live engine can't loop a playing song, the rendered path plays the script |
| `tempo_bridge` | skipped | Walks A's tempo to B's over 16 bars; the live engine never changes A's speed, the rendered path plays the script |
| anything else | skipped | Not a move this table knows |

A move the device can't do (no EQ, no echo returns, no stretch for the tempo gap) degrades in
`seamScript.ts`, which counts as "changed", so the next option is tried.

## Every fallback

| Where | When | Then | Bound |
|---|---|---|---|
| Sending | a flag off or not named, offline | nothing is sent | checked each pass |
| Sending | an error that can heal | waits, longer each time | 30 s a save; 10 s to 30 min waits |
| Order | too few or too many measured, refused, offline | today's order | 12 s |
| Transition | member's own choice | the member's choice | none asked |
| Transition | a song not here, not measured, not 4/4 | the device chooses | none asked |
| Transition | slow or failed call | the device chooses | 10 s |
| Transition | exit within 8 s of where A plays | the device chooses | |
| Transition | prepared too late anyway | the scheduler's short fade (unchanged) | |
| Transition | the stretched entry can't be made | scripted again without it, still the account's | stretch's own |
| Transition (made ahead) | no clip in time, refused, or in doubt | the live plan above, then the device | device-studio-playback.md |

## What the member sees

Nothing new: no setting and no status line. A new mix may be in a different order; a transition's
"why" in the editor reads "Planned from how both songs are built: their beats, bars, key and
energy." when the account chose it. Make a Mix's busy state may last up to 12 s longer.

## Next

- Beat This in the browser (docs/engineering/device-beats.md) waits on the owner's steps
  (to-do T-20261126-7164); until then devices measure and send with the interim beat source.
- Idea cards from `/api/planning/ideas` (to-do), and versions in the order (to-do).
