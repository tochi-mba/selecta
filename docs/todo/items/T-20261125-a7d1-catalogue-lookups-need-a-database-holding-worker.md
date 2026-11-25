---
id: T-20261125-a7d1
title: Catalogue lookups need a database-holding worker in production
area: library
status: open
priority: high
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25 (ADR-0478 catalogue)
commit:
---

src/selecta/catalog/service.py handle_job needs SELECTA_DATABASE_URL. The dev stack worker has it; gateway workers (workers/cloud.py) do not, so in a deployment catalog.lookup jobs would wait forever. Good: the job runs in a process that holds the database, before library.art_lookup is turned on anywhere real.
