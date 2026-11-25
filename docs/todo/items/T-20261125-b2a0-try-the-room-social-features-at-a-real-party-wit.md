---
id: T-20261125-b2a0
title: Try the room social features at a real party with real phones
area: rooms
status: open
priority: high
who: owner
created: 2026-11-25
source: ADR-0488 build, 2026-11-25
commit:
---

The five room features (vote for the next song, keep songs, reactions, dedications, tonight in numbers) are tested by scripts and unit tests only. They need one real room: a host playing a mix, at least four phones on one Wi-Fi network, once with a TV paired at /display and once without. Things only a room can show: whether the vote feels fair and quick, whether taps are throttled on shared Wi-Fi, and whether the winner really plays next.
