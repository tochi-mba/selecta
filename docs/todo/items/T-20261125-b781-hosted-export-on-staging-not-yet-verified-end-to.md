---
id: T-20261125-b781
title: Hosted export on staging: not yet verified end to end
area: storage
status: open
priority: high
who: claude
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit:
---

Export was not checked on staging: the tab froze during playback before Export could be pressed. An export worker was started and stopped unused. Run it with 2 and with 12 songs, time it, download the file and listen to the joins. Locally a 12-song export had not finished after 33 minutes.
