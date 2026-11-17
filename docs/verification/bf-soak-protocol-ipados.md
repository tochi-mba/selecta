# iPadOS venue soak protocol (gate 6, BF-0466-05)

The written, minute-by-minute protocol for the iPad half of gate 6 in the
[gate register](bf-gate-register.md): six powered, awake, foreground hours on a real iPad with
interruptions exercised and recovery observed, consistent with the ADR-0460 iPadOS qualification
programme (BF-0460-06). One run produces one record from the
[evidence record template](bf-evidence-record-template.md), saved in this folder. The run needs a
person present throughout: nothing here can be simulated, accelerated or run headless, and a
synthetic pass never flips the gate.

## What this run proves, and what it never proves

A completed run supports exactly: this iPad model, this iPadOS build, this browser form (Safari
tab or Home Screen web app), this output route, for six foreground hours with the listed
interruptions. It proves nothing about other iPads, other routes, locked-screen or background
playback (explicit non-promises, ADR-0460), or any tuple not in the record.

## Setup (before T+0)

1. **Record the tuple.** Fill the device tuple section of the evidence record first: model, exact
   iPadOS build, Safari version, RAM and chipset, SelectaDJ engine version.
2. **Choose the browser form** and record it: Safari tab, or Home Screen web app. A tuple is
   qualified per form; run the protocol once per form you want recorded.
3. **Power.** Plug the iPad in and keep it plugged for the whole run. Record charge level at
   start.
4. **Settings, recorded not tuned.** Note Auto-Lock's current setting (Settings, Display &
   Brightness). Do not set it to Never: the posture claims wake lock plus guidance, so the run
   must show the wake lock holding under a normal Auto-Lock setting. Note Do Not Disturb or any
   Focus mode state. **Guided Access note:** do not use Guided Access to pass this soak; it
   changes app lifecycle and would qualify a posture members do not run. If a venue would use it,
   that is a separate recorded variant, marked as such.
5. **Account and library.** Sign in to a test account with `cloud.local_media` granted and import
   a local library of at least 60 tracks (several hours of material), so the six hours exercise
   real decode variety. Record source and codec.
6. **Output route.** Pick one route for the run (built-in speaker, Bluetooth, USB-C DAC, 3.5 mm
   adapter, HDMI dock) and record the exact hardware. One run covers one route.
7. **Second device.** Keep a signed-in controller (any phone) beside you showing the venue status
   surface, so you can check that remote status tells the truth at every step.
8. **Start the venue flow.** Walk the `cloud.venue_tablet` posture flow: power check, wake, output
   choice, tap Start, hear the check tone, confirm it. The run starts (T+0) at that confirmation.

## Observation intervals

Every 15 minutes, on the quarter hour, write one interval line in the record:

- clock time and T+ offset;
- playing or not, and whether you can hear it (you, a person, not a meter);
- the status SelectaDJ shows on the tablet, and on the controller, and whether both are true;
- charge level and whether the device feels hot;
- anything else (stutter, glitch, UI oddity), or "nothing".

An interval line takes under a minute. Missing intervals make the run unusable; set a repeating
timer.

## Interruption schedule

Perform each interruption at its minute, then observe and record: what the tablet did, what both
statuses said while interrupted (expected: `interrupted`, `output_unverified` or `uncertain` in
plain words, never a green playing claim), what recovery required (expected on iPadOS: posture
restored plus a fresh tap where the platform demands a gesture), and how long recovery took.

| At | Interruption | What to do | What to watch |
|----|--------------|------------|---------------|
| T+0:45 | Lock attempt | Press the top button once; wake the iPad after 60 seconds | Audio stops or continues honestly; status never claims playing while the screen is off unless sound is actually continuing; on wake, recovery path and any gesture needed |
| T+1:30 | App switch | Switch to another app for 2 minutes, then return | Whether audio survives backgrounding (do not expect it to; expect honesty); controller shows `interrupted` or `uncertain`, not playing; recovery on return |
| T+2:15 | Call | Receive a FaceTime or cellular call on the iPad, let it ring 15 seconds, answer for 30 seconds, hang up | Audio focus loss pauses playback safely; status `interrupted`; resume needs the posture restored and a fresh gesture where required |
| T+3:00 | Output loss | Disconnect the output route (power off the Bluetooth speaker, unplug the DAC or cable); reconnect at T+3:05 | No blast on route change; status downgrades to `output_unverified`; the re-check offer appears; sound check re-confirmation restores verified status |
| T+4:00 | Second lock attempt | Let Auto-Lock fire naturally if it will (stop touching the screen for its timeout), else press the top button; wake after 60 seconds | Whether the wake lock held the screen; if the OS locked anyway, the honest downgrade and the recovery flow naming the fix |
| T+4:45 | Long app switch | Switch away for 5 minutes (Mail, Photos), then return | Tab suspension behaviour; lease expiry on the controller (`uncertain` within the lease window); reconciliation on return, resuming from saved local state |
| T+5:30 | Notification burst plus call | Trigger several notifications, then a second call (ring only, decline) | Interruption handling late in the run, with six hours of heat and memory behind it |

Between interruptions, let it play. The quiet stretches are part of the evidence: gaps, stutters
or thermal throttling at hour five are exactly what CI cannot see.

## Abort criteria

Stop the run and record a NO-GO finding (the failure stays in the record; a failed soak is a
finding, not a retry) when any of these happens:

- the device becomes too hot to touch comfortably, or iPadOS shows a temperature warning;
- playback cannot be recovered within 10 minutes of any interruption by following the product's
  own recovery flow;
- the status lies: anything shows playing while you hear silence, or verified output after a route
  loss, for more than one interval - record it precisely first, it is the most valuable finding
  this protocol can produce;
- the tab crashes or reloads more than twice.

A clean six hours ends the run at T+6:00: stop playback deliberately, record the final state,
battery and heat, and complete the verdict section.

## Where the record goes

Save the filled record in `docs/verification/` as
`bf-evidence-gate6-<device-slug>-<yyyy-mm-dd>.md` and link it from gate 6's row in the
[gate register](bf-gate-register.md) in the same commit. The row changes to GO only through the
register's review rule, and only for this tuple, form and route.
