---
id: T-20261125-368d
title: tests/test_cloud_tenant_isolation.py is over 1,000 lines on main
area: rooms
status: open
priority: normal
who: either
created: 2026-11-25
source: found while testing feat/room-social, 2026-11-25
commit:
---

tests/test_file_length.py fails on main because tests/test_cloud_tenant_isolation.py has 1,053 lines. Not caused by the room social branch. Split it by what it covers, unless the open feel or Lucy pull requests already do.
