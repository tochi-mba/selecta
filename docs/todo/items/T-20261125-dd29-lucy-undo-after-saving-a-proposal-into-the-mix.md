---
id: T-20261125-dd29
title: Lucy: undo after saving a proposal into the mix
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.9 asks for Apply to send the proposal into the mix with an undo toast. Lucy's client has no way to take a save back (no revert or uncommit call in web/src/lucy/client.ts), so an Undo button would claim something it cannot do. Needs a server call that restores the mix as it was before the commit (by revision), then LucyApprove.tsx can show showToast(..., { undo }) after a save confirmed here. The save itself already confirms in place with a drawn tick and the success buzz.
