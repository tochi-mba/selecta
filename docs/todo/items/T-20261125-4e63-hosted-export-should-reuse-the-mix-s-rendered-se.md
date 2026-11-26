---
id: T-20261125-4e63
title: Hosted export should reuse the mix's rendered seams
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/cloud-library-walkthrough.md
commit: ffca3dc8
---

export.render joins the songs with render.setmix's own transitions, not the seams the customer heard in the hosted mix. Export from the rendered timeline (the same seams) so the file matches the playback.
