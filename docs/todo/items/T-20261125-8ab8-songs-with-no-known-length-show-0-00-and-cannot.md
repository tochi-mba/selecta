---
id: T-20261125-8ab8
title: Songs with no known length show 0:00 and cannot be seeked
area: library
status: done
priority: normal
who: claude
created: 2026-11-25
source: Playback pass in Helium, 2026-11-25
commit: 248841ee
---

Songs imported from the owner's folder (video rips such as Kranium, Maleek Berry) show 0:00 in the Library and 0:00 / unknown duration on Listen with The duration of this song is not known yet, so seeking is unavailable, even while the song plays. The browser knows the length once the audio is decoded. Good: the length is filled in from the decoded audio and saved, so the strip, the time and seeking work.
