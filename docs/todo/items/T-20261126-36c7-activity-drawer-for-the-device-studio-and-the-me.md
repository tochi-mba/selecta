---
id: T-20261126-36c7
title: Activity drawer for the device studio and the measurements uploader
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

browserFlags.ts switches app.activity off in a device-music Cloud account, because the drawer lists the app's server jobs. The browser has its own work: the device studio making transitions (deviceStudio.ts) and the uploader saving measurements (factsUploader.ts). Good: an activity source over their own state feeds the shell's existing Activity drawer, and app.activity is on in the browser.
