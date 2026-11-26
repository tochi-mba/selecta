---
id: T-20261126-3582
title: With core.engine_store on, each store call re-probes the connection's file and stamp
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/verification/engine-store-flag-on-sweep.md
commit:
---

Every library_rows.store_path, mix_backend._store_of, requests/listening/lucy backing check runs PRAGMA database_list and two engine_version reads on the caller's raw connection before using the store. Opening one draft of 500 runs 65 data statements and 71 of these probes (tests/test_my_mixes_scale.py, which now leaves them out of its count). sqlite3.Connection takes no attributes or weak references, so the answer cannot be cached on it; db.connect could open with a small Connection subclass that remembers its path and, once at head, its stamp. Good looks like: one probe per connection, the counts in test_my_mixes_scale back to data statements only.
