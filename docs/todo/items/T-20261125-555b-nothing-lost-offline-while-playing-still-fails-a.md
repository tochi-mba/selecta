---
id: T-20261125-555b
title: nothing-lost 'offline while playing' still fails: after going offline the Listen page shows Play (stopped) and no offline banner
area: ci
status: open
priority: now
who: claude
created: 2026-11-25
source: copy-drift agent, local runs 2026-11-25 (cd-run3, cd-run5)
commit:
---

web/e2e-cloud/nothing-lost.cloud.ts, test 'offline while playing'. With this branch's fixes the mix now starts (take-over, set_programme, heartbeats), but right after context.setOffline(true) and /test/expire-lease the trace shows no further /api request at all, the banner says only 'Showing what this device knows' (connection status still online, no 'You are offline'), and the play bar is back to Play at 0:00. In one run the engine instead said 'The audio worklet loaded but never processed audio', so headless audio under heavy machine load may be part of it. Next: run the one test alone on a quiet machine with a trace, check whether the window offline event reaches connection.ts, and whether usePlaybackDevice stops on lease expiry before its offline branch (cloud.offline_playback) runs. If the product stops the music offline, that is the data-loss row this spec guards: fix the product, keep the assertion.
