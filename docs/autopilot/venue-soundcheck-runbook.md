# Venue soundcheck runbook

For venue staff setting up SelectaDJ Autopilot before doors open. Allow 30 minutes. Work through
every step in order and tick it on the paper sheet at the end; if a step fails, follow its
"If it fails" line before going on. ADR-0433 (AV-0433-05).

Status: the speaker logic behind these steps (leases, zones, fallbacks, offline rights) exists in
`selecta.venueops`, but the remote screens the steps name (Venue, Speakers, Transfer) are not
mounted in every build yet. Where a screen is missing, that step can't be done and this runbook is
not ready for that venue. Trying the full runbook at a real venue is a person step.

What you need: the speaker device (a certified platform, see step 2), its charger, a wired network
cable if the venue has one, the cable to the venue sound system, and a phone or laptop to use as
the remote.

## 1. Before you start

1. Check Autopilot venue mode is on for this venue (Settings, Features: "Autopilot venue mode",
   "Venue audio continuity" and "Venue speakers and zones").
2. Turn the venue amplifier or mixer channel for SelectaDJ all the way down.
3. Plug the speaker device into power. Do not run a night on battery.

If it fails: if any of the three features is missing, stop and call the venue manager; the night
can't run in venue mode without them.

## 2. Choose the speaker device

1. Use a primary platform: a Windows PC (Chrome or Edge) or a Mac (Chrome, Edge or Safari).
   An Android tablet or iPad is allowed only if the manager agreed; an iPhone is a remote only.
2. Open the speaker certification sheet (`selecta.venueops.speaker_platforms`, "status" column).
   If this platform says "not certified", you may still run tonight, but tell the manager and
   write it on the sheet.
3. Turn off sleep and screen lock for the night (Windows: Power, Screen and sleep, Never; Mac:
   Battery or Energy, prevent sleep; iPad: Auto-Lock, Never).

If it fails: if the device sleeps during step 7, use a different device.

## 3. Connect to the venue sound system

1. Connect the device to the mixer or amplifier input (USB audio interface or line out).
2. In the device's sound settings, pick that output. Turn notifications and system sounds off.
3. Set the device volume to 100 percent; you control loudness at the mixer, not the device.

If it fails: no signal on the mixer meter means the wrong output is selected. Fix it before going on.

## 4. Name the speaker and its zone

1. On the remote, open Venue, Speakers. Give the device a clear name ("Bar left", "Terrace").
2. Put it in its zone. One zone plays one stream; one speaker per zone plays at a time.
3. If the venue has a second device for the same zone, add it as the standby speaker.

If it fails: "may have 1 zone(s)" means the venue plan covers one zone. Use one zone tonight.

## 5. Level check

1. Start the soundcheck track from the remote. The speaker device must say it holds the zone.
2. Bring the mixer channel up slowly until the room level is comfortable at the bar.
3. Mark that position on the fader with tape. This is the night's level.
4. Walk the room: no distortion, no buzz, no one area much louder than the rest.

If it fails: distortion means the device or interface level is too hot; lower the interface gain,
not the fader, then repeat.

## 6. Only one speaker plays

1. With the soundcheck track playing, use Transfer on the remote to move it to the standby speaker.
2. The first speaker must go quiet within one second. You must never hear both together.
3. Transfer back.

If it fails: if you hear both at once, stop the night, unplug the standby and call support. Do not
open doors with an echo.

## 7. Network drop rehearsal

1. While music plays, pull the network cable (or turn Wi-Fi off) for 60 seconds.
2. Music must keep playing: a ready fallback song covers the gap.
3. Plug the network back in. Within a minute the screen shows the plan back on track.

If it fails: if the music stopped for more than two seconds, check the remote shows "fallbacks
ready" (three songs). If it shows fewer, wait five minutes and repeat; if it still fails, run
tonight with the network cable taped in and tell the manager.

## 8. Reconnect rehearsal

1. Close the speaker page (or restart the browser) on the playing device.
2. Within two seconds the standby takes over, or, with no standby, music resumes after you reopen
   the page and tap Start once.
3. Reopen the closed page. If the standby is now playing, the reopened one must stay quiet.

## 9. Stop works

1. Press Stop on the remote. Music stops at once on the speaker.
2. Press Start. Music begins again.

## 10. Before doors

1. Fader on the taped mark. Device on power, screen on, network in.
2. Remote shows: zone held by the right speaker, fallbacks ready, no warnings.
3. Fill in the sheet below and leave it at the bar.

## Soundcheck sheet

| Step | Done (initials) | Notes |
|---|---|---|
| 1 Features on |  |  |
| 2 Device and platform status |  |  |
| 3 Output selected |  |  |
| 4 Speaker named, zone set |  |  |
| 5 Level marked |  |  |
| 6 One speaker plays |  |  |
| 7 Network drop covered |  |  |
| 8 Reconnect |  |  |
| 9 Stop and Start |  |  |
| 10 Ready for doors |  |  |

Date, venue, staff name, speaker device and OS version:

## Rolling back

If anything here can't be made to pass, turn "Venue speakers and zones" off. SelectaDJ goes back to
its normal one speaker per account, with nothing about your songs, mixes or library changed.
