---
id: T-20261125-f1eb
title: An Undo that never answers keeps older Undos blocked
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: Dead-end audit, 2026-11-25
commit:
---

runUndo (web/src/state/activity.ts) marks an entry running and blocks older Undos in the same scope until it settles; the toast (web/src/ui/toasts.tsx) shows Undoing... until then. Dismiss still works, but if the request never settles the older Undos in Activity stay blocked until reload. This is a deliberate safety guard, so it was not loosened in the audit. Good: after a limit the entry says it could not confirm the Undo and offers to check the current state (re-read the mix or draft) before releasing older Undos.
