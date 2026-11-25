---
id: T-20261125-fce1
title: An idle Cloud page polls the playback session about every 2 seconds
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit:
---

On staging every page asks GET /api/playback/session?device_id=... about every 2 seconds (38 API calls in about a minute on the Add music page, most of them this one), plus rooms/current, room-requests and local-media/holdings on a loop. Good: one live channel or a much slower poll when nothing is playing and the tab is hidden; check it against the polling policy and the rate limits, and measure requests per idle minute.
