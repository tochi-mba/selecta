---
id: T-20261126-71c5
title: Ordering from the account misses songs measured under another version's id
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-to-account.md
commit:
---

A song with several files (versions) is one row in a browser mix, under its primary id, while measurements are saved under the id of the file this device holds. The order request (accountOrder.ts) asks with the mix's ids, so a song whose measured file is a non-primary version counts as not measured and plays after the planned run. Transitions are not affected (they use the file that plays). Good: accountOrder maps each mix id to the measured version's id for the request and back for the answer.
