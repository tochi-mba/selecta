---
id: T-20261125-f41d
title: Tenant matrix: the /api/catalog routes from PR 140 are not classified
area: security
status: done
priority: high
who: claude
created: 2026-11-25
source: hosted/jobs, tests/test_cloud_tenant_isolation.py on main
commit: 1858e88a
---

test_every_cloud_route_is_classified fails on main after PR 140 merged: GET/PUT /api/catalog/settings, GET /api/catalog/songs/{song_id}/candidates, PUT /api/catalog/songs/{song_id}/choice, GET /api/catalog/art/{art_id}/{size}, POST /api/admin/catalog/art/{art_id}/{command} and more are in no set. Good: each joins SCOPED (with a cross-tenant test), STAFF_ONLY or FLAG_DARK as its isolation really is, and the test passes.
