---
id: T-20261125-ade0
title: Hosted mix and the browser mix in two tabs can sound at once
area: devices
status: open
priority: high
who: claude
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

The hosted player keeps one hosted mix per browser with its own Web Lock (selecta-hosted-audio) and stops the browser mix in its own tab, but the browser mix in another tab of the same browser keeps playing (it holds selecta-audio). Sharing the selecta-audio lock as is would make the device player show 'another tab is playing' and carry on by itself when the hosted mix stops. Good: one lock for all sound in a browser, with a take-over that neither side mistakes for another tab, and a two-tab test.
