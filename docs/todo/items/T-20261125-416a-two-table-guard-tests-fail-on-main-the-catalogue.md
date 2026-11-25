---
id: T-20261125-416a
title: Two table guard tests fail on main: the catalogue tables are missing from their allow-lists
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: Found 2026-11-25 while adding the Lucy usage tables
commit:
---

tests/test_cloud_workspace_columns.py::test_every_table_is_tenant_data_or_named_as_global fails because catalog_art, catalog_lookups, catalog_recordings and catalog_releases (migration fl0478cat01) are not in GLOBAL_TABLES, and tests/test_fingerprint_sharing_guard.py::test_every_cross_tenant_hash_table_is_allowlisted fails because catalog_art is not in its allow-list. Not caused by the Lucy work. Good: each table is listed with the reason it is global, or made tenant data.
