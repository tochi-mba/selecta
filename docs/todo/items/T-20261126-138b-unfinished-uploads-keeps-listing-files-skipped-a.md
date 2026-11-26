---
id: T-20261126-138b
title: Unfinished uploads keeps listing files skipped as duplicates
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: T-20261125-3d9f, split when its overflow was fixed
commit:
---

Add music's Unfinished uploads keeps listing files that were skipped as duplicates and are already in the Library (seen in the cloud library walkthrough, 2026-11-25). Good looks like: a session the member skipped, or that matched a copy already stored, is cancelled on the server and leaves the list; only uploads that can still be carried on are listed.
