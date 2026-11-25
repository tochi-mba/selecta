---
id: T-20261125-557c
title: Staff console: a press in a button's first 500 ms does nothing and says nothing
area: admin
status: open
priority: normal
who: claude
created: 2026-11-25
source: Cloud e2e drift fix (aa83), admin-flags spec, 2026-11-25
commit:
---

ActionButton (web/src/admin/safety.tsx) ignores clicks for 500 ms after it becomes enabled (doc 07b 7B.7). Pressing Cancel on a waiting action right after Make changes therefore does nothing at all: no status, no error, the row stays. This is what made admin-flags look like a cancel bug. Good: the guard stays, but an ignored press is visible, for example the button shows it is arming, or the press is held and applied once armed if the pointer did not just arrive.
