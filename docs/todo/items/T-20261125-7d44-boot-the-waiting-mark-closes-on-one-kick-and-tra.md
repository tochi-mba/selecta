---
id: T-20261125-7d44
title: Boot: the waiting mark closes on one kick and travels into the gate
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.1 'Boot': the first-paint splash exists (web/index.html, feel-parts.css .boot-splash) with the existing waiting line. Still to do: when the app is ready, the splash's mark closes its wait with one pulse and travels to the gate card's or the rail's brand mark (both carry data-vt brand-mark). The swap from splash to React is a render, not a navigation, so it needs a view transition started from RuntimeApp around the first render (RuntimeApp is outside the shell worker's files). No looping ring: the line stays the only waiting indicator.
