---
id: T-20261126-ed4c
title: Library routes the browser shell has no Cloud answer for
area: shell
status: done
priority: normal
who: claude
created: 2026-11-26
source: One brain Phase 7 library slice, 2026-11-26
commit: 6c467306
---

web/src/cloud/localFirstRequest.ts answers GET /api/library, GET /api/status, a tempo and key correction, never play and the never/allow batch. These Library routes have none in Cloud: GET /api/songs, GET /api/songs/{id} (details: peaks, bars, sections, lines), /api/songs/{id}/audio and /art, POST /api/songs/{id}/analyse, POST /api/songs/{id}/priority and the priority batches, a correction's set-aside (is_music), /api/library/interrupted, /api/library/lyrics/again, /api/library/check, /api/analysis/start and /stop, and the folder routes in routes/system.py (/api/folders, relink, check, stop watching). /api/scan and /api/scan/cancel have none by design: a Cloud song arrives through the catalogue's registration. Good: the browser agent decides for each whether Cloud answers it, hides it, or says it is the app's alone.
