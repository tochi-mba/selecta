---
id: T-20261126-ff7f
title: Tonal owner: one song's tonal parts at a time across far keys
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-26
source: ADR-0479 phase 8; docs/research/transition-craft-2.md
commit:
---

Phase 8 named the tonal-owner rule and it was never built. Key lives in the melody, bass and voice; if only one song's tonal parts sound at a time while the other lends drums, key distance stops mattering for that overlap (a hypothesis for the owner's ears; keys 5 or more apart were liked 2 of 11). Good: a planner_core rule that, for a blend across far keys, builds the script so only one side's tonal bands (or stems on Desktop) sound at once, admitted only when it passes the audit, behind a flag that is off until the owner has listened, with a listening row.
