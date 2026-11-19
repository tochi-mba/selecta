# Android venue soak protocol (gate 6, BF-0466-05)

The written, minute-by-minute protocol for the Android half of gate 6 in the
[gate register](bf-gate-register.md): six powered, awake, foreground hours on a real Android
tablet with interruptions exercised and recovery observed, consistent with the ADR-0460 Android
qualification programme (BF-0460-05: Chrome, Samsung Internet, Firefox Android; low, mid and high
RAM bands; Doze, battery saver, calls, focus and posture changes). One run produces one record
from the [evidence record template](bf-evidence-record-template.md). A person is present
throughout; nothing is simulated or accelerated, and a synthetic pass never flips the gate.

## What this run proves, and what it never proves

A completed run supports exactly: this tablet model, this Android build, this browser and version,
this output route, for six foreground hours with the listed interruptions. Android fragments
hard: an SM-X110 record says nothing about any other model, and a Chrome record says nothing
about Samsung Internet on the same device. Run the protocol once per browser you want recorded.

## Setup (before T+0)

1. **Record the tuple.** Model, exact Android version and build, browser and full version, RAM
   and chipset, SelectaDJ engine version, into the evidence record first.
2. **Browser.** One of Chrome, Samsung Internet or Firefox Android per run; record which.
3. **Power.** Plug the tablet in for the whole run; record the charge level at start. Being on
   power matters doubly here: Doze and app standby apply aggressive restrictions on battery, and
   the supported posture is a powered tablet.
4. **OEM battery settings, recorded not tuned.** Write down the manufacturer's battery
   optimisation state for the browser (Samsung "Sleeping apps", Xiaomi or Huawei battery killers,
   stock "Optimized" state) and whether battery saver is on. **Do not whitelist or exempt the
   browser** unless the SelectaDJ venue flow itself told you to: members run defaults, so the
   qualification must too. If the flow gives guidance, follow exactly what it says on screen and
   record that you did.
5. **Screen timeout.** Note the display sleep setting; do not set it to its maximum. The posture
   claims wake lock plus guidance; the run must show the wake lock holding under a normal
   timeout.
6. **Account and library.** Sign in to a test account with `cloud.local_media` granted and import
   at least 60 local tracks; record source and codec.
7. **Output route.** One route per run (built-in speaker, Bluetooth, USB-C DAC, 3.5 mm, HDMI);
   record the exact hardware.
8. **Second device.** Keep a signed-in controller phone beside you showing venue status.
9. **Start the venue flow.** Walk the `cloud.venue_tablet` posture: power, wake, output choice,
   Start tap, the check tone, your confirmation. T+0 is that confirmation.

## Observation intervals

Every 15 minutes, one interval line in the record: clock time and T+ offset; playing and heard by
you (a person, never a meter); the status on the tablet and on the controller and whether both
are true; charge level and heat; anything odd, or "nothing". Set a repeating timer; a run with
missing intervals is unusable.

## Interruption schedule

At each minute, perform the interruption, then record: what the tablet did, what both statuses
said (expected: `interrupted`, `output_unverified` or `uncertain` in plain words, never a false
playing claim), what recovery required, and how long it took.

| At | Interruption | What to do | What to watch |
|----|--------------|------------|---------------|
| T+0:45 | Lock attempt | Press the power button once; wake and unlock after 60 seconds | Honest stop or honest continue; no playing claim over silence; the recovery flow and any fresh gesture needed |
| T+1:30 | App switch | Switch to another app for 2 minutes, then return | Background throttling honesty; controller shows `interrupted` or `uncertain`; recovery on return, resuming from saved local state |
| T+2:15 | Call | Receive a real call (SIM or VoIP) on the tablet, ring 15 seconds, answer 30 seconds, hang up | Audio focus loss pauses safely; status `interrupted`; resume needs posture restored, with a fresh gesture where the platform demands one |
| T+3:00 | Output loss | Kill the output route (power off the Bluetooth speaker, unplug the DAC or cable); reconnect at T+3:05 | No blast on route change; `output_unverified`; the re-check offer; the sound check re-confirmation restoring verified status |
| T+3:45 | Battery saver | Switch battery saver on for 10 minutes while still plugged in, then off | Whether the OS throttles the tab or revokes the wake lock; the runtime detecting it and warning with the fix named (ADR-0460 wake-lock edge case) |
| T+4:00 | Second lock attempt | Stop touching the screen past the display timeout, or press power; wake after 60 seconds | Whether the wake lock held; if the OS locked or the OEM killer intervened, the honest downgrade (lease lapse, controller `uncertain`) and the recovery flow |
| T+4:45 | Long app switch | 5 minutes in another heavy app (camera, maps), then return | Tab discard behaviour under memory pressure; on a discarded tab, the reload and reconciliation path, with the controller honest throughout |
| T+5:30 | Notification burst plus call | Several notifications, then a second call (ring only, decline) | Late-run interruption handling with six hours of heat and memory behind it |

Between interruptions, let it play; the quiet hours are the evidence CI cannot produce. If Doze
or an OEM killer stops the tab at any point outside the schedule, that is not a protocol failure:
record exactly what happened, what the controller showed (expected `uncertain`, never playing),
and how recovery went. It may be the most valuable line in the record.

## Abort criteria

Stop and record a NO-GO finding (the failure stays; a failed soak is a finding, not a retry)
when:

- the device overheats (too hot to touch, or an OS temperature warning);
- playback cannot be recovered within 10 minutes of any interruption using the product's own
  recovery flow;
- the status lies for more than one interval: playing shown over silence, or verified output
  after a route loss - record it precisely first;
- the tab crashes or is killed more than twice outside the scheduled interruptions.

A clean run ends at T+6:00: stop deliberately, record final state, charge and heat, and complete
the verdict.

## Where the record goes

Save as `docs/verification/bf-evidence-gate6-<device-slug>-<yyyy-mm-dd>.md` and link it from
gate 6's row in the [gate register](bf-gate-register.md) in the same commit, for this tuple,
browser and route only, through the register's review rule.
