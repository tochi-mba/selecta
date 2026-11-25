---
id: T-20261125-b781
title: Hosted export on staging: not yet verified end to end
area: storage
status: done
priority: high
who: claude
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit: 14d6dd48
---

Export was not checked on staging: the tab froze during playback before Export could be pressed. An export worker was started and stopped unused. Run it with 2 and with 12 songs, time it, download the file and listen to the joins. Locally a 12-song export had not finished after 33 minutes.

2026-11-25: Verified on staging 2026-11-25 with real Modal workers: a 4-song, 8:10 mix exported in about 14 seconds from pressing Export to the download link. The link served a FLAC (magic fLaC, 44.1 kHz, 24-bit, stereo, 21,628,865 samples = 490.4 s, 79 MB), matching the mix length. Not listened to end to end by a person.
