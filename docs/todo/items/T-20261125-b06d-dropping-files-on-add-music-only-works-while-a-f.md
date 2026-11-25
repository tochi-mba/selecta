---
id: T-20261125-b06d
title: Dropping files on Add music only works while a feel flag is on
area: storage
status: doing
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

web/src/cloud/Uploads.tsx: before the feel work a dropped file did nothing (the input has pointer-events none, so the browser opened the file). The new drop handling is gated on a feel part being on. Good: dropping files works whatever the flags say.
