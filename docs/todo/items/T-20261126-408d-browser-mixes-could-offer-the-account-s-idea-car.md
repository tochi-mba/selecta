---
id: T-20261126-408d
title: Browser mixes could offer the account's idea cards
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-to-account.md
commit:
---

A browser mix offers one idea card (Your songs, in your browser). POST /api/planning/ideas answers the Desktop's idea cards from the account's measurements, and the shared Make a Mix already draws cards from GET /vibes, but building one means the planner choosing songs from the whole library (at most 60 a request), while the browser's build chooses the songs itself and only asks the planner to order them. Good: GET /vibes in localFirstMixes.ts adds the account's cards when planning is on, and /vibes/{key}/build asks /api/planning/order with that idea over the playable measured songs, falling back to today's card.
