---
id: T-20261126-6aaa
title: Two facts uploads for one song at once can leave arrays from the losing one
area: storage
status: open
priority: later
who: claude
created: 2026-11-26
source: Cloud planning, PR #159
commit:
---

facts_store.save uploads the arrays before the write that applies the provenance rule. Two uploads of the same implementation for one song share a key, so if they race the stored arrays may be the earlier upload's while the row is the later one's (same implementation, seconds apart). Good: a per-attempt key recorded in the row, or the publish inside a lock on the song's analysis row.
