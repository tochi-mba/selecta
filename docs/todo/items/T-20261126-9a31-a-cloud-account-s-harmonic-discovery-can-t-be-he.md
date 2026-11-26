---
id: T-20261126-9a31
title: A Cloud account's harmonic discovery can't be heard, and nothing in the browser calls the sweep
area: devices
status: done
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/engine-store-discovery.md
commit: 65668d6d
---

Cloud's POST /api/discoveries/sweep, GET /api/discoveries and review run over stored song facts (cloud_brain/discovery_routes.py). Hearing a discovery (Desktop's /hear) renders a four-step audition on the server from the audio files, which Cloud does not hold. Good: the browser renders the audition from the device's own files (as cloud.browser_harmonic's audition does) for a link the account found, and calls the sweep in spare time over the songs it has measured, 40 at a time; the browser-side owner is the agent working on web/src/cloud.
