---
id: T-20261126-3c47
title: Read the derived-files collector's dry run, then turn it on
area: storage
status: open
priority: normal
who: owner
created: 2026-11-26
source: hosted gaps, walkthrough section 11
commit:
---

Run 'selecta storage gc' against staging (or read the Workers page's collector counts once the maintenance service has run for an hour). If what it would delete looks right, set SELECTA_FLAGS=+cloud.derived_gc on the maintenance service. Default: leave it dry until a staging run has been read. Production after staging.
