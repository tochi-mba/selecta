# One brain: what to listen to

Everything audible in the One brain programme (ADR-0479) sits behind a flag and has not been
heard by the owner. This is the one list for the listening session at the end. Each row says
what changed, the flag that switches it, and how to hear it against what it replaces.

Turn a flag on for a run with `SELECTA_FLAGS`, for example `SELECTA_FLAGS="+move.loop_room"`.

## Before listening

- Listen on a copy of the library, not the real one. Seams already rendered keep their old
  audio, because a seam's key does not include these flags, so clear the copy's rendered seams
  first or the comparison is old against old.
- Change one flag per reel. With several on at once a bad seam cannot be traced to its cause.
- `core.engine_store` changes how the Desktop opens its database. Prove it on the copy (open,
  rate a seam, back up, restore) before it is ever turned on for the real library.

## Desktop

| What changed | Flag | Default | How to hear it |
|---|---|---|---|
| Studio, strip and land, and intertwined stems play through the one renderer, so they get the pocket nudge, the second take and a vocal check | `render.one_engine` | on | Render the same pair with the flag off and on; compare in the Workshop blind study |
| Loop and blend: loops a song's last clean bars to make room for a blend | `move.loop_room` | off | `selecta move-trial loop_room --register`, grade in the Workshop, then `selecta listening-report loop_room-trial` |
| Tempo bridge: 16 bars of tempo change, then the next song at its own speed | `move.tempo_bridge` | off | `selecta move-trial tempo_bridge --register`, then the same report |
| One song's drums at a time when two drum patterns clash | `planner.rhythm_fit` | off | Only songs analysed after 2026-11-26 carry a drum pattern; re-analyse a few clashing pairs first |
| Planner limits re-fitted from your ratings | `planner.calibrated_gates` | off | `selecta calibrate` prints the evidence and changes nothing; `--apply --yes` writes it, `--reset` undoes it |

## Cloud, music on the device

Open `/listening-room` (`tools.listening_room`). It runs blind trials at matched loudness.

| What changed | Flag | Default | How to hear it |
|---|---|---|---|
| Each transition is planned when its song starts, songs are levelled to one loudness, a missed deadline retries | `cloud.seam_lead` | on | Play the same mix with the flag off and on |
| Song order and each transition's exit, entry, move and length come from the planner | `cloud.brain` with `cloud.device_analysis` | brain on, analysis off | Each seam's record says whether the account or the device chose it |
| Transitions rendered ahead of time, checked, then played as a finished clip | `cloud.device_render` | off | The Listening Room pairs each transition twice: made ahead against the device's own choice, and made ahead against the planner's choice played live |

## What limits the Cloud rows today

- The neural beat tracker is built for the browser but is not hosted and its licence record is
  not signed (to-do T-20261126-7164). Until then beats come from the older estimate, which
  assumes 4/4, so the planner's exits may not land on true phrase lines.
- The browser's time-stretch is simpler than the Desktop's. A clip that needs a tempo change
  is not the same audio as the Desktop would make, and blends over 60 seconds of stretched
  song are not rendered on the device.
- Stem moves and the delay throw are not played on the device.

## What to listen for

- Joins: any click, gap or level step where a clip meets a song.
- Phrase lines: does the incoming song arrive where the outgoing one turns a phrase.
- Loop and blend: can you hear where the loop begins; does four passes feel long.
- Tempo bridge: can you hear the tempo move; is the outgoing kick still fighting the new one.
- One drummer: does it sound like one drummer, or like a filter.
