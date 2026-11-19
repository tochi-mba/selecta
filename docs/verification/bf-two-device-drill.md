# Two-device truth drill (gate 7, BF-0466-05)

The written protocol for gate 7 in the [gate register](bf-gate-register.md): the ADR-0461
partition and takeover drill (BF-0461-07), and the ADR-0458 five-of-eight missing-media repair
(BF-0458-05), on real hardware. Two physical devices, a real network partition, a person
watching both screens. One run produces one record from the
[evidence record template](bf-evidence-record-template.md), filling the device tuple section once
per device. A simulated partition (DevTools offline, a proxy toggle) never counts for this gate.

Timing background for the expectations below: the speaker lease is 20 seconds, renewed by
5-second heartbeats; take-over and reconnect increment the lease's fencing token; a device
executes only commands fenced to its current token (ADR-0461, `src/selecta/playback/`).

## Setup

1. **Devices.** A speaker (a tablet that passes the probe and the sound check) and a controller
   (a phone). Record both tuples. Both sign in to the same test account.
2. **Network you control.** Both devices on a Wi-Fi network whose router you can touch, or the
   speaker on Wi-Fi you can kill while the controller stays on cellular. The partition must be a
   real radio-level loss (airplane mode or access point off), never a software toggle.
3. **Library for the repair half.** Before the drill, prepare the five-of-eight state: on the
   speaker, import 8 local tracks and build a recipe (a mix) using all 8. On the controller (or a
   second qualified device for the repair half), import only 3 of those 8 files. Identity is by
   content hash, so use copies of the same files, not re-encodes.
4. **Baseline.** Start playback on the speaker via the venue flow (sound check confirmed). From
   the controller: play, pause, skip, volume. Every command applies within a breath and the
   controller shows applied, then playing-as-of truth.

## Part A - partition and take-over

Perform each step and record what both screens show against the expected truthful state. Any
deviation is a finding; record it verbatim.

| Step | Action | Expected on the speaker | Expected on the controller |
|------|--------|-------------------------|----------------------------|
| A1 | T+0: confirm baseline, note the time | Playing | Playing as of seconds ago |
| A2 | T+1:00: partition the speaker (airplane mode on the tablet, or kill its access point). Keep it playing | Keeps playing its local programme (sources are local); shows it has lost sync, in plain words | Within about 25 seconds (the 20 s lease plus a heartbeat), downgrades to `uncertain` with a reason; never a green playing claim |
| A3 | T+2:00: from the controller, send a skip during the partition | Nothing (it cannot hear the command) | The command does not pretend to apply: it is pending or refused with a reason, and it carries a TTL after which it reports dropped, never executed late |
| A4 | T+3:00: from the controller, take over the session during the partition | Still partitioned, still playing locally, unaware | Take-over either provably succeeds (the controller, or a second speaker, holds the new fencing token and says so) or loudly fails; the old speaker is reported `uncertain`, never silently replaced by an invented healthy one |
| A5 | T+4:00: heal the partition (airplane mode off) | Its first heartbeat learns the superseded fence: it stops claiming the session, stops or mutes its playback rather than double-playing, and offers to become a controller | Shows exactly one speaker for the session; reports what the old speaker missed; expired commands from A3 reported dropped, none replayed |
| A6 | T+5:00: repeat A2 to A5 once more, this time taking over to a second playing device if one is qualified | Same honesty | Exactly one device ever holds the token; no moment of double audio existed at any point in the run |

**The one unacceptable outcome** is double audio: both devices playing the same session after the
heal. If it happens, record the exact timeline (it is the drill's most important possible
finding) and the run is NO-GO.

Also record, with times: how long each downgrade took, how long reconciliation took, and the
exact words each surface used (guests and members must never see internal state words).

## Part B - five-of-eight missing-media repair

On the device holding 3 of the 8 tracks:

| Step | Action | Expected |
|------|--------|----------|
| B1 | Open the recipe made on the speaker | It opens. A repair flow, not an error page: the 5 missing tracks are listed by name with why they are unavailable here, and the 3 that resolve are usable; the recipe is openable read-only for the parts that resolve |
| B2 | Attempt to play through the recipe | The available parts play; the missing parts are honestly marked, never silently skipped and never substituted with silence inside a seam |
| B3 | Re-import the 5 missing files via the repair flow's offer | Import runs with honest progress; content-hash identity reattaches every reference: no duplicate entries, no manual re-linking |
| B4 | Re-open the recipe | All 8 resolve; the mix is intact; revisions stayed immutable through repair (the recipe's history shows no rewritten revision) |
| B5 | On the original speaker, confirm nothing changed | Its library and the recipe are untouched |

## Abort criteria

Stop and record NO-GO when: double audio occurs (record first), a device must be factory-reset or
the app's data cleared to recover, or any surface shows a stale green playing state for more than
two minutes after a partition. A failed drill is a finding; the record keeps the failure and the
follow-up both.

## Where the record goes

Save as `docs/verification/bf-evidence-gate7-<pair-slug>-<yyyy-mm-dd>.md`, one record covering
both devices (tuple section per device), and link it from gate 7's row in the
[gate register](bf-gate-register.md) in the same commit, through the register's review rule.
