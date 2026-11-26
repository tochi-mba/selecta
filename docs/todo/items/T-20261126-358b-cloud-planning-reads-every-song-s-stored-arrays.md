---
id: T-20261126-358b
title: Cloud planning reads every song's stored arrays on each request, so a card build or bridge search takes seconds
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md, 2026-11-26 measurements
commit:
---

Measured on a developer machine with fake object storage: an idea card's build over a 2,000-song library about 10 s (60 songs' arrays read and planned), Make a Mix waits 12 s before using the browser's own build; Find a bridge over 250 songs about 8 s (500 songs whole was about 12 s, hence the 250 cap). Each call reads every song's features file again (about 13 ms a song) and scores its ways in. Good: the planning routes keep a small per-workspace cache of loaded songs keyed by song id, version and correction, dropped on a new measurement or correction, so a second build or search reads only what changed; then the bridge cap can rise and a card build sits well inside the wait.
