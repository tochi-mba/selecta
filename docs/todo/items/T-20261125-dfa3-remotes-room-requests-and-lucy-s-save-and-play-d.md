---
id: T-20261125-dfa3
title: Remotes, room requests and Lucy's Save and play don't reach the hosted player
area: devices
status: done
priority: normal
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 16
commit: 2b82a01a
---

What is wrong: the hosted mix plays only inside the hosted card (HostedMix.tsx with its own TimelinePlayer and the tab audio lock). It is not a playback session or a speaker device (ADR-0475), so a phone remote can't play, pause or skip it, a room's guest request can't join it, and Lucy's Save and play starts the browser mixer, not the hosted mix. What good looks like: the hosted player registers as this tab's speaker with the same session commands the browser player answers (play, pause, seek to part, next); a request or a Lucy proposal for a hosted account becomes a new server mix order (POST /api/hosted/mixes/render) with Play once it is ready; the remote shows the hosted mix's parts.

2026-11-26: With cloud.one_shell on, a cloud-only account plays through the Cloud shell's shared engine, which registers as this tab's playback device and reads the session (oneShell.test.tsx), so remotes, room requests and Lucy's Save and play reach the same player and mix as for music on devices. The older card's player stays only with the flag off and goes with T-20261126-fefe.
