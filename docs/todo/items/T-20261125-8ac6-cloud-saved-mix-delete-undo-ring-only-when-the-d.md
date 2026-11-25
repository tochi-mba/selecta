---
id: T-20261125-8ac6
title: Cloud saved mix delete: undo ring only when the delete was queued offline
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.5 asks for Delete to collapse the row with an undo ring. The row folds away (foldAway) and the toast ring shows whenever notify has an undo, but an online delete of a saved browser mix removes every version on the server and the dialog says it cannot be undone, so no undo is offered. Local drafts already restore. Decide whether recipes should keep a short restore window server side (like /drafts/restore) so the ring can be offered for online deletes too.
