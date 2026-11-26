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

2026-11-26: needs no licence or model and no owner decision, only work: a set-aside mark per song kept by the account (a column on the Cloud catalogue local_songs, or on song_overrides with is_music, by a shared-chain migration with the fail-closed policy, plus the Desktop library chain if song_overrides gains it), PUT and DELETE /api/song-facts/{id}/correction taking is_music, the planner's songs_of and request_planning leaving set-aside songs out, GET /local-media songs carrying the mark for the Library's set_aside count and filter, the localFirstRequest.ts correct() answer passing is_music instead of refusing it, and Song details showing the section in the browser (analysedHere). Not built in the 2026-11-26 pass because the engine store's library slice (library_writes.py, which owns is_music on the Desktop) was being moved by another agent in the same worktree at the time; build it on top of that slice once it lands.
