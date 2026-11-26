---
id: T-20261126-c4c2
title: Song requests and bridges still read and write through raw sqlite3
area: storage
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-mixes.md
commit: 655c590c
---

Part B of Phase 7 step 3 got as far as lib0008requests: the request tables are made by the library chain and requests.initialise runs no DDL with core.engine_store on. Still on raw sqlite3: every read and write in requests.py (add, cancel, bridge choice and route, marks, insert_ready's one BEGIN IMMEDIATE placement, which also writes queue and the mix_undo preference) and routes/song_requests.py. Good: an engine_store/requests.py slice (tables declared with workspace_id; insert_ready as one store write that uses mixes.StoreMixes for the queue and Undo), the flag-on path through library.store_of, a Cloud migration with the fail-closed policy, and the old-path-on-a-copy comparison test. Cloud request routes: request_planner.py itself is pure, but the Desktop routes plan placements with SeamStore readiness, rendered seam audits and the library's analysed songs (library_now), which a Cloud account does not have; they need the device studio's seam reports (seams table attestations) as readiness before a Cloud route can answer the same way. seam_book (discovery links) is not adopted: its UNIQUE(song_a, song_b, kind, payload) would need the workspace in Cloud and its readers are discovery's.

2026-11-26: requests.py and the request routes go through engine_store/requests.py with core.engine_store on (one write per operation, a request and its mix edit one transaction); es0479req01 makes the Cloud tables with the fail-closed policy; Cloud request routes in cloud_brain/requests_routes.py plan from song facts with readiness per device. The browser rendering a request's seams is T-20261126-a246; seam_book moves with discovery, T-20261126-bf59. docs/engineering/engine-store-requests.md.
