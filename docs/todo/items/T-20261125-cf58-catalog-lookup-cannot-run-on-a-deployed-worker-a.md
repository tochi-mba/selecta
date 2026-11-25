---
id: T-20261125-cf58
title: catalog.lookup cannot run on a deployed worker, and reaches hosts outside the workers' allowed list
area: infra
status: open
priority: high
who: either
created: 2026-11-25
source: egress model, PR 149 CI
commit:
---

catalog.lookup (PR 140) sits in the cpu-light pool, but its handler opens the database itself (SELECTA_DATABASE_URL) and writes covers to R2 with the server's own credentials, so only the dev stack's worker can run it: Modal workers carry no database or storage credentials and selecta.workers.cloud registers no handler for it, so in staging and production its jobs wait in the cpu-light queue for ever (the work.queue_stuck alert will name the pool). It also calls musicbrainz.org and coverartarchive.org (redirecting to archive.org image hosts), while a remote worker only fetches signed storage URLs on *.r2.cloudflarestorage.com and SELECTA_WORKER_STORAGE_HOSTS. Good: decide where lookups run (an internal-pool task on the server, or a worker given those hosts through the gateway with signed output slots), make the allowed hosts explicit, and measure its egress.
