---
id: T-20261125-b9ce
title: Feed crowd marks into mix making, not only into the vote's choices
area: rooms
status: done
priority: normal
who: claude
created: 2026-11-25
source: ADR-0488 RS-0488-06, 2026-11-25
commit:
---

Crowd marks (what rooms loved, per song and per blend) are kept and served at GET /api/crowd-marks, and they steer which songs a vote offers (web/src/rooms/roundCandidates.ts). The planner that builds a mix does not read them. Wire them in as a soft prior, weaker than the owner's own Good and Bad ratings and never overriding a Bad.
