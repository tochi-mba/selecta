---
id: T-20261126-6e24
title: Idea cards over more than 60 measured songs in a device-music Cloud account
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/cloud-device-features.md
commit:
---

In a device-music Cloud account the idea cards and their builds (web/src/cloud/accountIdeas.ts) are planned over at most 60 of the songs this device can play that the account measured (cloud_brain.planning.MAX_ORDER_SONGS), the first 60 by title. The Desktop's cards and builds read the whole analysed library, so with more than 60 measured songs a card can miss songs that suit it. Good: POST /api/planning/ideas and an idea build that read the account's measured songs themselves (through the engine store, the caller's workspace, bounded per call like request_planning.WINDOW), with the browser sending only which songs play on this device, so every suitable song can be chosen.
