---
id: T-20261125-fc01
title: Sort and filter the Library by album and year
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.6 says album and year become available to sort and filter by. The browser catalogue (cloud/deviceMusicRequest.ts CatalogueSong) has album but no year; the local server's /library has neither as a sort. Needs year in the catalogue rows, album and year sorts in libraryPage and the local server, LibrarySong fields in api.ts, and a SELECTA_FLAGS flag before the Sort menus in views/Library.tsx offer them.
