---
id: T-20261124-c68a
title: Every page takes about 30 seconds to open with a 2,919 song library
area: shell
status: doing
priority: now
who: claude
created: 2026-11-24
source: docs/engineering/staging-walkthrough-notes.md items 5 and 24
commit:
---

Open from the cached catalogue at once and stream the rest in. Lucy's page must not wait for the catalogue.

2026-11-24 (audit): the catalogue is read 1,000 songs a page instead of 100 (1e83634e), and the first Library of a visit opens from this browser's last copy of the catalogue while the server's list arrives (db75d1c9). Still to check on staging: the time to first rows, and whether Lucy's page waits on the catalogue.
