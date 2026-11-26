---
id: T-20261126-3f92
title: Is it music? in a device-music Cloud library
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

Song details hides Is it music? in a browser library (SongDetails analysedHere): the app decides it when it reads a folder, and the account's correction route keeps only tempo and key (PUT /api/song-facts/{id}/correction). Members use Never play instead. Good: the account keeps a set-aside mark per song (a field on the catalogue or the correction), the browser's Library filters and mixes honour it, and the section shows in the browser.
