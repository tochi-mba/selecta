---
id: T-20261126-bf59
title: Discovery's seam_book and discovery_comparisons still use raw sqlite3
area: storage
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-requests.md
commit: 00dec947
---

seam_book (discovery links) and discovery_comparisons still use raw sqlite3: discovery/search.py _save (INSERT OR IGNORE), discovery/sweep.py (counts and INSERT OR REPLACE into discovery_comparisons, committed together), routes/discover.py (list, one, review), db._legacy_kinds_renamed, library/relink.py, homes.py and recovery.py copies. seam_book cannot move alone: the sweep writes it in the same uncommitted transaction as discovery_comparisons, so moving one splits a pair's links from its compared mark. Good: a discovery slice adopting both tables in place (workspace_id, keys unchanged on Desktop) with one store write per compared pair, Cloud tables only if Cloud gets a discovery writer.

2026-11-26: seam_book and discovery_comparisons adopted by lib0009discovery; a compared pair's links and mark are one store write (engine_store.discovery.record_pair); Cloud tables es0479disc01 and a bounded sweep route; docs/engineering/engine-store-discovery.md.
