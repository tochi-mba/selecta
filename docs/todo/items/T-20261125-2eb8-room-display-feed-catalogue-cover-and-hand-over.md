---
id: T-20261125-2eb8
title: Room display feed: catalogue cover and hand-over progress
area: rooms
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

The TV display (web/src/display) now tints the whole screen in the playing song's hue and changes it when the song changes. ADR-0477 asks for two more things the room feed (/api/display/view, song_json in src/selecta/rooms/api_common.py) cannot give yet: (1) a large catalogue cover for the playing song: song_json carries only song_id, title, artist and length_s, so the display shows no cover; add a cover URL (catalogue art only, ADR-0478) and draw it large in display/main.ts. (2) real hand-over progress during a blend (for example the blend's start and switch point on the session clock), so the colour can travel from this song's hue to the next song's with the blend, using mixHue from web/src/feel/hue.ts. Until then the colour changes at the song change, which is the honest fallback. The guest page could take the same cover field for its tiles.
