---
id: T-20261125-2e79
title: The live blend shows only the playing song: the next song's waveform cannot be read in Cloud
area: shell
status: open
priority: high
who: claude
created: 2026-11-25
source: Playback re-check in Helium, 2026-11-25
commit:
---

After the fix the live blend draws during a real hand-off on /listen, but with the caption The next song's waveform can't be read here, so only this song is drawn, and the playing song's lane is a flat dotted line because its last seconds are near silent. The engine has already decoded the next song to play it, so its real peaks exist. Good: the next song's peaks are taken from the decoded audio (or computed as soon as it is prepared) so both waveforms cross, and the outgoing lane reads as a waveform, not a dotted line.
