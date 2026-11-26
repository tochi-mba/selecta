---
id: T-20261126-2cbe
title: Lyrics in a device-music Cloud account
area: library
status: open
priority: normal
who: owner
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

browserFlags.ts switches lyrics.lookup off in the browser shell: the app looks lyrics up and showing them needs a licence (ADR-0406) that does not cover a browser. Good: a licence decision for showing lyrics in Cloud (see T-20261125-9d62 for hosted processing), then a lookup route the browser can call, and lyrics.lookup on in the browser.

2026-11-26, what the owner must supply before this can be built: (1) LRCLIB's operators' written confirmation or refusal of the intended Cloud use and rate (ADR-0406 SC-0406-01, correspondence on file); (2) legal advice on internal use of synced lyric timing (word moves, vocal timing) and on showing lyric text, recorded in ADR-0406 (SC-0406-04), or a display licence that covers a browser. Nothing in the repo shows lyric text in Cloud today, and the device studio skips moves that need the timing of sung words. Once (1) and (2) allow it, Claude builds: a Cloud lookup route through the shared rate-limited queue (SC-0406-02), the browser reading timing for word moves, and lyrics.lookup on in the browser shell only where the decision allows display.
