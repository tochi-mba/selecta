---
id: T-20261126-bf59
title: Discovery's seam_book and discovery_comparisons still use raw sqlite3
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-requests.md
commit:
---

seam_book (discovery links) and discovery_comparisons still use raw sqlite3: discovery/search.py _save (INSERT OR IGNORE), discovery/sweep.py (counts and INSERT OR REPLACE into discovery_comparisons, committed together), routes/discover.py (list, one, review), db._legacy_kinds_renamed, library/relink.py, homes.py and recovery.py copies. seam_book cannot move alone: the sweep writes it in the same uncommitted transaction as discovery_comparisons, so moving one splits a pair's links from its compared mark. Good: a discovery slice adopting both tables in place (workspace_id, keys unchanged on Desktop) with one store write per compared pair, Cloud tables only if Cloud gets a discovery writer.
