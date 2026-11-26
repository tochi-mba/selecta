---
id: T-20261126-2cbe
title: Lyrics in a device-music Cloud account
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

browserFlags.ts switches lyrics.lookup off in the browser shell: the app looks lyrics up and showing them needs a licence (ADR-0406) that does not cover a browser. Good: a licence decision for showing lyrics in Cloud (see T-20261125-9d62 for hosted processing), then a lookup route the browser can call, and lyrics.lookup on in the browser.
