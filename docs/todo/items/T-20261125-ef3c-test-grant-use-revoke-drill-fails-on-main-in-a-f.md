---
id: T-20261125-ef3c
title: test_grant_use_revoke_drill fails on main in a fresh cloud container
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: Full suite run on 2026-11-25 while fixing Lucy's limits
commit:
---

tests/test_bf_revocation_drill.py::test_grant_use_revoke_drill fails with 'a granted hosted job must run': the worker claims a different job from the one just enqueued. It fails the same way on main at f5b6a4a with main's own source, with and without PostgreSQL, so it is not caused by the Lucy changes. Not checked: whether CI sees it, or whether it depends on something in that container. Good: the drill passes from a clean checkout, or says what it needs.
