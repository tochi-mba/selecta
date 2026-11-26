---
id: T-20261126-6a7f
title: A stamped library whose engine table is re-made by the hand-made schema fails every store read
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/verification/engine-store-flag-on-sweep.md
commit:
---

Found by the flag-on sweep (tests/test_upgrade.py, made with the flag on then a table dropped): db.connect's CREATE TABLE IF NOT EXISTS re-makes a missing table without workspace_id, the stamp is already at head so no migration adopts it, and every store read of it fails with 'no such column: workspace_id' (loud, nothing lost). A real library only loses a table by hand or by damage, so this is unlikely, but the store should not wedge on it. Good looks like: bring_forward (or db.connect with the flag on) checks each adopted table has workspace_id and re-adopts one that lacks it, with a test that drops and re-makes a table on a stamped file.
