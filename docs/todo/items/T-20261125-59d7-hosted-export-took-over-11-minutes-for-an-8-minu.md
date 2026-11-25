---
id: T-20261125-59d7
title: Hosted export took over 11 minutes for an 8-minute mix on staging
area: storage
status: done
priority: now
who: claude
created: 2026-11-25
source: staging re-test with Modal workers after PR 149, 2026-11-25
commit: ffca3dc8
---

On staging a 5-song hosted mix (7:56 long, 4 rendered transitions) was still 'Exporting on SelectaDJ's servers' 11 minutes after Export was pressed, on a 4 vCPU export worker with nothing else running. The card first said 'about 4 minutes left', then 'about 1 minute left', then dropped the estimate. The export re-renders the whole set instead of joining the playback files and the transitions already rendered (T-20261125-4e63). Good: an export of a mix whose parts are ready takes well under the mix's own length, the estimate is honest or absent, and the file matches what was heard. Measure where the time goes on a worker before changing it.
