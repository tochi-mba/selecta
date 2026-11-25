---
id: T-20261125-2dad
title: Library row preview Play over the cover
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.6 asks for a preview Play over a Library row's cover that shows real bars while previewing. There is no song preview in the Library today: local mode has /songs/{id}/audio for the player only, and browser-first Cloud plays from device files. Needs a short preview source in both modes, a SELECTA_FLAGS flag (src/selecta/flags/library.json), the button over the cover (views/LibraryRow.tsx) and a beat-bus target on the preview element. The playing song's row already shows beat-driven bars over its cover (feel-row-bars).
