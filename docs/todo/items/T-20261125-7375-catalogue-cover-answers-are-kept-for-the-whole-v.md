---
id: T-20261125-7375
title: Catalogue cover answers are kept for the whole visit: hidden covers linger on kiosks and failed reads never retry
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

web/src/media/catalogArt.ts keeps each song's answer in a per-request book for the visit (books, 67-76) and marks it asked (gather, 99-104); readWaiting (108-118) swallows a failed read and the song stays asked. So: (1) a cover staff hide in the admin tool (src/selecta/catalog/routes.py:197-238) keeps showing on a venue display, kiosk or a tab left open for days, in MixArt collages and on the lock screen (audio/mediaSession.ts artFor), until a reload, beyond the 1 hour browser cache (routes.py:55); (2) a read that failed while offline or during a deploy leaves every song on the generated tile until reload. Fix: expire book entries (for example re-read matched entries after an hour, and on visibilitychange after a long absence), clear asked for songs whose read failed and retry with backoff when online returns, and drop the mediaSession artFor cache when the book changes.
