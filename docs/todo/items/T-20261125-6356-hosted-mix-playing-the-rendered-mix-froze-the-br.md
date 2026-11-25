---
id: T-20261125-6356
title: Hosted mix: playing the rendered mix froze the browser tab on staging
area: storage
status: done
priority: now
who: claude
created: 2026-11-25
source: staging hosted run with Modal workers, 2026-11-25
commit: 6ccc32a7
---

On staging, after pressing 'Play the rendered mix' on a 2-song hosted mix, the card said 'Playing ... (loading the next part)' and within about a minute the whole tab stopped answering (no script could run for over 2 minutes) and Chrome then dropped the tab. Suspects: the player decodes whole lossless playback files (34 to 64 MB each) on the main thread or holds several decoded at once; the browser mix on the same page was also showing 'Play Building...'. Good: playback starts within a few seconds, the page stays responsive throughout, memory stays bounded for a 12-song mix, and a phone can play it. Reproduce with the Performance panel before changing anything.
