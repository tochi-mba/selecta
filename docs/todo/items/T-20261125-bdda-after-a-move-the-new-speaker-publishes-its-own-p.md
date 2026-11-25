---
id: T-20261125-bdda
title: After a move, the new speaker publishes its own programme (ADR-0475 I85, I88)
area: devices
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0475 I88 proof (ctl12.js)
commit:
---

After Move and play or Choose another device, the new speaker plays its moved mix but the session programme stays the old speaker's (24 entries, not 8): the new speaker never sends set_programme. Find why publishProgramme does not run or returns false after an insisted take-over, and make the session show the moved mix.
