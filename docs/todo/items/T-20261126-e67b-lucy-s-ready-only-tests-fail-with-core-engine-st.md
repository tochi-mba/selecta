---
id: T-20261126-e67b
title: Lucy's ready-only tests fail with core.engine_store on (not her tables)
area: lucy
status: open
priority: high
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-lucy.md
commit:
---

With core.engine_store on for every test (a local pytest plugin that makes flags.use(None) mean +core.engine_store), 5 of 10 tests in tests/test_lucy_ready.py fail (k songs on verified edges, no route, shorter offer, ready-only build and play, eviction), and the same 5 fail with Lucy forced onto her old path, so it is not her tables. Likely cause, not yet confirmed: the tests place a ready seam as files on disk after the app started (lucy_helpers.place_ready_seam), and with the flag on seam readiness is read from the store's seams table, filled by the seam import at start. Good looks like: those tests pass with the flag on (the helper records the seam the way the render worker does, or readiness sees it), before the flag is proved on a real library. test_lucy_api and test_lucy_agent pass with the flag on.
