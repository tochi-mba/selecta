---
id: T-20261126-9842
title: Duplicating a draft with the flag off reads the whole draft row
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/verification/engine-store-flag-on-sweep.md
commit:
---

tests/test_my_mixes_scale.py::test_opening_and_changing_one_draft_reads_that_draft_alone fails with core.engine_store off (it passes on): POST /api/drafts/{id}/duplicate runs SELECT * FROM drafts WHERE id=..., revisions and all, on the old path. Found by the flag-on sweep; not caused by the flag. Good looks like: the old path reads only the columns it copies, and the test passes both ways.
