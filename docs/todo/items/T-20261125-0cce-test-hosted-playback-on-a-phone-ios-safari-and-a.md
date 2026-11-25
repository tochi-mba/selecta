---
id: T-20261125-0cce
title: Test hosted playback on a phone (iOS Safari and Android Chrome)
area: storage
status: open
priority: high
who: either
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

The hosted player hands the browser a tiny FLAC (the file's STREAMINFO and whole frames) for each 8 s window. Chromium plays it (measured); iOS Safari's decoder was not tried. Good: a 12-song hosted mix plays on an iPhone and an Android phone, with joins clean and the page responsive.
