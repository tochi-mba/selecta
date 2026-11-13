# Six-hour soak protocol (named hardware)

ADR-0429 AV-0429-05. This is a person step: someone runs it on a named physical device and records
the evidence below. The simulated six-hour night in `tests/test_apb_continuity.py`
(`selecta.venueops.faults.simulate_night`) proves the logic, not the hardware; it never replaces
this soak.

## What passes

The played timeline meets every continuity target in `selecta.venueops.continuity.SLOS`:

| Target | Limit |
|---|---|
| Longest single silence (`gap.longest_s`) | at most 2.0 s |
| Total silence per hour (`gap.total_s_per_hour`) | at most 5.0 s |
| Audible gaps per hour (`gap.count_per_hour`) | at most 1.0 |
| Unplanned overlap (`overlap.unplanned_s`) | 0 s |
| Repeats inside the 60-minute window (`duplicate.within_window`) | 0 |
| Back-to-back repeats (`duplicate.back_to_back`) | 0 |
| Share of the night with music (`coverage.ratio`) | at least 0.998 |

An audible gap is any silence longer than 0.25 s. A planned crossfade is not an overlap.

## Equipment (record each exactly)

- Speaker device: make, model, CPU, RAM, OS and version, browser and version.
- Standby speaker, if used: the same details.
- Network: wired or Wi-Fi, router model.
- Audio path: interface or output used, mixer or amplifier.
- SelectaDJ build: git SHA and the `SELECTA_FLAGS` value.
- Library: a made-up or licensed soak library only, never a private one. Number of songs (at least
  120 so the night does not have to repeat), and the fallback pool size (at least 20).

## Before

1. Run the venue soundcheck runbook (docs/autopilot/venue-soundcheck-runbook.md) steps 1 to 6.
2. Turn on `autopilot.venue_mode`, `venue.continuity` and `venue.speakers`. For a rehearsal soak with
   faults, also `venue.fault_injection` and write down the seed.
3. Start a screen recording or a phone video of the speaker screen, and a loopback audio recording
   of the output (for example a second machine recording the line out). Clocks must agree to the
   second; write both start times.
4. Confirm the remote shows three fallbacks ready.

## During (six hours, no touching the speaker device)

Every 30 minutes, write down: time, what is playing, fallbacks ready (should be 3), which speaker
holds the zone, memory used by the browser tab, and anything heard (gap, glitch, echo, repeat).

Fault steps, at the times you choose and write down:

1. Hour 1: pull the network for 60 seconds.
2. Hour 2: pull the network for 5 minutes.
3. Hour 3: if there is a standby, close the playing speaker's page (speaker drop). Reopen it after
   2 minutes; it must stay quiet.
4. Hour 4: transfer to the standby and back.
5. Hour 5: leave untouched.
6. Hour 6: press Stop at the end of the six hours.

## After: the exact evidence to record

1. Export the played timeline (the venue night log) as JSON with one entry per play: song id,
   start, end, speaker, zone, planned blend and source.
2. Run the evaluator over it:
   `python -c "import json,sys; from selecta.venueops.continuity import Play, evaluate;
   plays=[Play(**p) for p in json.load(open(sys.argv[1]))];
   print(json.dumps(evaluate(plays, 0, 21600).as_dict(), indent=2))" night.json`
   and keep the output as `soak-report.json`.
3. From the loopback recording, measure every silence longer than 0.25 s and compare with the
   report's gaps. Any silence the log missed is a failure of the log, and the soak fails.
4. Write the result row in the evidence ledger:

| Field | Value |
|---|---|
| Date and start/end time |  |
| Person who ran it |  |
| Speaker hardware (exact) |  |
| Standby hardware (exact) |  |
| Network and audio path |  |
| Build SHA and flags |  |
| Fault seed (if rehearsal) |  |
| Every SLO measured and pass/fail |  |
| Gaps from the recording vs the log |  |
| Peak memory of the speaker tab |  |
| Notes (glitches, echoes, repeats heard) |  |
| Evidence paths (report, recording, video) |  |

5. Record the speaker platform results in the certification matrix
   (`selecta.venueops.speaker_platforms.Matrix.record_result`) for `soak_6h`, with the person, the
   named hardware and the evidence path. A failure is recorded as failed, never left blank.

## Rollback evidence

At the end, turn `venue.speakers` and `venue.continuity` off and restart. Confirm normal SelectaDJ
playback on the same device, the same songs and mixes present and unchanged (spot-check five song
hashes against the soak start). Write that down in the Notes row.
