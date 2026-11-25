---
id: T-20261125-3800
title: Confirm the import freeze is gone with a browser performance trace
area: library
status: open
priority: high
who: claude
created: 2026-11-25
source: Import freeze hunt, 2026-11-25
commit:
---

The import freeze fixes (WebCrypto hashing, shell and Library re-rendered only on batches and at most once a second, tonal profiling paused during imports and playback and held to one tab by a Web Lock, sliced mixdown) were reasoned from code, not profiled. Record a Performance trace in Helium during a 2,000+ file folder check, with a second tab open, and look for long tasks over 200 ms. A second same-site tab can share the importing tab's renderer process (and so its main thread) on a low-memory machine, which would explain the non-importing tab freezing too; chrome://process-internals or the Task Manager shows whether both tabs share one process.
