---
id: T-20261126-827e
title: Seam Inspector for transitions the account planned and the device made
area: editor
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit: e111d231
---

browserFlags.ts switches seam_inspector off in a device-music Cloud account: the inspector reads the app's rendered transition files and audit through Desktop routes. The account has each reported seam (GET /api/seams, seams table with audit facts and the planner's reasons) and the device keeps the clip (clipStore.ts). Good: the inspector's why, audit and listen come from the account's seam record and this device's own clip, behind cloud.device_render and cloud.brain, and seam_inspector is on in the browser.
