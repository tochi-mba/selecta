---
id: T-20261125-b2cd
title: Cloud: a first Play of a visit takes about six seconds to start sound
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: Cloud e2e drift fix (aa83), local-first-mixes spec, 2026-11-25
commit:
---

Seen locally (one worker, SQLite) for a grandfathered account mixing a device song with a hosted one: after Play on Make a Mix the shell says Your new mix is playing at once, but the player stays at 0:00 for about six seconds before playHere claims the audio lock and sound starts, and the hosted next song is resolved only after that. Find what the first press waits for (device registration, holdings, the hosted prepare call or the stretch module load) and start sooner, or say what it is waiting for.
