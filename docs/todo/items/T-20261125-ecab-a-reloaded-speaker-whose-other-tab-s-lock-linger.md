---
id: T-20261125-ecab
title: A reloaded speaker whose other tab's lock lingers offers Carry on here while the session still says it plays
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0475 audit, ctl16 on 2026-11-25
commit:
---

After a reload the old document's Web Lock can outlive it for a moment, so the one-tab rule offers Carry on here; the session keeps saying Playing on the device until its lease lapses (20 s). Tell the session paused there as the reload path now does.
