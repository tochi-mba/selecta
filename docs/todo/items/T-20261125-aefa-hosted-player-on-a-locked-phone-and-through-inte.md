---
id: T-20261125-aefa
title: Hosted player on a locked phone and through interruptions
area: devices
status: open
priority: high
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 15
commit:
---

What the code does: timelinePlayer.ts schedules about 15 s of audio ahead on one AudioContext and tops it up from a 500 ms interval. Throttled to once a second (a background tab) it keeps up; Chrome's intensive throttling (once a minute) spares pages playing audio. What is missing: no Media Session (title, artist, play, pause, next and seek from the lock screen), and nothing listens to the context's statechange, so an iOS interruption (a call, Siri, another app's audio) or a Bluetooth route change leaves the card saying Playing while silent, and iOS suspends Web Audio in a background tab. What good looks like: Media Session metadata and handlers for the hosted mix (reuse audio/mediaSession.ts), statechange shown as Paused by the phone with Carry on, scheduling further ahead (30 s) while the page is hidden, and navigator.audioSession.type set to playback where Safari has it. Check on a real iPhone together with T-20261125-0cce and T-20261125-d7a5.
