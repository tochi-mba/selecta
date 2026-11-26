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
- `core.engine_store` changes how the Desktop opens its database. Prove it on a copy before it
  is ever turned on for the real library (its default stays off until you have). The tests
  prove it on made-up libraries (docs/verification/engine-store-flag-on-sweep.md); only your
  own library can prove it on yours. In a PowerShell window in the repo:
  1. Close SelectaDJ. Copy the whole home folder, for example
     `Copy-Item -Recurse $HOME\.selecta D:\selecta-proof\home`, and keep a reference copy of
     the database that nothing will open: `Copy-Item D:\selecta-proof\home\selecta.sqlite
     D:\selecta-proof\before.sqlite`. Your music files are not copied and are only read.
  2. Point SelectaDJ at the copy and start it with the flag on:
     `$env:SELECTA_HOME="D:\selecta-proof\home"; $env:SELECTA_FLAGS="+core.engine_store";
     uv run selecta web`. The first start takes an upgrade backup and brings the file forward.
  3. Click through: the Library (search, sort, a song's details), the current mix and each
     draft, Requests, Discover, the Workshop's Listening and Memory, and Lucy's conversations.
     Everything you had must be there. Then rate one transition Good, edit a draft, add a
     request and ask Lucy one thing, so the store writes too.
  4. Close it and compare: `uv run python tools/library_compare.py D:\selecta-proof\before.sqlite
     D:\selecta-proof\home\selecta.sqlite`. Every table you had says `same` except the ones you
     just changed (`ratings` or `seams`, `drafts`, `song_requests`, Lucy's); the store's own
     tables say `new`; it ends "Nothing lost." or names a table to look at.
  5. Back up and restore: start it again (same two lines), Workshop, Storage, Download a backup.
     Then restore that ZIP twice, each into a fresh copy of the home folder: once started without
     the flag (`$env:SELECTA_FLAGS=""`) and once with it, each time Workshop, Storage, Restore a
     backup, Confirm, then restart. Both must open with everything from step 3, and
     `tools/library_compare.py` from the first copy's `selecta.sqlite` (unchanged since the
     backup) to each restored `selecta.sqlite` says `same` throughout.
  6. Turn the flag off on the first copy (`$env:SELECTA_FLAGS=""`), start once more and click
     through again: nothing is missing. Remove `SELECTA_HOME` and `SELECTA_FLAGS` when done; the
     real library was never opened.

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
| The downloaded file plays the same finished clips as playback, joined the same way, each song at its own level | `cloud.local_export` with `cloud.device_render` | export on, render off | Download a mix as FLAC and play it beside the same mix in the app: the joins should sound the same, with no click |
| The feel of a mix's transitions (punchy or seamless) picks which moves the planner may use | `cloud.brain` with `cloud.device_analysis` | brain on, analysis off | Make the same mix twice, once with each feel. A mix already made keeps the feel it was made with |
| A requested song joins the mix where the planner places it, once this device has made the transitions around it | `cloud.account_mixes` with `cloud.device_render` | off | Ask for a song while a mix plays and listen to the two transitions around it |

## Cloud, uploaded music

Run the dev cloud stack (`dev.cmd cloud`), give the seeded account hosted media (the console's
storage switch), upload at least six songs and press Make a mix on the hosted card. Then turn
the flag on for the stack (`SELECTA_FLAGS="+cloud.hosted_brain"`), restart it and press Make
another mix with the same songs. A seam made with the flag on has its own key (`"brain":
"core"` in its job), so nothing rendered with the flag off is played back as if it were new.

| What changed | Flag | Default | How to hear it |
|---|---|---|---|
| A hosted mix is ordered by the planner core from the songs' stored facts, and each transition is the core's own ranked choice, rendered, checked and repaired by the Desktop's rule (at most 5 takes and a cut) | `cloud.hosted_brain` | off | The same uploads, one mix with the flag off and one with it on. Each hand-off on the card names its move; the job result says `engine: planner-core` |
| A transition between two songs that are both in the cloud library is made ahead by the cloud studio (`POST /api/hosted/seams`) and played by the shared player as a finished clip, each song from its lossless file at the level the clip was made at; a pair with a song only on a device, or a day whose transition allowance is used up, plays as a live blend | `cloud.studio_seams` | off | Needs the cloud library grant, `cloud.hosted_render`, `cloud.catalogue_play`, `cloud.one_mixer` and `cloud.seam_lead`, and both songs of a pair uploaded to the cloud library, each with its own upload (a version's copy does not count). Use a computer on Wi-Fi: with Data Saver or mobile data every transition plays live. In Make a Mix, make a mix of uploaded songs with the flag off and play it: those are the live blends. Turn the flag on (`SELECTA_FLAGS="+cloud.studio_seams"`), restart, and play the same songs in the same order. The cloud is asked for each transition two ahead while a song plays, so the first play may blend some live; play the mix again to hear every clip. With `cloud.browser_moves` on, a transition's info in the editor says "Prepared in your cloud library." when its clip played, and "Today’s prepared transitions are used up; the rest are worked out as the mix plays." once the day's allowance is gone. Listen at each clip's two joins (30 ms each, where native A hands to the clip and the clip to native B) for a click, a gap or a level step, then turn the flag off and hear the same transitions live. The Listening Room has no trial for these (to-do T-20261126-f3d4), so this comparison is by ear, not blind |

With no lyrics and no stems (Cloud runs no separator), the flag off still renders blends first
and the audit refuses them (cloud-library-walkthrough.md section 2.3), so it ends on an echo out
or a cut after minutes of work. With the flag on such a pair is offered only a cut, an echo out
or a reverb wash, picked by rank, and a song whose lyrics a device found can earn an 8 or 16 bar
blend. Listen for
whether the cuts land on phrase lines and whether the echo tails feel as long as the Desktop's.

## What limits the Cloud rows today

- The neural beat tracker is built for the browser but is not hosted and its licence record is
  not signed (to-do T-20261126-7164). Until then beats come from the older estimate, which
  assumes 4/4, so the planner's exits may not land on true phrase lines.
- The browser's time-stretch is simpler than the Desktop's. A clip that needs a tempo change
  is not the same audio as the Desktop would make, and blends over 60 seconds of stretched
  song are not rendered on the device.
- Stem moves and the delay throw are not played on the device.
- Uploaded music has no stems and no ears for voices on the server, so its blends need lyrics
  a device found (to-do T-20261126-fdde says what a stems handler must provide).

## What to listen for

- Joins: any click, gap or level step where a clip meets a song.
- Phrase lines: does the incoming song arrive where the outgoing one turns a phrase.
- Loop and blend: can you hear where the loop begins; does four passes feel long.
- Tempo bridge: can you hear the tempo move; is the outgoing kick still fighting the new one.
- One drummer: does it sound like one drummer, or like a filter.
