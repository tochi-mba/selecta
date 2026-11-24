---
id: T-20261124-b8fd
title: A storage failure on upload says SelectaDJ is being updated
area: storage
status: done
priority: high
who: claude
created: 2026-11-24
source: docs/engineering/staging-walkthrough-notes.md item 1
commit: 712d24f1
---

A 503 from storage (NoSuchBucket) showed the generic update message. Say the file could not be stored, nothing was lost, give a reference, and alert the operator.
