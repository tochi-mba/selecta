---
id: T-20261125-8583
title: Busy flags that mirror an Action can outlast its time limit
area: shell
status: doing
priority: normal
who: claude
created: 2026-11-25
source: Dead-end audit, 2026-11-25
commit:
---

Action (web/src/ui/controls.tsx) now frees itself after ACTION_LIMIT_MS (60 s) when its run never settles, and answerWithin (web/src/api.ts) bounds changes that must keep their operation id. Several callers still keep their own busy state that only clears when the request settles, so a request that never answers leaves them disabled: WorkshopPanels.tsx previewRelink (checkingRelink), LocalBackup.tsx working (its buttons have limit={0} because backups are long by nature, but a hung local server still holds them), LucyApprove.tsx save checks, admin/parts.tsx Command (Working... with only Cancel). Good: each such flow wraps its request in answerWithin with a late handler (as Mixes.tsx, Library.tsx and Links.tsx now do), or drives its disabled state from the Action itself.
